import { ENV_PATH, readEnvFile, writeEnvFile } from "@/env-file";

const BACKSPACE = "\x7f";
const CTRL_C = "\x03";

function promptHidden(label: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(label);
    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();

    let input = "";
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode?.(wasRaw ?? false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (char === CTRL_C) process.exit(130);
        if (char === BACKSPACE || char === "\b") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        input += char;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

export async function setup() {
  const existing = readEnvFile();

  const token = await promptHidden(`AIPass session token${existing.AIPASS_SESSION_TOKEN ? " (leave blank to keep current)" : ""}: `);
  const port = prompt(`Port (leave blank for default ${existing.PORT ?? "47871"}):`) ?? "";

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
