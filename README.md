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

```sh
bun install
bun run setup   # prompts for AIPASS_SESSION_TOKEN and PORT, writes .env
```

`AIPASS_SESSION_TOKEN` is the `__Secure-ai_passport_auth.session_token` cookie value from an authenticated AIPass browser session.

## Run

```sh
bun run start
```

### Run as a background service

```sh
bun run install-service
```

Generates a systemd user unit (Linux) or launchd agent (macOS) that runs `bun run start` from this directory, then prints the command to enable it (`systemctl --user enable --now aipass-proxy` / `launchctl load ...`).

## Development

```sh
bun run check          # lint/format (biome)
bun run typecheck      # tsc --noEmit
bun run test           # vitest
bun run test:coverage  # vitest with coverage report
```
