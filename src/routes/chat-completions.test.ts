import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { conversationsBySessionKey } from "@/sessions/sessions";

const createConversation = vi.fn();
const sendMessage = vi.fn();
const listModels = vi.fn();

vi.mock("@/aipass/client", () => ({
  createConversation: (...args: unknown[]) => createConversation(...args),
  sendMessage: (...args: unknown[]) => sendMessage(...args),
  listModels: (...args: unknown[]) => listModels(...args),
  // Test streams carry their target text as raw bytes; decode instead of the
  // real AI-SDK UI-message-chunk parsing.
  parseAipassStream: async function* (stream: ReadableStream<Uint8Array>) {
    const text = await new Response(stream).text();
    if (text) yield text;
  },
}));

const { handleChatCompletions } = await import("./chat-completions");

function textStream(text = "") {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (text) controller.enqueue(new TextEncoder().encode(text));
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

describe("handleChatCompletions structured output", () => {
  const tool = { type: "function" as const, function: { name: "search" } };

  test("retries once and succeeds when a tool_call is malformed then corrected", async () => {
    sendMessage
      .mockResolvedValueOnce([textStream("<tool_call>not json</tool_call>"), null])
      .mockResolvedValueOnce([textStream('<tool_call>{"name": "search", "arguments": {}}</tool_call>'), null]);
    const req = chatRequest({ messages: [{ role: "user", content: "hi" }], tools: [tool] }, { "x-session-id": "s1" });

    const res = await handleChatCompletions(req);
    const body = (await res.json()) as { choices: [{ message: { tool_calls?: unknown[] } }] };

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
  });

  test("falls back to plain text when the retried tool_call is still invalid", async () => {
    sendMessage
      .mockResolvedValueOnce([textStream("<tool_call>not json</tool_call>"), null])
      .mockResolvedValueOnce([textStream("still no valid call"), null]);
    const req = chatRequest({ messages: [{ role: "user", content: "hi" }], tools: [tool] }, { "x-session-id": "s1" });

    const res = await handleChatCompletions(req);
    const body = (await res.json()) as { choices: [{ message: { content: string | null } }] };

    expect(body.choices[0].message.content).toBe("still no valid call");
  });

  test("returns schema-conforming JSON for a json_schema response_format", async () => {
    sendMessage.mockResolvedValueOnce([textStream('{"answer": "42"}'), null]);
    const req = chatRequest(
      {
        messages: [{ role: "user", content: "what is the answer?" }],
        response_format: { type: "json_schema", json_schema: { schema: { type: "object", required: ["answer"] } } },
      },
      { "x-session-id": "s1" },
    );

    const res = await handleChatCompletions(req);
    const body = (await res.json()) as { choices: [{ message: { content: string } }] };

    expect(JSON.parse(body.choices[0].message.content)).toEqual({ answer: "42" });
  });

  test("rejects response_format combined with stream: true", async () => {
    const req = chatRequest(
      {
        messages: [{ role: "user", content: "hi" }],
        stream: true,
        response_format: { type: "json_schema", json_schema: { schema: { type: "object" } } },
      },
      { "x-session-id": "s1" },
    );

    const res = await handleChatCompletions(req);

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("retries once then surfaces an error when the schema still doesn't match", async () => {
    sendMessage.mockResolvedValueOnce([textStream("{}"), null]).mockResolvedValueOnce([textStream("{}"), null]);
    const req = chatRequest(
      {
        messages: [{ role: "user", content: "what is the answer?" }],
        response_format: { type: "json_schema", json_schema: { schema: { type: "object", required: ["answer"] } } },
      },
      { "x-session-id": "s1" },
    );

    const res = await handleChatCompletions(req);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(502);
  });
});
