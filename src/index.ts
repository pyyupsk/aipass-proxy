import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema } from "ai";

const AIPASS_BASE = "https://de.aipass.net";
const SESSION_TOKEN = process.env.AIPASS_SESSION_TOKEN;
const PORT = Number(process.env.PORT ?? 47871);

if (!SESSION_TOKEN) {
  throw new Error("AIPASS_SESSION_TOKEN is required (see .env)");
}

const cookieHeader = `__Secure-ai_passport_auth.session_token=${SESSION_TOKEN}`;

// Cloudflare blocks requests without a browser-like User-Agent.
const baseHeaders = {
  Cookie: cookieHeader,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

type OpenAIMessage = { role: string; content: string };
type AipassModel = { id: string; displayName: string };

function toAipassMessages(messages: OpenAIMessage[]) {
  return messages.map((m) => ({
    id: crypto.randomUUID(),
    role: m.role === "assistant" ? "assistant" : "user",
    parts: [{ type: "text", text: m.content }],
  }));
}

async function createConversation(modelId: string, firstMessage: string) {
  const res = await fetch(`${AIPASS_BASE}/chat.data`, {
    method: "POST",
    headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded" },
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
    headers: { ...baseHeaders, "Content-Type": "application/json" },
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
      };
      const messages = body.messages;
      const modelId = body.model ?? "gemini-3.1-flash-lite";
      const stream = body.stream ?? false;
      const id = crypto.randomUUID();

      const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const conversationId = await createConversation(modelId, lastUserMessage);
      const upstream = await sendMessage(conversationId, modelId, messages);

      if (stream) {
        const readable = new ReadableStream({
          async start(controller) {
            for await (const delta of parseAipassStream(upstream)) {
              controller.enqueue(new TextEncoder().encode(openaiChunk(id, modelId, delta, null)));
            }
            controller.enqueue(new TextEncoder().encode(openaiChunk(id, modelId, "", "stop")));
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(readable, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }

      let content = "";
      for await (const delta of parseAipassStream(upstream)) content += delta;
      return Response.json({
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`aipass-proxy listening on http://localhost:${PORT}`);
