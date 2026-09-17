# aipass-proxy

OpenAI-compatible chat-completions proxy in front of [AIPass](https://de.aipass.net) — point any OpenAI-compatible client (opencode, etc.) at it and use AIPass's models through the standard `/v1/chat/completions` and `/v1/models` API.

> [!WARNING]
> AiPASS's [terms and conditions](https://aipass.go.th/term-and-cond-th) (§3.4) prohibit directly accessing, connecting to, or using the platform's API, API key, or token outside the official UI — which is exactly what this proxy does. Using it may violate those terms and risk suspension of your AiPASS account. This is not legal advice; read the terms yourself before using this project.

## Install

```sh
curl -sL https://fasu.dev/aipass-proxy | bash
```

Detects your OS/arch and installs the latest binary to `~/.local/bin` (override with `INSTALL_DIR=...`, pin a release with `VERSION=vX.Y.Z ...`). No clone, no Bun/Node install required.

Prebuilt binaries are also available directly from [Releases](https://github.com/pyyupsk/aipass-proxy/releases/latest): `aipass-proxy-linux-x64`, `aipass-proxy-linux-arm64`, `aipass-proxy-darwin-x64`, `aipass-proxy-darwin-arm64`.

## Setup

```sh
aipass-proxy setup
```

Prompts for:

- **AIPass session token** — the `__Secure-ai_passport_auth.session_token` cookie value from an authenticated [de.aipass.net](https://de.aipass.net) browser session (DevTools → Application/Storage → Cookies). Input is masked while typing.
- **Port** — leave blank for the default `47871`.

Writes `~/.config/aipass-proxy/.env`, locked to `chmod 600` (readable only by you).

## Run

```sh
aipass-proxy start
```

Runs in the foreground on `http://localhost:47871` (or your configured port).

### Run as a background service

```sh
aipass-proxy install-service
```

One-time setup: generates a systemd user unit (Linux) or launchd agent (macOS), then prints the command to enable it:

```sh
systemctl --user enable --now aipass-proxy   # Linux
launchctl load ~/Library/LaunchAgents/com.aipass-proxy.plist   # macOS
```

Once enabled it starts on login and restarts automatically on failure — no need to run `aipass-proxy start` manually again.

## Use it

```sh
curl http://localhost:47871/v1/models

curl http://localhost:47871/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.1-flash-lite","messages":[{"role":"user","content":"hello"}]}'
```

Or point an OpenAI-compatible client (e.g. opencode) at `http://localhost:47871/v1` as a custom provider base URL.

## Updating

```sh
curl -sL https://fasu.dev/aipass-proxy | bash -s update
```

## Uninstalling

```sh
curl -sL https://fasu.dev/aipass-proxy | bash -s uninstall
```

Removes the binary and any installed systemd/launchd service unit. Stop the running service first (`systemctl --user disable --now aipass-proxy` or `launchctl unload ~/Library/LaunchAgents/com.aipass-proxy.plist`).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for running from source, building the binary, and the codebase structure.
