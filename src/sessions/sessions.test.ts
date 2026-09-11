import { afterEach, describe, expect, test } from "vitest";
import type { OpenAIMessage } from "@/openai/types";
import { conversationsBySessionKey, evictOldestSessionIfFull, sessionKey } from "./sessions";

afterEach(() => {
  conversationsBySessionKey.clear();
});

describe("sessionKey", () => {
  test("uses the x-session-id header when present", () => {
    const req = new Request("http://localhost", { headers: { "x-session-id": "abc" } });
    expect(sessionKey(req, [{ role: "user", content: "hi" }])).toBe("abc");
  });

  test("falls back to hashing the first message when no header is set", () => {
    const req = new Request("http://localhost");
    const messages: OpenAIMessage[] = [{ role: "user", content: "hi" }];
    expect(sessionKey(req, messages)).toBe(JSON.stringify(messages[0]));
  });
});

describe("evictOldestSessionIfFull", () => {
  test("does nothing while under the cap", () => {
    conversationsBySessionKey.set("a", { conversationId: "1", sentCount: 0 });
    evictOldestSessionIfFull();
    expect(conversationsBySessionKey.has("a")).toBe(true);
  });

  test("evicts the oldest (first-inserted) entry once full", () => {
    for (let i = 0; i < 500; i++) {
      conversationsBySessionKey.set(`key-${i}`, { conversationId: String(i), sentCount: 0 });
    }
    expect(conversationsBySessionKey.has("key-0")).toBe(true);
    evictOldestSessionIfFull();
    expect(conversationsBySessionKey.has("key-0")).toBe(false);
    expect(conversationsBySessionKey.has("key-1")).toBe(true);
    expect(conversationsBySessionKey.size).toBe(499);
  });
});
