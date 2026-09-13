import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

export const ENV_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "aipass-proxy");
export const ENV_PATH = path.join(ENV_DIR, ".env");

export function readEnvFile(): Record<string, string> {
  return existsSync(ENV_PATH) ? (parseEnv(readFileSync(ENV_PATH, "utf8")) as Record<string, string>) : {};
}

// parseEnv strips one layer of quotes and has no escape syntax, so an unquoted value
// loses everything from a "#" on, plus trailing spaces. Quote with a character the
// value itself doesn't use. A value holding both quote characters isn't representable.
function quoteEnvValue(value: string): string {
  return value.includes('"') ? `'${value}'` : `"${value}"`;
}

export function writeEnvFile(vars: Record<string, string>): void {
  mkdirSync(ENV_DIR, { recursive: true, mode: 0o700 });
  const content = `${Object.entries(vars)
    .map(([k, v]) => `${k}=${quoteEnvValue(v)}`)
    .join("\n")}\n`;
  writeFileSync(ENV_PATH, content, { mode: 0o600 });
  chmodSync(ENV_PATH, 0o600);
}

const env = { ...readEnvFile(), ...process.env };
const parsedPort = Number(env.PORT);

export const SESSION_TOKEN = env.AIPASS_SESSION_TOKEN;
export const PORT = env.PORT !== undefined && Number.isFinite(parsedPort) ? parsedPort : 47871;
