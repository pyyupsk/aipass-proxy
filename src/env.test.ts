import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  test("parses key=value lines", () => {
    expect(parseEnv("FOO=bar\nBAZ=qux")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  test("trims whitespace around keys and values", () => {
    expect(parseEnv("FOO = bar \n")).toEqual({ FOO: "bar" });
  });

  test("ignores comment and blank lines", () => {
    expect(parseEnv("# a comment\n\nFOO=bar")).toEqual({ FOO: "bar" });
  });

  test("ignores malformed lines with no =", () => {
    expect(parseEnv("not-a-line\nFOO=bar")).toEqual({ FOO: "bar" });
  });
});

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
});
