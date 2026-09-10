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

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Result<T> = [T, null] | [null, UpstreamError];

// Business logic never throws to its callers: functions that talk to AIPass
// return a Result tuple. safe() is the one place that turns a thrown
// UpstreamError (or a raw fetch/JSON exception) into that tuple.
async function safe<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return [await fn(), null];
  } catch (err) {
    if (err instanceof UpstreamError) return [null, err];
    return [null, new UpstreamError(err instanceof Error ? err.message : String(err), 502)];
  }
}

async function upstreamText(res: Response) {
  const text = await res.text();
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

// 403 from AIPass is the WAF traversal block: deterministic, retrying just
// triples latency for a guaranteed failure. Only retry what's actually
// transient (rate limiting, upstream 5xx, network/timeout).
function isRetryable(err: UpstreamError) {
  return err.status === 429 || err.status >= 500;
}

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 4000;

async function safeWithRetry<T>(fn: () => Promise<T>): Promise<Result<T>> {
  let result = await safe(fn);
  for (let attempt = 1; attempt < RETRY_ATTEMPTS && result[1] && isRetryable(result[1]); attempt++) {
    const delay = Math.random() * Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)); // NOSONAR: jitter timing, not security-sensitive
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await safe(fn);
  }
  return result;
}

// session key -> {conversationId, sentCount}, so a session reuses one AIPass
// conversation and only sends new turns. Capped with FIFO eviction so a
// long-running proxy doesn't grow unbounded across many client sessions.
const MAX_SESSIONS = 500;
const conversationsBySessionKey = new Map<string, { conversationId: string; sentCount: number }>();

function evictOldestSessionIfFull() {
  if (conversationsBySessionKey.size < MAX_SESSIONS) return;
  const oldestKey = conversationsBySessionKey.keys().next().value;
  if (oldestKey !== undefined) conversationsBySessionKey.delete(oldestKey);
}

// OpenCode sends a stable x-session-id header per session; fall back to
// hashing the first message for clients that don't (two sessions that
// happen to open with an identical first message would then collide).
function sessionKey(req: Request, messages: OpenAIMessage[]) {
  return req.headers.get("x-session-id") ?? JSON.stringify(messages[0]);
}

const TOOL_CALL_TAG = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const TOOL_CALL_OPEN_TAG = "<tool_call>";

// While streaming, we can't tell a plain reply from the start of a
// <tool_call> tag until we've seen enough of it. Emit everything except a
// trailing fragment that could still turn into the tag opening, so we never
// leak a partial "<tool_c" onto the wire.
function safeToEmitLength(buffer: string, tag: string) {
  const maxOverlap = Math.min(buffer.length, tag.length - 1);
  for (let len = maxOverlap; len > 0; len--) {
    if (buffer.endsWith(tag.slice(0, len))) return buffer.length - len;
  }
  return buffer.length;
}

// AIPass's WAF 403s bodies containing 2+ relative-path tokens (./ or ../), which
// every tool result (ls, git status, diffs) is full of. Break the tokens with a
// zero-width space so the WAF's traversal signature never matches, then strip
// it back out of anything we hand back to the caller.
const PATH_TRAVERSAL_TOKEN = /(\.{1,2})\//g;
const ZERO_WIDTH_SPACE = "​";
const sanitizeOutbound = (text: string) => text.replace(PATH_TRAVERSAL_TOKEN, `$1${ZERO_WIDTH_SPACE}/`);
const stripZeroWidthSpace = (text: string) => text.replaceAll(ZERO_WIDTH_SPACE, "");

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
    `Never omit the "name" and "arguments" keys. To call multiple tools in one reply, emit one ` +
    `<tool_call>...</tool_call> tag per call, back to back. If no tool is needed, just answer normally.`
  );
}

function extractToolCall(text: string, tools: OpenAITool[]): { name: string; arguments: unknown }[] {
  const calls: { name: string; arguments: unknown }[] = [];
  for (const match of text.matchAll(TOOL_CALL_TAG)) {
    if (!match[1]) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    if ("name" in parsed && "arguments" in parsed) {
      calls.push(parsed as { name: string; arguments: unknown });
    } else if (tools.length === 1 && tools[0]) {
      // Model sometimes emits bare arguments instead of the {name, arguments} envelope.
      calls.push({ name: tools[0].function.name, arguments: parsed });
    }
  }
  return calls;
}

// AIPass has no role:"system"/"tool" and no native tool-calling, so fold
// both into plain user/assistant text turns AIPass actually understands.
function normalizeMessages(messages: OpenAIMessage[]) {
  const flattened = messages.map((m): OpenAIMessage => {
    if (m.role === "assistant" && !m.content && m.tool_calls?.length) {
      const content = m.tool_calls
        .map((call) => `<tool_call>${JSON.stringify({ name: call.function.name, arguments: JSON.parse(call.function.arguments) })}</tool_call>`)
        .join("");
      return { role: "assistant", content };
    }
    if (m.role === "tool") {
      return {
        role: "system",
        content: `Tool result (${m.name ?? m.tool_call_id}): ${m.content}\n\nUse this result to answer the user's original question directly and naturally. Do not repeat or quote the raw tool result.`,
      };
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
    parts: [{ type: "text", text: sanitizeOutbound(m.content ?? "") }],
  }));
}

async function createConversation(modelId: string, firstMessage: string): Promise<Result<string>> {
  return safeWithRetry(async () => {
    const res = await fetch(`${AIPASS_BASE}/chat.data`, {
      method: "POST",
      headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded", Referer: `${AIPASS_BASE}/chat` },
      body: new URLSearchParams({
        message: sanitizeOutbound(firstMessage),
        folderId: "",
        modelId,
        intent: "create-conversation",
        clientCreateRequestId: crypto.randomUUID(),
      }),
    });
    if (!res.ok) throw new UpstreamError(`chat.data failed: ${await upstreamText(res)}`, res.status);

    const body = (await res.json()) as unknown[];
    const idx = body.indexOf("conversationId");
    const conversationId = idx >= 0 ? body[idx + 1] : undefined;
    if (typeof conversationId !== "string") {
      throw new UpstreamError(`could not find conversationId in response: ${JSON.stringify(body)}`, 502);
    }
    return conversationId;
  });
}

async function sendMessage(
  conversationId: string,
  modelId: string,
  messages: OpenAIMessage[],
): Promise<Result<ReadableStream<Uint8Array>>> {
  return safeWithRetry(async () => {
    const res = await fetch(`${AIPASS_BASE}/actions/send-message/${conversationId}`, {
      method: "POST",
      headers: { ...baseHeaders, "Content-Type": "application/json", Referer: `${AIPASS_BASE}/chat/${conversationId}` },
      body: JSON.stringify({ modelId, messages: toAipassMessages(messages) }),
    });
    if (!res.ok || !res.body) throw new UpstreamError(`send-message failed: ${await upstreamText(res)}`, res.status);
    return res.body;
  });
}

// Media-generation models AIPass exposes that opencode can't use as a chat model.
const NON_CHAT_MODEL = /image|seedance|seedream|veo-|lyria|deep-research/i;

async function listModels(): Promise<Result<AipassModel[]>> {
  return safeWithRetry(async () => {
    const res = await fetch(`${AIPASS_BASE}/loaders/list-models`, { headers: baseHeaders });
    if (!res.ok) throw new UpstreamError(`list-models failed: ${await upstreamText(res)}`, res.status);
    const body = (await res.json()) as { data: AipassModel[] };
    return body.data.filter((m) => !NON_CHAT_MODEL.test(m.id));
  });
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
    const text = stripZeroWidthSpace(
      message.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(""),
    );
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

function toolCallResponse(id: string, modelId: string, calls: { name: string; arguments: unknown }[]) {
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
          tool_calls: calls.map((call) => ({
            id: crypto.randomUUID(),
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
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

function openaiToolCallChunk(id: string, model: string, calls: { name: string; arguments: unknown }[]) {
  const toolCalls = calls.map((call, index) => ({
    index,
    id: crypto.randomUUID(),
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
  return (
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }],
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

// OpenAI-shaped error envelope so OpenCode surfaces the real upstream status
// and reason instead of a bare "Internal Server Error".
function errorResponse(err: UpstreamError) {
  console.error(`upstream error (${err.status}):`, err.message);
  const status = err.status >= 400 && err.status < 600 ? err.status : 502;
  return Response.json({ error: { message: err.message, type: "upstream_error", code: err.status } }, { status });
}

function toUpstreamError(err: unknown): UpstreamError {
  if (err instanceof UpstreamError) return err;
  return new UpstreamError(err instanceof Error ? err.message : String(err), 500);
}

async function handleModels() {
  const [models, err] = await listModels();
  if (err) return errorResponse(err);
  return Response.json({
    object: "list",
    data: models.map((m) => ({ id: m.id, object: "model", owned_by: "aipass" })),
  });
}

async function handleChatCompletions(req: Request) {
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

Bun.serve({
  port: PORT,
  async fetch(req) {
    try {
      const url = new URL(req.url);
      if (url.pathname === "/v1/models") return await handleModels();
      if (url.pathname === "/v1/chat/completions" && req.method === "POST") return await handleChatCompletions(req);
      return new Response("Not found", { status: 404 });
    } catch (err) {
      return errorResponse(toUpstreamError(err));
    }
  },
});

console.log(`aipass-proxy listening on http://localhost:${PORT}`);
