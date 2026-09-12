import { createConversation, parseAipassStream, sendMessage } from "@/aipass/client";
import { type Result, UpstreamError } from "@/lib/safe";
import { openaiChunk, openaiToolCallChunk, safeToEmitLength, TOOL_CALL_OPEN_TAG } from "@/openai/stream";
import {
  buildJsonSchemaPrompt,
  buildToolsPrompt,
  errorResponse,
  extractToolCall,
  extractToolCallErrors,
  parseStructuredOutput,
  textResponse,
  toolCallResponse,
} from "@/openai/transform";
import type { JsonSchema, OpenAITool } from "@/openai/types";
import { chatCompletionsBodySchema } from "@/openai/types";
import { conversationsBySessionKey, evictOldestSessionIfFull, sessionKey } from "@/sessions/sessions";

async function bufferContent(stream: ReadableStream<Uint8Array>) {
  let content = "";
  for await (const delta of parseAipassStream(stream)) content += delta;
  return content;
}

// Retries once, in-conversation, when the model's tool_call tag is malformed rather
// than simply absent — an absent tag just means "no tool needed", not a mistake to fix.
async function bufferedChatResponse(
  upstream: ReadableStream<Uint8Array>,
  id: string,
  modelId: string,
  tools: OpenAITool[],
  conversationId: string,
) {
  const content = await bufferContent(upstream);
  if (!tools.length) return textResponse(id, modelId, content);

  const calls = extractToolCall(content, tools);
  if (calls.length) return toolCallResponse(id, modelId, calls);

  const errors = extractToolCallErrors(content, tools);
  if (!errors.length) return textResponse(id, modelId, content);

  const retryMessage = `Your previous <tool_call> was invalid:\n${errors.join("\n")}\nEmit a corrected <tool_call>{"name": ..., "arguments": ...} tag, or answer normally if no tool is needed.`;
  const [retryStream, retryErr] = await sendMessage(conversationId, modelId, [{ role: "user", content: retryMessage }]);
  if (retryErr) return errorResponse(retryErr);

  const retryContent = await bufferContent(retryStream);
  const retryCalls = extractToolCall(retryContent, tools);
  return retryCalls.length ? toolCallResponse(id, modelId, retryCalls) : textResponse(id, modelId, retryContent);
}

// Structured output always buffers (no partial-JSON streaming) and retries once,
// in-conversation, on a schema mismatch before surfacing a clear error.
async function structuredChatResponse(
  upstream: ReadableStream<Uint8Array>,
  id: string,
  modelId: string,
  schema: JsonSchema,
  conversationId: string,
) {
  const result = parseStructuredOutput(await bufferContent(upstream), schema);
  if (result.ok) return textResponse(id, modelId, JSON.stringify(result.value));

  const retryMessage = `Your previous response did not match the required JSON schema:\n${result.errors.join("\n")}\nRespond again with ONLY corrected JSON matching the schema.`;
  const [retryStream, retryErr] = await sendMessage(conversationId, modelId, [{ role: "user", content: retryMessage }]);
  if (retryErr) return errorResponse(retryErr);

  const retryResult = parseStructuredOutput(await bufferContent(retryStream), schema);
  if (retryResult.ok) return textResponse(id, modelId, JSON.stringify(retryResult.value));
  return errorResponse(
    new UpstreamError(`model did not produce schema-conforming JSON after retry: ${retryResult.errors.join("; ")}`, 502),
  );
}

// Stream plain text through as it arrives; only start buffering once we've
// actually seen <tool_call> open, so a text-only reply (the common case)
// still streams instead of waiting for the whole response.
async function streamWithToolDetection(
  upstream: ReadableStream<Uint8Array>,
  id: string,
  modelId: string,
  tools: OpenAITool[],
  write: (s: string) => void,
) {
  let pending = "";
  let toolCallBuffer: string | null = null;

  for await (const delta of parseAipassStream(upstream)) {
    if (toolCallBuffer !== null) {
      toolCallBuffer += delta;
      continue;
    }
    pending += delta;
    const openIdx = pending.indexOf(TOOL_CALL_OPEN_TAG);
    if (openIdx !== -1) {
      if (openIdx > 0) write(openaiChunk(id, modelId, pending.slice(0, openIdx), null));
      toolCallBuffer = pending.slice(openIdx);
      pending = "";
      continue;
    }
    const safeLen = safeToEmitLength(pending, TOOL_CALL_OPEN_TAG);
    if (safeLen > 0) {
      write(openaiChunk(id, modelId, pending.slice(0, safeLen), null));
      pending = pending.slice(safeLen);
    }
  }

  if (toolCallBuffer === null) {
    if (pending) write(openaiChunk(id, modelId, pending, null));
    write(openaiChunk(id, modelId, "", "stop"));
    return;
  }
  const calls = extractToolCall(toolCallBuffer, tools);
  if (calls.length) {
    write(openaiToolCallChunk(id, modelId, calls));
  } else {
    write(openaiChunk(id, modelId, toolCallBuffer, null));
    write(openaiChunk(id, modelId, "", "stop"));
  }
}

function streamChatResponse(upstream: ReadableStream<Uint8Array>, id: string, modelId: string, tools: OpenAITool[]) {
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (s: string) => controller.enqueue(encoder.encode(s));

      try {
        if (tools.length) {
          await streamWithToolDetection(upstream, id, modelId, tools, write);
        } else {
          for await (const delta of parseAipassStream(upstream)) write(openaiChunk(id, modelId, delta, null));
          write(openaiChunk(id, modelId, "", "stop"));
        }
      } catch (err) {
        console.error("streamChatResponse failed:", err);
        write(openaiChunk(id, modelId, `\n\n[proxy error] ${err instanceof Error ? err.message : String(err)}`, null));
        write(openaiChunk(id, modelId, "", "stop"));
      }
      write("data: [DONE]\n\n");
      controller.close();
    },
  });
  return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

export async function handleChatCompletions(req: Request) {
  const parsed = chatCompletionsBodySchema.safeParse(await req.json());
  if (!parsed.success) return errorResponse(new UpstreamError(parsed.error.message, 400));
  const body = parsed.data;
  const messages = body.messages;
  const modelId = body.model ?? "gemini-3.1-flash-lite";
  const stream = body.stream ?? false;
  const id = crypto.randomUUID();

  if (body.response_format && stream) {
    return errorResponse(new UpstreamError("response_format is not supported with stream: true", 400));
  }

  const key = sessionKey(req, messages);
  const existing = conversationsBySessionKey.get(key);
  const [conversationId, convErr]: Result<string> = existing
    ? [existing.conversationId, null]
    : await createConversation(modelId, [...messages].reverse().find((m) => m.role === "user")?.content ?? "");
  if (convErr) return errorResponse(convErr);

  const sliced = messages.slice(existing?.sentCount ?? 0);
  const newMessages = sliced.length > 0 ? sliced : messages;
  const toolsPrompt = body.tools?.length ? [{ role: "system", content: buildToolsPrompt(body.tools) }] : [];
  const responseFormat = body.response_format;
  const schemaPrompt = responseFormat
    ? [{ role: "system", content: buildJsonSchemaPrompt(responseFormat.json_schema.schema, responseFormat.json_schema.name) }]
    : [];
  const [upstream, sendErr] = await sendMessage(conversationId, modelId, [...toolsPrompt, ...schemaPrompt, ...newMessages]);
  if (sendErr) return errorResponse(sendErr);
  if (!existing) evictOldestSessionIfFull();
  conversationsBySessionKey.set(key, { conversationId, sentCount: messages.length });

  // json_schema always buffers to validate — streaming a partial JSON document can't be validated mid-flight.
  if (responseFormat) return structuredChatResponse(upstream, id, modelId, responseFormat.json_schema.schema, conversationId);

  const tools = body.tools ?? [];
  return stream
    ? streamChatResponse(upstream, id, modelId, tools)
    : await bufferedChatResponse(upstream, id, modelId, tools, conversationId);
}
