import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const ENV_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "aipass-proxy");
export const ENV_PATH = path.join(ENV_DIR, ".env");

const ENV_LINE = /^([^#=]+)=(.*)$/;

export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = ENV_LINE.exec(line);
    if (match?.[1] && match[2] !== undefined) out[match[1].trim()] = match[2].trim();
  }
  return out;
}

export function readEnvFile(): Record<string, string> {
  return existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, "utf8")) : {};
}

export function writeEnvFile(vars: Record<string, string>): void {
  mkdirSync(ENV_DIR, { recursive: true, mode: 0o700 });
  const content = `${Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;
  writeFileSync(ENV_PATH, content, { mode: 0o600 });
  chmodSync(ENV_PATH, 0o600);
}
