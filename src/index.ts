import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema } from "ai";

const AIPASS_BASE = "https://de.aipass.net";
const SESSION_TOKEN = process.env.AIPASS_SESSION_TOKEN;
const PORT = Number(process.env.PORT ?? 8787);

if (!SESSION_TOKEN) {
  throw new Error("AIPASS_SESSION_TOKEN is required (see .env)");
}

const cookieHeader = `__Secure-ai_passport_auth.session_token=${SESSION_TOKEN}`;

type OpenAIMessage = { role: string; content: string };

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
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader,
    },
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
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ modelId, messages: toAipassMessages(messages) }),
  });
  if (!res.ok || !res.body) throw new Error(`send-message failed: ${res.status} ${await res.text()}`);
  return res.body;
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
      return Response.json({
        object: "list",
        data: [{ id: "gemini-3.1-flash-lite", object: "model", owned_by: "aipass" }],
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
