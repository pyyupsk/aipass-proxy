import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema } from "ai";

const AIPASS_BASE = "https://de.aipass.net";
const SESSION_TOKEN = process.env.AIPASS_SESSION_TOKEN;
const PORT = Number(process.env.PORT ?? 47871);

if (!SESSION_TOKEN) {
  throw new Error("AIPASS_SESSION_TOKEN is required (see .env)");
}

const cookieHeader = `__Secure-ai_passport_auth.session_token=${SESSION_TOKEN}`;

// Cloudflare blocks requests missing browser-like User-Agent, Referer, and sec-fetch-* headers.
const baseHeaders = {
  Cookie: cookieHeader,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Origin: AIPASS_BASE,
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

type OpenAIToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OpenAIMessage = {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
};
type OpenAITool = { type: "function"; function: { name: string; description?: string; parameters?: unknown } };
type AipassModel = { id: string; displayName: string };

// session key -> {conversationId, sentCount}, so a session reuses one AIPass
// conversation and only sends new turns. ponytail: unbounded map, add eviction
// if this ever runs multi-user.
const conversationsBySessionKey = new Map<string, { conversationId: string; sentCount: number }>();

function sessionKey(messages: OpenAIMessage[]) {
  return JSON.stringify(messages[0]);
}

const TOOL_CALL_TAG = /<tool_call>([\s\S]*?)<\/tool_call>/;

function buildToolsPrompt(tools: OpenAITool[]) {
  const docs = tools
    .map((t) => `- ${t.function.name}: ${t.function.description ?? ""}\n  arguments schema: ${JSON.stringify(t.function.parameters ?? {})}`)
    .join("\n");
  const example = tools[0]?.function.name ?? "tool_name";
  return (
    `You have access to these tools:\n${docs}\n\n` +
    `To call one, respond with ONLY this and nothing else, replacing "name" with the exact tool name ` +
    `(e.g. "${example}") and "arguments" with an object matching that tool's arguments schema:\n` +
    `<tool_call>{"name": "${example}", "arguments": {...}}</tool_call>\n` +
    `Never omit the "name" and "arguments" keys. Call at most one tool per reply. If no tool is needed, just answer normally.`
  );
}

function extractToolCall(text: string, tools: OpenAITool[]): { name: string; arguments: unknown } | null {
  const match = TOOL_CALL_TAG.exec(text);
  if (!match?.[1]) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if ("name" in parsed && "arguments" in parsed) return parsed as { name: string; arguments: unknown };
  // Model sometimes emits bare arguments instead of the {name, arguments} envelope.
  if (tools.length === 1 && tools[0]) return { name: tools[0].function.name, arguments: parsed };
  return null;
}

// AIPass has no role:"system"/"tool" and no native tool-calling, so fold
// both into plain user/assistant text turns AIPass actually understands.
function normalizeMessages(messages: OpenAIMessage[]) {
  const flattened = messages.map((m): OpenAIMessage => {
    if (m.role === "assistant" && !m.content && m.tool_calls?.[0]) {
      const call = m.tool_calls[0];
      const args = JSON.parse(call.function.arguments);
      return { role: "assistant", content: `<tool_call>${JSON.stringify({ name: call.function.name, arguments: args })}</tool_call>` };
    }
    if (m.role === "tool") {
      return { role: "system", content: `Tool result (${m.name ?? m.tool_call_id}): ${m.content}` };
    }
    return m;
  });

  const merged: OpenAIMessage[] = [];
  let systemBuffer = "";
  for (const m of flattened) {
    if (m.role === "system") {
      systemBuffer += (systemBuffer ? "\n\n" : "") + m.content;
      continue;
    }
    if (m.role === "user" && systemBuffer) {
      merged.push({ role: "user", content: `${systemBuffer}\n\n${m.content}` });
      systemBuffer = "";
    } else {
      merged.push(m);
    }
  }
  if (systemBuffer) merged.push({ role: "user", content: systemBuffer });
  return merged;
}

function toAipassMessages(messages: OpenAIMessage[]) {
  return normalizeMessages(messages).map((m) => ({
    id: crypto.randomUUID(),
    role: m.role === "assistant" ? "assistant" : "user",
    parts: [{ type: "text", text: m.content ?? "" }],
  }));
}

async function createConversation(modelId: string, firstMessage: string) {
  const res = await fetch(`${AIPASS_BASE}/chat.data`, {
    method: "POST",
    headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded", Referer: `${AIPASS_BASE}/chat` },
    body: new URLSearchParams({
      message: firstMessage,
      folderId: "",
      modelId,
      intent: "create-conversation",
      clientCreateRequestId: crypto.randomUUID(),
    }),
  });
  if (!res.ok) throw new Error(`chat.data failed: ${res.status} ${await res.text()}`);

  const body = (await res.json()) as unknown[];
  const idx = body.indexOf("conversationId");
  const conversationId = idx >= 0 ? body[idx + 1] : undefined;
  if (typeof conversationId !== "string") {
    throw new TypeError(`could not find conversationId in response: ${JSON.stringify(body)}`);
  }
  return conversationId;
}

async function sendMessage(conversationId: string, modelId: string, messages: OpenAIMessage[]) {
  const res = await fetch(`${AIPASS_BASE}/actions/send-message/${conversationId}`, {
    method: "POST",
    headers: { ...baseHeaders, "Content-Type": "application/json", Referer: `${AIPASS_BASE}/chat/${conversationId}` },
    body: JSON.stringify({ modelId, messages: toAipassMessages(messages) }),
  });
  if (!res.ok || !res.body) throw new Error(`send-message failed: ${res.status} ${await res.text()}`);
  return res.body;
}

// Media-generation models AIPass exposes that opencode can't use as a chat model.
const NON_CHAT_MODEL = /image|seedance|seedream|veo-|lyria|deep-research/i;

async function listModels() {
  const res = await fetch(`${AIPASS_BASE}/loaders/list-models`, { headers: baseHeaders });
  if (!res.ok) throw new Error(`list-models failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data: AipassModel[] };
  return body.data.filter((m) => !NON_CHAT_MODEL.test(m.id));
}

// AIPass streams the AI SDK UI-message-chunk protocol.
async function* parseAipassStream(stream: ReadableStream<Uint8Array>) {
  const chunkStream = parseJsonEventStream({ stream, schema: uiMessageChunkSchema }).pipeThrough(
    new TransformStream({
      transform(part, controller) {
        if (!part.success) throw part.error;
        controller.enqueue(part.value);
      },
    }),
  );

  let previousText = "";
  for await (const message of readUIMessageStream({ stream: chunkStream })) {
    const text = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    if (text.length > previousText.length) yield text.slice(previousText.length);
    previousText = text;
  }
}

function openaiChunk(id: string, model: string, delta: string, finishReason: string | null) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: finishReason ? {} : { content: delta }, finish_reason: finishReason }],
  })}\n\n`;
}

function toolCallResponse(id: string, modelId: string, call: { name: string; arguments: unknown }) {
  return Response.json({
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: crypto.randomUUID(), type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  });
}

function textResponse(id: string, modelId: string, content: string) {
  return Response.json({
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  });
}

async function bufferedChatResponse(upstream: ReadableStream<Uint8Array>, id: string, modelId: string, tools: OpenAITool[]) {
  let content = "";
  for await (const delta of parseAipassStream(upstream)) content += delta;
  const call = tools.length ? extractToolCall(content, tools) : null;
  return call ? toolCallResponse(id, modelId, call) : textResponse(id, modelId, content);
}

function streamChatResponse(upstream: ReadableStream<Uint8Array>, id: string, modelId: string, tools: OpenAITool[]) {
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (s: string) => controller.enqueue(encoder.encode(s));

      if (tools.length) {
        let content = "";
        for await (const delta of parseAipassStream(upstream)) content += delta;
        const call = extractToolCall(content, tools);
        if (call) {
          write(openaiToolCallChunk(id, modelId, call));
        } else {
          write(openaiChunk(id, modelId, content, null));
          write(openaiChunk(id, modelId, "", "stop"));
        }
      } else {
        for await (const delta of parseAipassStream(upstream)) write(openaiChunk(id, modelId, delta, null));
        write(openaiChunk(id, modelId, "", "stop"));
      }
      write("data: [DONE]\n\n");
      controller.close();
    },
  });
  return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

function openaiToolCallChunk(id: string, model: string, call: { name: string; arguments: unknown }) {
  const toolCall = { id: crypto.randomUUID(), type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } };
  return (
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...toolCall }] }, finish_reason: null }],
    })}\n\n` +
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    })}\n\n`
  );
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/v1/models") {
      const models = await listModels();
      return Response.json({
        object: "list",
        data: models.map((m) => ({ id: m.id, object: "model", owned_by: "aipass" })),
      });
    }

    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
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

      const key = sessionKey(messages);
      const existing = conversationsBySessionKey.get(key);
      const isNewSession = !existing;
      const conversationId =
        existing?.conversationId ??
        (await createConversation(
          modelId,
          [...messages].reverse().find((m) => m.role === "user")?.content ?? "",
        ));
      const sliced = messages.slice(existing?.sentCount ?? 0);
      const newMessages = sliced.length > 0 ? sliced : messages;
      const toolsPrompt =
        isNewSession && body.tools?.length ? [{ role: "system", content: buildToolsPrompt(body.tools) }] : [];
      const upstream = await sendMessage(conversationId, modelId, [...toolsPrompt, ...newMessages]);
      conversationsBySessionKey.set(key, { conversationId, sentCount: messages.length });

      const tools = body.tools ?? [];
      return stream
        ? streamChatResponse(upstream, id, modelId, tools)
        : await bufferedChatResponse(upstream, id, modelId, tools);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`aipass-proxy listening on http://localhost:${PORT}`);
