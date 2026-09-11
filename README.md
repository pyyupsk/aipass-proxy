# aipass-proxy

OpenAI-compatible proxy in front of Aipass.

## Structure

```tree
src/
  index.ts                # entrypoint (Bun.serve)
  config.ts               # env/const config
  types.ts                # shared types + zod request schemas
  cli.ts                  # aipass-proxy CLI entrypoint
  cli/
    setup.ts              # interactive .env setup
    service.ts            # systemd/launchd service file generation
  client/
    aipass-client.ts      # upstream Aipass API calls
  handlers/
    handlers.ts           # HTTP route handlers
  format/
    openai-format.ts      # OpenAI-compatible response shaping
    tool-call.ts          # tool-call parsing/formatting
  sessions/
    sessions.ts           # session store
  utils/
    result.ts             # Result/error helpers
    sanitize.ts           # input sanitization
    messages.ts           # message transform helpers
```

Tests are colocated as `<file>.test.ts` next to the code they cover.

## Imports

Cross-folder imports use the `@/` alias (maps to `src/`); same-folder imports use `./`.

## Setup

Download the `aipass-proxy` binary for your platform from [Releases](../../releases) — no clone/install needed. Then:

```sh
./aipass-proxy setup   # prompts for AIPASS_SESSION_TOKEN and PORT, writes .env in the cwd
./aipass-proxy start
```

`AIPASS_SESSION_TOKEN` is the `__Secure-ai_passport_auth.session_token` cookie value from an authenticated AIPass browser session.

### Run as a background service

```sh
./aipass-proxy install-service
```

Generates a systemd user unit (Linux) or launchd agent (macOS) that runs the binary's `start` command from the current directory, then prints the command to enable it (`systemctl --user enable --now aipass-proxy` / `launchctl load ...`).

## Running from source

```sh
bun install
bun run setup
bun run start           # or: bun run install-service
```

### Building the binary

```sh
bun run build           # outputs dist/aipass-proxy
```

## Development

```sh
bun run check          # lint/format (biome)
bun run typecheck      # tsc --noEmit
bun run test           # vitest
bun run test:coverage  # vitest with coverage report
```
