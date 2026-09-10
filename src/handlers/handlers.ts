import { createConversation, listModels, parseAipassStream, sendMessage } from "@/client/aipass-client";
import { errorResponse, openaiChunk, openaiToolCallChunk, textResponse, toolCallResponse } from "@/format/openai-format";
import type { Result } from "@/utils/result";
import { conversationsBySessionKey, evictOldestSessionIfFull, sessionKey } from "@/sessions/sessions";
import { buildToolsPrompt, extractToolCall, safeToEmitLength, TOOL_CALL_OPEN_TAG } from "@/format/tool-call";
import type { OpenAIMessage, OpenAITool } from "@/types";

async function bufferedChatResponse(upstream: ReadableStream<Uint8Array>, id: string, modelId: string, tools: OpenAITool[]) {
  let content = "";
  for await (const delta of parseAipassStream(upstream)) content += delta;
  const calls = tools.length ? extractToolCall(content, tools) : [];
  return calls.length ? toolCallResponse(id, modelId, calls) : textResponse(id, modelId, content);
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
        write(openaiChunk(id, modelId, `\n\n[proxy error] ${err instanceof Error ? err.message : String(err)}`, "stop"));
      }
      write("data: [DONE]\n\n");
      controller.close();
    },
  });
  return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

export async function handleModels() {
  const [models, err] = await listModels();
  if (err) return errorResponse(err);
  return Response.json({
    object: "list",
    data: models.map((m) => ({ id: m.id, object: "model", owned_by: "aipass" })),
  });
}

export async function handleChatCompletions(req: Request) {
  const body = (await req.json()) as {
    messages: OpenAIMessage[];
    model?: string;
    stream?: boolean;
    tools?: OpenAITool[];
  };
  const messages = body.messages;
  const modelId = body.model ?? "gemini-3.1-flash-lite";
  const stream = body.stream ?? false;
  const id = crypto.randomUUID();

  const key = sessionKey(req, messages);
  const existing = conversationsBySessionKey.get(key);
  const [conversationId, convErr]: Result<string> = existing
    ? [existing.conversationId, null]
    : await createConversation(modelId, [...messages].reverse().find((m) => m.role === "user")?.content ?? "");
  if (convErr) return errorResponse(convErr);

  const sliced = messages.slice(existing?.sentCount ?? 0);
  const newMessages = sliced.length > 0 ? sliced : messages;
  const toolsPrompt = body.tools?.length ? [{ role: "system", content: buildToolsPrompt(body.tools) }] : [];
  const [upstream, sendErr] = await sendMessage(conversationId, modelId, [...toolsPrompt, ...newMessages]);
  if (sendErr) return errorResponse(sendErr);
  if (!existing) evictOldestSessionIfFull();
  conversationsBySessionKey.set(key, { conversationId, sentCount: messages.length });

  const tools = body.tools ?? [];
  return stream
    ? streamChatResponse(upstream, id, modelId, tools)
    : await bufferedChatResponse(upstream, id, modelId, tools);
}
