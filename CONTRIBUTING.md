# Contributing

This file describes how to run the proxy from source, check the source, and understand the layout of the source.

## Run from source

1. Clone the repository.

```sh
git clone https://github.com/pyyupsk/aipass-proxy.git
cd aipass-proxy
```

2. Install dependencies.

```sh
bun install
```

3. Create the configuration.

```sh
bun run setup
```

The command asks for the AIPass session token and the port. It writes `~/.config/aipass-proxy/.env`.

4. Start the proxy.

```sh
bun run start
```

The proxy listens at `http://localhost:47871` or at the port that you set. To install the proxy as a background service, run `bun run install-service`.

5. Build the standalone binary.

```sh
bun run build
```

The command writes `dist/aipass-proxy`.

## Check the source

Run each check from the root of the repository.

1. Format and lint the source.

```sh
bun run check
```

2. Check types.

```sh
bun run typecheck
```

3. Run tests.

```sh
bun run test
```

4. Run tests with the coverage report.

```sh
bun run test:coverage
```

## Layout of the source

```tree
src/
  index.ts               # Entry point for development. Starts the server.
  server.ts              # Starts the server. Used by index.ts and cli.ts.
  env.ts                 # Reads and writes ~/.config/aipass-proxy/.env.
  cli.ts                 # Entry point for the aipass-proxy command.
  cli/
    setup.ts             # Interactive setup for the configuration.
    service.ts           # Creates the systemd or launchd file.
  aipass/
    client.ts            # Calls the upstream AIPass API.
    sanitize.ts          # Removes path traversal sequences for the WAF.
    types.ts             # Types for AIPass responses.
  openai/
    types.ts             # Schemas for OpenAI requests. Based on zod.
    transform.ts         # Maps messages and responses between OpenAI and AIPass.
    stream.ts            # Formats SSE chunks for streaming responses.
  routes/
    chat-completions.ts  # Handler for POST /v1/chat/completions.
    models.ts            # Handler for GET /v1/models.
  sessions/
    sessions.ts          # Store for conversations. Keyed by session.
```

Tests use the same name as the file with the suffix `.test.ts`. The test file is in the same directory as the source file. Imports that cross a directory use the alias `@/` for `src/`. Imports in the same directory use `./`.

## Plugin

The opencode plugin is in `plugin/`. The plugin discovers models from the proxy.

1. Read `plugin/README.md` for the configuration that the plugin needs.
2. Run `bun tsc --noEmit` in `plugin/` to check types.
