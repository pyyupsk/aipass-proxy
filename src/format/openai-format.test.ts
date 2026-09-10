import { describe, expect, test } from "vitest";
import { UpstreamError } from "@/utils/result";
import { errorResponse, openaiChunk, openaiToolCallChunk, textResponse, toolCallResponse, toUpstreamError } from "./openai-format";

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

describe("toUpstreamError", () => {
  test("passes an existing UpstreamError through unchanged", () => {
    const err = new UpstreamError("boom", 429);
    expect(toUpstreamError(err)).toBe(err);
  });

  test("wraps a plain Error as a 500 UpstreamError", () => {
    const wrapped = toUpstreamError(new Error("oops"));
    expect(wrapped).toBeInstanceOf(UpstreamError);
    expect(wrapped.status).toBe(500);
    expect(wrapped.message).toBe("oops");
  });

  test("wraps a non-Error thrown value as a 500 UpstreamError", () => {
    const wrapped = toUpstreamError("string throw");
    expect(wrapped.status).toBe(500);
    expect(wrapped.message).toBe('"string throw"');
  });
});
