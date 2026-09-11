import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function systemdUnit(command: string[], workingDir: string) {
  return `[Unit]
Description=aipass-proxy

[Service]
WorkingDirectory=${workingDir}
ExecStart=${command.join(" ")}
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

function launchdPlist(command: string[], workingDir: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.aipass-proxy</string>
  <key>ProgramArguments</key>
  <array>${command.map((arg) => `<string>${arg}</string>`).join("")}</array>
  <key>WorkingDirectory</key><string>${workingDir}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
`;
}

// Generates an OS-native service unit that runs `command` from `workingDir`
// (Bun auto-loads .env there) instead of hand-rolling process daemonization.
export function installService(command: string[], workingDir: string) {
  if (process.platform === "linux") {
    const dir = path.join(os.homedir(), ".config/systemd/user");
    mkdirSync(dir, { recursive: true });
    const unitPath = path.join(dir, "aipass-proxy.service");
    writeFileSync(unitPath, systemdUnit(command, workingDir));
    console.log(`Wrote ${unitPath}`);
    console.log("Run:\n  systemctl --user enable --now aipass-proxy");
    return unitPath;
  }
  if (process.platform === "darwin") {
    const dir = path.join(os.homedir(), "Library/LaunchAgents");
    mkdirSync(dir, { recursive: true });
    const plistPath = path.join(dir, "com.aipass-proxy.plist");
    writeFileSync(plistPath, launchdPlist(command, workingDir));
    console.log(`Wrote ${plistPath}`);
    console.log(`Run:\n  launchctl load ${plistPath}`);
    return plistPath;
  }
  console.error(`No native service manager wired up for platform "${process.platform}" — run it manually or use a process manager.`);
  process.exit(1);
}
