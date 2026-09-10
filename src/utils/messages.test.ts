import { describe, expect, test } from "vitest";
import type { OpenAIMessage } from "@/types";
import { toAipassMessages } from "./messages";

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
