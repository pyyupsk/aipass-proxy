import { describe, expect, test } from "vitest";
import { sanitizeOutbound, stripZeroWidthSpace } from "./sanitize";

describe("sanitizeOutbound", () => {
  test("breaks relative-path tokens with a zero-width space", () => {
    expect(sanitizeOutbound("./foo")).not.toBe("./foo");
    expect(sanitizeOutbound("../foo")).not.toBe("../foo");
  });

  test("leaves text without path tokens untouched", () => {
    expect(sanitizeOutbound("hello world")).toBe("hello world");
  });

  test("round-trips through stripZeroWidthSpace", () => {
    const text = "see ../src/index.ts and ./README.md";
    expect(stripZeroWidthSpace(sanitizeOutbound(text))).toBe(text);
  });
});

describe("stripZeroWidthSpace", () => {
  test("is a no-op on text without zero-width spaces", () => {
    expect(stripZeroWidthSpace("plain text")).toBe("plain text");
  });

  test("preserves an unrelated zero-width space outside the inserted marker pattern", () => {
    const text = "wordbreak​here";
    expect(stripZeroWidthSpace(text)).toBe(text);
  });
});
