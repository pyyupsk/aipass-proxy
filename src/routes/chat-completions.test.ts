import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { conversationsBySessionKey } from "@/sessions/sessions";

const createConversation = vi.fn();
const sendMessage = vi.fn();
const listModels = vi.fn();

vi.mock("@/aipass/client", () => ({
  createConversation: (...args: unknown[]) => createConversation(...args),
  sendMessage: (...args: unknown[]) => sendMessage(...args),
  listModels: (...args: unknown[]) => listModels(...args),
  parseAipassStream: async function* () {},
}));

const { handleChatCompletions } = await import("./chat-completions");

function textStream() {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function chatRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  createConversation.mockReset().mockResolvedValue(["conv-1", null]);
  sendMessage.mockReset().mockResolvedValue([textStream(), null]);
});

afterEach(() => {
  conversationsBySessionKey.clear();
});

describe("handleChatCompletions", () => {
  test("creates a new conversation on first turn and stores full sent count", async () => {
    const req = chatRequest({ messages: [{ role: "user", content: "hi" }] }, { "x-session-id": "s1" });
    await handleChatCompletions(req);

    expect(createConversation).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith("conv-1", "gemini-3.1-flash-lite", [{ role: "user", content: "hi" }]);
    expect(conversationsBySessionKey.get("s1")).toEqual({ conversationId: "conv-1", sentCount: 1 });
  });

  test("reuses the existing conversation and only sends new turns", async () => {
    conversationsBySessionKey.set("s1", { conversationId: "conv-1", sentCount: 1 });
    const req = chatRequest(
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
          { role: "user", content: "again" },
        ],
      },
      { "x-session-id": "s1" },
    );

    await handleChatCompletions(req);

    expect(createConversation).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith("conv-1", "gemini-3.1-flash-lite", [
      { role: "assistant", content: "hello" },
      { role: "user", content: "again" },
    ]);
    expect(conversationsBySessionKey.get("s1")).toEqual({ conversationId: "conv-1", sentCount: 3 });
  });

  test("returns an error response when createConversation fails", async () => {
    const { UpstreamError } = await import("@/lib/safe");
    createConversation.mockResolvedValue([null, new UpstreamError("nope", 502)]);
    const req = chatRequest({ messages: [{ role: "user", content: "hi" }] }, { "x-session-id": "s1" });

    const res = await handleChatCompletions(req);

    expect(res.status).toBe(502);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(conversationsBySessionKey.has("s1")).toBe(false);
  });

  test("rejects a malformed body with a 400", async () => {
    const req = chatRequest({ messages: "not-an-array" }, { "x-session-id": "s1" });
    const res = await handleChatCompletions(req);
    expect(res.status).toBe(400);
  });
});
