import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installService } from "./service";

describe("installService", () => {
  let tmpHome: string;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(os.tmpdir(), "aipass-proxy-test-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, "platform", { value: platform });
  }

  test("writes a systemd unit file on linux", () => {
    setPlatform("linux");
    const unitPath = installService(["/usr/bin/aipass-proxy", "start"], "/work/dir");

    expect(unitPath).toBe(path.join(tmpHome, ".config/systemd/user/aipass-proxy.service"));
    const content = readFileSync(unitPath, "utf8");
    expect(content).toContain("WorkingDirectory=/work/dir");
    expect(content).toContain("ExecStart=/usr/bin/aipass-proxy start");
  });

  test("writes a launchd plist on darwin", () => {
    setPlatform("darwin");
    const plistPath = installService(["/usr/bin/aipass-proxy", "start"], "/work/dir");

    expect(plistPath).toBe(path.join(tmpHome, "Library/LaunchAgents/com.aipass-proxy.plist"));
    const content = readFileSync(plistPath, "utf8");
    expect(content).toContain("<string>/usr/bin/aipass-proxy</string>");
    expect(content).toContain("<string>/work/dir</string>");
  });

  test("exits with an error on an unsupported platform", () => {
    setPlatform("win32");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    installService(["/usr/bin/aipass-proxy", "start"], "/work/dir");

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("win32"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
