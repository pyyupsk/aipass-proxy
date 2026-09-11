import { describe, expect, test } from "vitest";
import { UpstreamError } from "@/lib/safe";
import { errorResponse, extractToolCall, textResponse, toAipassMessages, toolCallResponse } from "./transform";
import type { OpenAIMessage, OpenAITool } from "./types";

type ChatCompletionBody = {
  choices: [
    {
      message: { role: string; content: string | null; tool_calls?: { function: { name: string; arguments: string } }[] };
      finish_reason: string;
    },
  ];
};

describe("textResponse", () => {
  test("shapes a non-streaming completion with the given content", async () => {
    const res = textResponse("id-1", "gpt", "hi there");
    const body = (await res.json()) as ChatCompletionBody;
    expect(body.choices[0].message).toEqual({ role: "assistant", content: "hi there" });
    expect(body.choices[0].finish_reason).toBe("stop");
  });
});

describe("toolCallResponse", () => {
  test("shapes a non-streaming tool-call completion", async () => {
    const res = toolCallResponse("id-1", "gpt", [{ name: "search", arguments: { q: "cats" } }]);
    const body = (await res.json()) as ChatCompletionBody;
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
    expect(body.choices[0].message.tool_calls?.[0]?.function).toEqual({ name: "search", arguments: '{"q":"cats"}' });
    expect(body.choices[0].finish_reason).toBe("tool_calls");
  });
});

describe("errorResponse", () => {
  test("uses the upstream status when it's a valid HTTP error code", async () => {
    const res = errorResponse(new UpstreamError("not found", 404));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string; type: string; code: number } };
    expect(body.error).toEqual({ message: "not found", type: "upstream_error", code: 404 });
  });

  test("falls back to 502 for a non-HTTP status", () => {
    const res = errorResponse(new UpstreamError("weird", 0));
    expect(res.status).toBe(502);
  });
});

const tool = (name: string): OpenAITool => ({ type: "function", function: { name } });

describe("extractToolCall", () => {
  test("parses a well-formed {name, arguments} call", () => {
    const text = '<tool_call>{"name": "search", "arguments": {"q": "cats"}}</tool_call>';
    expect(extractToolCall(text, [tool("search")])).toEqual([{ name: "search", arguments: { q: "cats" } }]);
  });

  test("parses multiple back-to-back calls", () => {
    const text = '<tool_call>{"name": "a", "arguments": {}}</tool_call>' + '<tool_call>{"name": "b", "arguments": {}}</tool_call>';
    expect(extractToolCall(text, [tool("a"), tool("b")])).toEqual([
      { name: "a", arguments: {} },
      { name: "b", arguments: {} },
    ]);
  });

  test("falls back to the single tool for bare arguments", () => {
    const text = '<tool_call>{"q": "cats"}</tool_call>';
    expect(extractToolCall(text, [tool("search")])).toEqual([{ name: "search", arguments: { q: "cats" } }]);
  });

  test("ignores bare arguments when multiple tools are available", () => {
    const text = '<tool_call>{"q": "cats"}</tool_call>';
    expect(extractToolCall(text, [tool("search"), tool("other")])).toEqual([]);
  });

  test("skips malformed JSON", () => {
    const text = "<tool_call>not json</tool_call>";
    expect(extractToolCall(text, [tool("search")])).toEqual([]);
  });

  test("returns nothing when there's no tag", () => {
    expect(extractToolCall("just plain text", [tool("search")])).toEqual([]);
  });
});

describe("toAipassMessages", () => {
  test("passes plain user/assistant turns through unchanged", () => {
    const messages: OpenAIMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const result = toAipassMessages(messages);
    expect(result.map((m) => ({ role: m.role, text: m.parts[0]?.text }))).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ]);
  });

  test("folds an assistant tool_calls message into <tool_call> tags", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "1", type: "function", function: { name: "search", arguments: '{"q":"cats"}' } }],
      },
    ];
    const [result] = toAipassMessages(messages);
    expect(result?.role).toBe("assistant");
    expect(result?.parts[0]?.text).toBe('<tool_call>{"name":"search","arguments":{"q":"cats"}}</tool_call>');
  });

  test("wraps a tool result as a system message merged into the next user turn", () => {
    const messages: OpenAIMessage[] = [
      { role: "tool", content: "42", name: "search", tool_call_id: "1" },
      { role: "user", content: "what's the answer?" },
    ];
    const result = toAipassMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe("user");
    expect(result[0]?.parts[0]?.text).toContain("Tool result (search): 42");
    expect(result[0]?.parts[0]?.text).toContain("what's the answer?");
  });

  test("merges consecutive system messages into one buffer before the next user turn", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "rule one" },
      { role: "system", content: "rule two" },
      { role: "user", content: "go" },
    ];
    const result = toAipassMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]?.parts[0]?.text).toBe("rule one\n\nrule two\n\ngo");
  });

  test("emits trailing system content as its own user turn if nothing follows", () => {
    const messages: OpenAIMessage[] = [
      { role: "user", content: "go" },
      { role: "system", content: "final note" },
    ];
    const result = toAipassMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[1]?.role).toBe("user");
    expect(result[1]?.parts[0]?.text).toBe("final note");
  });

  test("sanitizes path-traversal tokens in message content", () => {
    const messages: OpenAIMessage[] = [{ role: "user", content: "see ../src/index.ts" }];
    const [result] = toAipassMessages(messages);
    expect(result?.parts[0]?.text).not.toBe("see ../src/index.ts");
    expect(result?.parts[0]?.text?.replace(/​/g, "")).toBe("see ../src/index.ts");
  });
});
