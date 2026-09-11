import { describe, expect, test } from "vitest";
import { openaiChunk, openaiToolCallChunk, safeToEmitLength, TOOL_CALL_OPEN_TAG } from "./stream";

describe("openaiChunk", () => {
  test("shapes an SSE data line with the content delta", () => {
    const chunk = openaiChunk("id-1", "gpt", "hello", null);
    expect(chunk.startsWith("data: ")).toBe(true);
    expect(chunk.endsWith("\n\n")).toBe(true);
    const payload = JSON.parse(chunk.slice("data: ".length));
    expect(payload.choices[0].delta).toEqual({ content: "hello" });
    expect(payload.choices[0].finish_reason).toBeNull();
  });

  test("omits content and sets finish_reason when finishing", () => {
    const chunk = openaiChunk("id-1", "gpt", "", "stop");
    const payload = JSON.parse(chunk.slice("data: ".length));
    expect(payload.choices[0].delta).toEqual({});
    expect(payload.choices[0].finish_reason).toBe("stop");
  });
});

describe("openaiToolCallChunk", () => {
  test("emits an indexed tool_calls delta followed by a finish chunk", () => {
    const chunk = openaiToolCallChunk("id-1", "gpt", [
      { name: "a", arguments: {} },
      { name: "b", arguments: {} },
    ]);
    const [first, second] = chunk.trim().split("\n\n");
    const firstPayload = JSON.parse((first ?? "").slice("data: ".length));
    expect(firstPayload.choices[0].delta.tool_calls.map((c: { index: number }) => c.index)).toEqual([0, 1]);
    const secondPayload = JSON.parse((second ?? "").slice("data: ".length));
    expect(secondPayload.choices[0].finish_reason).toBe("tool_calls");
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
