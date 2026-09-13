import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("readEnvFile / writeEnvFile", () => {
  let tmpDir: string;
  let originalXdg: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "aipass-proxy-env-test-"));
    originalXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("readEnvFile returns an empty object when no file exists", async () => {
    vi.resetModules();
    const { readEnvFile } = await import("./env");
    expect(readEnvFile()).toEqual({});
  });

  test("writeEnvFile then readEnvFile round-trips the values", async () => {
    vi.resetModules();
    const { readEnvFile, writeEnvFile } = await import("./env");
    writeEnvFile({ AIPASS_SESSION_TOKEN: "secret", PORT: "1234" });
    expect(readEnvFile()).toEqual({ AIPASS_SESSION_TOKEN: "secret", PORT: "1234" });
  });

  test("round-trips values holding a #, a quote or trailing spaces", async () => {
    vi.resetModules();
    const { readEnvFile, writeEnvFile } = await import("./env");
    const vars = { HASH: "tok#en", QUOTED: 'a"b', PADDED: "trailing  " };
    writeEnvFile(vars);
    expect(readEnvFile()).toEqual(vars);
  });
});
