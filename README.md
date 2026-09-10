# aipass-proxy

OpenAI-compatible proxy in front of Aipass.

## Structure

```tree
src/
  index.ts                # entrypoint (Bun.serve)
  config.ts               # env/const config
  types.ts                # shared types
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

## Run

```sh
bun run start
```
