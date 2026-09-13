import { describe, expect, test } from "vitest";
import { openaiChunk, openaiToolCallChunks, safeToEmitLength, TOOL_CALL_OPEN_TAG } from "./stream";

describe("openaiChunk", () => {
  test("shapes a chunk envelope with the content delta", () => {
    const chunk = openaiChunk("id-1", "gpt", "hello", null);
    expect(chunk.object).toBe("chat.completion.chunk");
    expect(chunk.choices[0]?.delta).toEqual({ content: "hello" });
    expect(chunk.choices[0]?.finish_reason).toBeNull();
  });

  test("omits content and sets finish_reason when finishing", () => {
    const chunk = openaiChunk("id-1", "gpt", "", "stop");
    expect(chunk.choices[0]?.delta).toEqual({});
    expect(chunk.choices[0]?.finish_reason).toBe("stop");
  });
});

describe("openaiToolCallChunks", () => {
  test("emits an indexed tool_calls delta followed by a finish chunk", () => {
    const [first, second] = openaiToolCallChunks("id-1", "gpt", [
      { name: "a", arguments: {} },
      { name: "b", arguments: {} },
    ]);
    const delta = first?.choices[0]?.delta as { tool_calls: { index: number }[] };
    expect(delta.tool_calls.map((c) => c.index)).toEqual([0, 1]);
    expect(second?.choices[0]?.finish_reason).toBe("tool_calls");
  });
});

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
