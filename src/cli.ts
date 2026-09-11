#!/usr/bin/env bun
import { installService } from "./cli/service";
import { setup } from "./cli/setup";

const [, , command] = process.argv;

switch (command) {
  case "setup":
    setup();
    break;
  case "install-service":
    installService(process.execPath, process.cwd());
    break;
  default:
    console.log("Usage: aipass-proxy <setup|install-service>");
    process.exit(command ? 1 : 0);
}
