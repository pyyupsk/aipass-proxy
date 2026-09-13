import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UpstreamError } from "@/lib/safe";

vi.mock("@/env", () => ({ ENV_PATH: "/fake/.env", SESSION_TOKEN: "fake-token" }));

const { createConversation, listModels, parseAipassStream, sendMessage } = await import("./client");

function jsonResponse(body: unknown, contentType = "application/json") {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": contentType } });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createConversation", () => {
  test("succeeds on a normal response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(["conversationId", "conv-1"], "text/x-script"));
    const [id, err] = await createConversation("model", "hi");
    expect(err).toBeNull();
    expect(id).toBe("conv-1");
  });

  test("surfaces a 401 when the session has expired", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(["error", "Authentication required"], "text/x-script"));
    const [id, err] = await createConversation("model", "hi");
    expect(id).toBeNull();
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err?.status).toBe(401);
    expect(err?.message).toContain("session expired");
  });
});

describe("listModels", () => {
  test("succeeds on a normal response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: [{ id: "gemini-3.1-flash-lite" }] }));
    const [models, err] = await listModels();
    expect(err).toBeNull();
    expect(models).toEqual([{ id: "gemini-3.1-flash-lite" }]);
  });

  test("surfaces a 401 when the session has expired", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: { code: "UNAUTHORIZED" } }));
    const [models, err] = await listModels();
    expect(models).toBeNull();
    expect(err?.status).toBe(401);
  });
});

describe("parseAipassStream", () => {
  function chunkStream(deltas: string[]) {
    const chunks = [{ type: "text-start", id: "1" }, ...deltas.map((delta) => ({ type: "text-delta", id: "1", delta }))];
    return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")).body as ReadableStream<Uint8Array>;
  }

  async function collect(deltas: string[]) {
    let text = "";
    for await (const delta of parseAipassStream(chunkStream(deltas))) text += delta;
    return text;
  }

  test("yields the text deltas the stream carries", async () => {
    expect(await collect(["hello ", "world"])).toBe("hello world");
  });

  test("strips an inserted marker that straddles two deltas", async () => {
    expect(await collect(["ok .", "​/src works"])).toBe("ok ./src works");
    expect(await collect(["ok ..", "​", "/src"])).toBe("ok ../src");
  });

  test("emits a trailing dot that never became a marker", async () => {
    expect(await collect(["done."])).toBe("done.");
  });
});

describe("sendMessage", () => {
  function streamResponse() {
    return new Response(new ReadableStream(), { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  test("returns the body stream on a normal response", async () => {
    vi.mocked(fetch).mockResolvedValue(streamResponse());
    const [stream, err] = await sendMessage("conv-1", "model", []);
    expect(err).toBeNull();
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  test("surfaces a 401 when the session has expired", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "User not authenticated" }));
    const [stream, err] = await sendMessage("conv-1", "model", []);
    expect(stream).toBeNull();
    expect(err?.status).toBe(401);
    expect(err?.message).toContain("session expired");
  });
});
