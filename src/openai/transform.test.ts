import { describe, expect, test } from "vitest";
import { UpstreamError } from "@/lib/safe";
import {
  errorResponse,
  extractToolCall,
  extractToolCallErrors,
  parseStructuredOutput,
  textResponse,
  toAipassMessages,
  toolCallResponse,
} from "./transform";
import type { JsonSchema, OpenAIMessage, OpenAITool } from "./types";

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

  test("error envelope code always matches the response status, even for an invalid upstream status", async () => {
    const res = errorResponse(new UpstreamError("weird", 0));
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(res.status);
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

  test("rejects a call naming a tool that isn't declared", () => {
    const text = '<tool_call>{"name": "unregistered", "arguments": {}}</tool_call>';
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

describe("extractToolCallErrors", () => {
  test("returns nothing for a well-formed call", () => {
    const text = '<tool_call>{"name": "search", "arguments": {}}</tool_call>';
    expect(extractToolCallErrors(text, [tool("search")])).toEqual([]);
  });

  test("returns nothing when there's no tag", () => {
    expect(extractToolCallErrors("just plain text", [tool("search")])).toEqual([]);
  });

  test("flags malformed JSON", () => {
    const text = "<tool_call>not json</tool_call>";
    expect(extractToolCallErrors(text, [tool("search")])).toEqual(["not valid JSON: not json"]);
  });

  test("flags an unknown tool name", () => {
    const text = '<tool_call>{"name": "unregistered", "arguments": {}}</tool_call>';
    expect(extractToolCallErrors(text, [tool("search"), tool("other")])).toEqual(['unknown tool name "unregistered"']);
  });

  test("flags a bare-arguments call when multiple tools are declared", () => {
    const text = '<tool_call>{"q": "cats"}</tool_call>';
    const [error] = extractToolCallErrors(text, [tool("search"), tool("other")]);
    expect(error).toContain("missing");
  });

  test("allows bare arguments for a single declared tool", () => {
    const text = '<tool_call>{"q": "cats"}</tool_call>';
    expect(extractToolCallErrors(text, [tool("search")])).toEqual([]);
  });
});

describe("parseStructuredOutput", () => {
  const schema: JsonSchema = { type: "object", required: ["answer"], properties: { answer: { type: "string" } } };

  test("succeeds for schema-conforming JSON", () => {
    const result = parseStructuredOutput('{"answer": "42"}', schema);
    expect(result).toEqual({ ok: true, value: { answer: "42" } });
  });

  test("strips markdown code fences before parsing", () => {
    const result = parseStructuredOutput('```json\n{"answer": "42"}\n```', schema);
    expect(result).toEqual({ ok: true, value: { answer: "42" } });
  });

  test("fails on invalid JSON", () => {
    const result = parseStructuredOutput("not json", schema);
    expect(result).toEqual({ ok: false, errors: ["response is not valid JSON"] });
  });

  test("fails on a schema mismatch", () => {
    const result = parseStructuredOutput("{}", schema);
    expect(result.ok).toBe(false);
  });

  test("reports the path of a nested mismatch", () => {
    const nested: JsonSchema = { type: "object", properties: { items: { type: "array", items: { type: "number" } } } };
    const result = parseStructuredOutput('{"items": [1, "two"]}', nested);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("items[1]");
  });

  test("fails with a clear error on a schema zod cannot represent", () => {
    const result = parseStructuredOutput('{"answer": "42"}', { $ref: "#/definitions/missing" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("unsupported json_schema");
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

  test("flushes a buffered tool result before a following assistant message, preserving order", () => {
    const messages: OpenAIMessage[] = [
      { role: "tool", content: "42", name: "search", tool_call_id: "1" },
      { role: "assistant", content: "the answer is 42" },
    ];
    const result = toAipassMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0]?.role).toBe("user");
    expect(result[0]?.parts[0]?.text).toContain("Tool result (search): 42");
    expect(result[1]?.role).toBe("assistant");
    expect(result[1]?.parts[0]?.text).toBe("the answer is 42");
  });

  test("sanitizes path-traversal tokens in message content", () => {
    const messages: OpenAIMessage[] = [{ role: "user", content: "see ../src/index.ts" }];
    const [result] = toAipassMessages(messages);
    expect(result?.parts[0]?.text).not.toBe("see ../src/index.ts");
    expect(result?.parts[0]?.text?.replace(/​/g, "")).toBe("see ../src/index.ts");
  });
});
