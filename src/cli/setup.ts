import { ENV_PATH, readEnvFile, writeEnvFile } from "@/env-file";

export function setup() {
  const existing = readEnvFile();

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

  writeEnvFile(next);
  console.log(`Wrote ${ENV_PATH}`);
}
