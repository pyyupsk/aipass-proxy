#!/usr/bin/env bun
import { installService } from "./cli/service";
import { setup } from "./cli/setup";

async function main() {
  const [, , command] = process.argv;

  // Compiled binaries invoke themselves as `<binary> <command>`; dev runs via `bun run src/cli.ts <command>`.
  const isCompiled = !process.argv[1]?.endsWith(".ts");
  const execCommand = isCompiled ? [process.execPath] : [process.execPath, "run", "src/cli.ts"];

  switch (command) {
    case "setup":
      await setup();
      break;
    case "install-service":
      installService([...execCommand, "start"], process.cwd());
      break;
    case "start":
      await import("./server").then((m) => m.startServer());
      break;
    default:
      console.log("Usage: aipass-proxy <setup|install-service|start>");
      process.exit(command ? 1 : 0);
  }
}

main(); // NOSONAR: top-level entrypoint, unhandled rejection is fine here
