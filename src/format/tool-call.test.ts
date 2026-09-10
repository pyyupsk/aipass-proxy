import { describe, expect, test } from "vitest";
import type { OpenAITool } from "@/types";
import { extractToolCall, safeToEmitLength, TOOL_CALL_OPEN_TAG } from "./tool-call";

const tool = (name: string): OpenAITool => ({ type: "function", function: { name } });

describe("safeToEmitLength", () => {
  test("emits everything when no overlap with the tag", () => {
    expect(safeToEmitLength("hello world", TOOL_CALL_OPEN_TAG)).toBe("hello world".length);
  });

  test("withholds a trailing fragment that could become the tag", () => {
    expect(safeToEmitLength("hello <tool_c", TOOL_CALL_OPEN_TAG)).toBe("hello ".length);
  });

  test("withholds the whole buffer when it's a prefix of the tag", () => {
    expect(safeToEmitLength("<tool", TOOL_CALL_OPEN_TAG)).toBe(0);
  });

  test("doesn't withhold a fragment that only partially matches", () => {
    expect(safeToEmitLength("hello <tool_x", TOOL_CALL_OPEN_TAG)).toBe("hello <tool_x".length);
  });
});

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
