#!/usr/bin/env bun
import { installService } from "./cli/service";
import { setup } from "./cli/setup";

const [, , command] = process.argv;

// Compiled binaries invoke themselves as `<binary> <command>`; dev runs via `bun run src/cli.ts <command>`.
const isCompiled = !process.argv[1]?.endsWith(".ts");
const execCommand = isCompiled ? [process.execPath] : [process.execPath, "run", "src/cli.ts"];

switch (command) {
  case "setup":
    setup();
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
