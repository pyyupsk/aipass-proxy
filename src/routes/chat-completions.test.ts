import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { conversationsBySessionKey } from "@/sessions/sessions";

const createConversation = vi.fn();
const sendMessage = vi.fn();
const listModels = vi.fn();

vi.mock("@/aipass/client", () => ({
  createConversation: (...args: unknown[]) => createConversation(...args),
  sendMessage: (...args: unknown[]) => sendMessage(...args),
  listModels: (...args: unknown[]) => listModels(...args),
  // Test streams carry their target text as raw bytes, one delta per underlying
  // chunk, instead of the real AI-SDK UI-message-chunk parsing.
  parseAipassStream: async function* (stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      const text = decoder.decode(value);
      if (text) yield text;
    }
  },
}));

const { handleChatCompletions } = await import("./chat-completions");

function chunkedStream(...chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

function textStream(text = "") {
  return text ? chunkedStream(text) : chunkedStream();
}

function parseSseEvents(body: string) {
  return body
    .split("\n\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)));
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

describe("handleChatCompletions streaming", () => {
  const tool = { type: "function" as const, function: { name: "search" } };

  test("streams plain text through as separate deltas with no tools declared", async () => {
    sendMessage.mockResolvedValueOnce([chunkedStream("hello ", "world"), null]);
    const req = chatRequest({ messages: [{ role: "user", content: "hi" }], stream: true }, { "x-session-id": "s1" });

    const res = await handleChatCompletions(req);

    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.choices[0].delta.content ?? null)).toEqual(["hello ", "world", null]);
    expect(events.at(-1).choices[0].finish_reason).toBe("stop");
  });

  test("detects a <tool_call> tag split across multiple stream chunks", async () => {
    sendMessage.mockResolvedValueOnce([chunkedStream("hello ", "<tool_c", 'all>{"name": "search", "arguments": {}}</tool_call>'), null]);
    const req = chatRequest({ messages: [{ role: "user", content: "hi" }], tools: [tool], stream: true }, { "x-session-id": "s1" });

    const res = await handleChatCompletions(req);
    const events = parseSseEvents(await res.text());

    expect(events[0].choices[0].delta.content).toBe("hello ");
    const toolCallEvent = events.find((e) => e.choices[0].delta.tool_calls);
    expect(toolCallEvent.choices[0].delta.tool_calls[0].function).toEqual({ name: "search", arguments: "{}" });
    expect(events.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  test("withholds a trailing fragment that could still become the tag opening", async () => {
    sendMessage.mockResolvedValueOnce([chunkedStream("hello <tool_c"), null]);
    const req = chatRequest({ messages: [{ role: "user", content: "hi" }], tools: [tool], stream: true }, { "x-session-id": "s1" });

    const res = await handleChatCompletions(req);
    const events = parseSseEvents(await res.text());

    // "hello " streams immediately; the trailing "<tool_c" is a candidate tag opening with no
    // closing tag ever arriving, so it's withheld and flushed as plain text once the stream ends.
    expect(events.map((e) => e.choices[0].delta.content ?? null)).toEqual(["hello ", "<tool_c", null]);
    expect(events.at(-1).choices[0].finish_reason).toBe("stop");
  });

  test("falls back to raw text when a streamed tool_call fails to parse", async () => {
    sendMessage.mockResolvedValueOnce([chunkedStream("<tool_call>not json</tool_call>"), null]);
    const req = chatRequest({ messages: [{ role: "user", content: "hi" }], tools: [tool], stream: true }, { "x-session-id": "s1" });

    const res = await handleChatCompletions(req);
    const events = parseSseEvents(await res.text());

    expect(events.map((e) => e.choices[0].delta.content ?? null)).toEqual(["<tool_call>not json</tool_call>", null]);
    expect(events.at(-1).choices[0].finish_reason).toBe("stop");
  });

  test("surfaces an upstream parse failure as a proxy-error chunk instead of hanging", async () => {
    sendMessage.mockResolvedValueOnce([
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("boom"));
        },
      }),
      null,
    ]);
    const req = chatRequest({ messages: [{ role: "user", content: "hi" }], stream: true }, { "x-session-id": "s1" });

    const res = await handleChatCompletions(req);
    const body = await res.text();

    expect(body).toContain("[proxy error] boom");
    expect(body).toContain("data: [DONE]");
  });
});
