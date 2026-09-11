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
  index.ts               # entrypoint (Bun.serve)
  server.ts              # server startup, shared by index.ts and cli.ts
  config.ts              # env/const config
  env-file.ts            # ~/.config/aipass-proxy/.env read/write
  types.ts               # shared types + zod request schemas
  cli.ts                 # aipass-proxy CLI entrypoint
  cli/
    setup.ts             # interactive .env setup
    service.ts           # systemd/launchd service file generation
  client/
    aipass-client.ts     # upstream Aipass API calls
  handlers/
    handlers.ts          # HTTP route handlers
  format/
    openai-format.ts     # OpenAI-compatible response shaping
    tool-call.ts         # tool-call parsing/formatting
  sessions/
    sessions.ts          # session store
  utils/
    result.ts            # Result/error helpers
    sanitize.ts          # input sanitization
    messages.ts          # message transform helpers
```

Tests are colocated as `<file>.test.ts` next to the code they cover. Cross-folder imports use the `@/` alias (maps to `src/`); same-folder imports use `./`.
