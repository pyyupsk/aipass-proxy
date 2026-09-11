import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ENV_PATH = path.resolve(process.cwd(), ".env");
const ENV_LINE = /^([^#=]+)=(.*)$/;

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = ENV_LINE.exec(line);
    if (match?.[1] && match[2] !== undefined) out[match[1].trim()] = match[2].trim();
  }
  return out;
}

function serializeEnv(vars: Record<string, string>): string {
  return `${Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;
}

export function setup() {
  const existing = existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, "utf8")) : {};

  const token = prompt(`AIPass session token${existing.AIPASS_SESSION_TOKEN ? " (leave blank to keep current)" : ""}:`) ?? "";
  const port = prompt(`Port [${existing.PORT ?? "47871"}]:`) ?? "";

  const next = {
    ...existing,
    AIPASS_SESSION_TOKEN: token.trim() || existing.AIPASS_SESSION_TOKEN || "",
    PORT: port.trim() || existing.PORT || "47871",
  };
  if (!next.AIPASS_SESSION_TOKEN) {
    console.error("AIPASS_SESSION_TOKEN is required — get it from the __Secure-ai_passport_auth.session_token cookie in your browser.");
    process.exit(1);
  }

  writeFileSync(ENV_PATH, serializeEnv(next));
  console.log(`Wrote ${ENV_PATH}`);
}
