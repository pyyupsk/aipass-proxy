import { describe, expect, test } from "vitest";
import { safe, safeWithRetry, toUpstreamError, UpstreamError, upstreamText } from "./safe";

describe("safe", () => {
  test("wraps a successful call as [value, null]", async () => {
    expect(await safe(async () => 42)).toEqual([42, null]);
  });

  test("passes an UpstreamError through unchanged", async () => {
    const err = new UpstreamError("boom", 404);
    expect(await safe(async () => Promise.reject(err))).toEqual([null, err]);
  });

  test("wraps a non-UpstreamError throw as a 502 UpstreamError", async () => {
    const [value, err] = await safe(async () => Promise.reject(new Error("network fail")));
    expect(value).toBeNull();
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err?.status).toBe(502);
    expect(err?.message).toBe("network fail");
  });
});

describe("upstreamText", () => {
  test("returns the body as-is when short", async () => {
    expect(await upstreamText(new Response("short body"))).toBe("short body");
  });

  test("truncates bodies over 300 chars with an ellipsis", async () => {
    const text = await upstreamText(new Response("x".repeat(400)));
    expect(text).toHaveLength(301);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("safeWithRetry", () => {
  test("returns immediately on success without retrying", async () => {
    let calls = 0;
    const result = await safeWithRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toEqual(["ok", null]);
    expect(calls).toBe(1);
  });

  test("does not retry a 403 (deterministic WAF block)", async () => {
    let calls = 0;
    const result = await safeWithRetry(async () => {
      calls++;
      throw new UpstreamError("blocked", 403);
    });
    expect(calls).toBe(1);
    expect(result[1]?.status).toBe(403);
  });

  test("retries a 429 up to the attempt cap, then gives up", async () => {
    let calls = 0;
    const result = await safeWithRetry(async () => {
      calls++;
      throw new UpstreamError("rate limited", 429);
    });
    expect(calls).toBe(3);
    expect(result[1]?.status).toBe(429);
  }, 10000);

  test("retries a 5xx and succeeds once the transient failure clears", async () => {
    let calls = 0;
    const result = await safeWithRetry(async () => {
      calls++;
      if (calls < 3) throw new UpstreamError("upstream down", 503);
      return "recovered";
    });
    expect(calls).toBe(3);
    expect(result).toEqual(["recovered", null]);
  }, 10000);
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

  test("falls back to a fixed message when JSON.stringify can't serialize the value", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const wrapped = toUpstreamError(circular);
    expect(wrapped.status).toBe(500);
    expect(wrapped.message).toBe("unknown error");
  });
});
