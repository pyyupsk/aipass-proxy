import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema } from "ai";
import { AIPASS_BASE, baseHeaders } from "../config";
import { toAipassMessages } from "../utils/messages";
import { type Result, safeWithRetry, UpstreamError, upstreamText } from "../utils/result";
import { sanitizeOutbound, stripZeroWidthSpace } from "../utils/sanitize";
import type { AipassModel, OpenAIMessage } from "../types";

export async function createConversation(modelId: string, firstMessage: string): Promise<Result<string>> {
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

export async function sendMessage(
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

export async function listModels(): Promise<Result<AipassModel[]>> {
  return safeWithRetry(async () => {
    const res = await fetch(`${AIPASS_BASE}/loaders/list-models`, { headers: baseHeaders });
    if (!res.ok) throw new UpstreamError(`list-models failed: ${await upstreamText(res)}`, res.status);
    const body = (await res.json()) as { data: AipassModel[] };
    return body.data.filter((m) => !NON_CHAT_MODEL.test(m.id));
  });
}

// AIPass streams the AI SDK's UI-message-chunk protocol.
export async function* parseAipassStream(stream: ReadableStream<Uint8Array>) {
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
