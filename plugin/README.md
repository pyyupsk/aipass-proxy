# opencode-aipass

The plugin is a provider for opencode that connects to aipass-proxy. The plugin fetches the model list from the proxy and registers the provider. You do not need to list models in `opencode.json`.

## When to use the plugin

Use the plugin when you run aipass-proxy at `http://localhost:47871`. The plugin keeps the model list in sync with the proxy. If the proxy adds a model, the plugin shows the model after the next refresh. If the proxy is offline at startup, the plugin shows the last stored list.

If you do not want a plugin, list the models by hand in `opencode.json`. See the example in the history of the repository.

## Install

### Project install

1. Make sure that the proxy is installed and that `opencode.json` is at the root of the project. The proxy must run at the address that the plugin uses.
2. Add the plugin to `opencode.json`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./plugin/src/index.ts"],
  "model": "aipass/gpt-5.6-sol"
}
```

The plugin is now active for this project. The provider id is `aipass` and the model id is the id that `GET /v1/models` returns.

### Options

You can set options for the plugin.

```jsonc
{
  "plugins": [{
    "package": "./plugin/src/index.ts",
    "options": {
      "baseURL": "http://localhost:47871/v1",
      "name": "AIPass",
      "refreshInterval": 60000,
      "timeoutMs": 5000
    }
  }]
}
```

`baseURL` is the base URL of the proxy. `refreshInterval` is the time in milliseconds between checks for new models. `timeoutMs` is the time in milliseconds before a request times out.

### Published package

1. Publish the package from `plugin/`.

```sh
cd plugin && npm publish
```

2. Add the published package to the configuration.

```sh
opencode plugin add opencode-aipass
```

3. Add the plugin name to `opencode.json`.

```jsonc
{
  "plugins": ["opencode-aipass"]
}
```

## How the plugin works

1. On startup the plugin calls `GET /v1/models` at the base URL. If the call fails, the plugin logs a warning and keeps the previous list.
2. The plugin creates a provider with the package `@opencode/ai/providers/openai-compatible` and the settings `baseURL` and `apiKey: "unused"`. The plugin advertises tool support because the proxy emulates tool calls with the tag `<tool_call>`.
3. The plugin registers the models with `ctx.provider.transform`. opencode shows the models in the model picker.
4. Every 60 seconds the plugin checks `GET /v1/models` again. If the set of ids changed, the plugin calls `ctx.provider.reload`.
5. If you want a manual refresh, run the command `aipass:refresh` in the TUI or call the tool `aipass_refresh` from an agent.
6. The plugin stores the last list of ids in `ctx.storage`. If the proxy is offline at startup, the plugin restores the stored ids.

## Commands and tools

The plugin adds one command and one tool.

- Command `aipass:refresh` refreshes the model list from the proxy.
- Tool `aipass_refresh` does the same for an agent. It returns the number of models such as `aipass: 23 models`.

## Requirements

The plugin needs opencode v2 and the package `@opencode/plugin` version 2.0.8 or later. The proxy must run and respond to `GET /v1/models`.
