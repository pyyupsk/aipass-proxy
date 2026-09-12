# Contributing

```sh
git clone https://github.com/pyyupsk/aipass-proxy.git
cd aipass-proxy
bun install
bun run setup
bun run start          # or: bun run install-service
bun run build          # outputs dist/aipass-proxy
```

```sh
bun run check          # lint/format (biome)
bun run typecheck      # tsc --noEmit
bun run test           # vitest
bun run test:coverage  # vitest with coverage report
```

## Structure

```tree
src/
  index.ts               # dev entrypoint (Bun.serve)
  server.ts              # server startup, shared by index.ts and cli.ts
  env.ts                 # ~/.config/aipass-proxy/.env read/write
  cli.ts                 # aipass-proxy CLI entrypoint
  cli/
    setup.ts             # interactive .env setup
    service.ts           # systemd/launchd service file generation
  aipass/
    client.ts            # upstream AIPass API calls
    sanitize.ts          # WAF path-traversal evasion
    types.ts             # AIPass response types
  openai/
    types.ts             # OpenAI-compatible request schemas (zod)
    transform.ts         # OpenAI <-> AIPass message/response shaping
    stream.ts            # SSE chunk formatting for streaming responses
  routes/
    chat-completions.ts  # POST /v1/chat/completions handler
    models.ts            # GET /v1/models handler
  sessions/
    sessions.ts          # session/conversation store
```

Tests are colocated as `<file>.test.ts` next to the code they cover. Cross-folder imports use the `@/` alias (maps to `src/`); same-folder imports use `./`.
