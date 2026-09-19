# aipass-proxy

AIPass (de.aipass.net) is a web platform that provides access to language models. aipass-proxy is a local proxy that presents the AIPass platform through the OpenAI API format. Point an OpenAI client at the proxy and the proxy forwards requests to AIPass.

The proxy implements two OpenAI endpoints. `GET /v1/models` returns the model list. `POST /v1/chat/completions` returns a chat completion.

## Warning

The terms for AIPass prohibit the use of the platform API outside the official interface (section 3.4 at <https://aipass.go.th/term-and-cond-th>). This proxy uses the platform API outside the official interface. If you use the proxy, AIPass can suspend your account. This is not legal advice. Read the terms before you use the proxy.

## Install

Install the binary to `~/.local/bin`. The command detects the operating system and the architecture.

1. Run the install command.

```sh
curl -sL https://fasu.dev/aipass-proxy | bash
```

If you want a different directory, set `INSTALL_DIR` before you run the command. If you want a fixed version, set `VERSION` to a tag such as `v0.2.1`.

The project also publishes prebuilt binaries on the Releases page. The file names are `aipass-proxy-linux-x64`, `aipass-proxy-linux-arm64`, `aipass-proxy-darwin-x64`, and `aipass-proxy-darwin-arm64`.

## Setup

The proxy needs an AIPass session token and a port. The proxy stores the values in `~/.config/aipass-proxy/.env` and sets the file permission to 600.

1. Run `aipass-proxy setup`.
2. When the prompt asks for the AIPass session token, paste the value of the `__Secure-ai_passport_auth.session_token` cookie. Find the cookie in the browser that is signed in at de.aipass.net. Open Developer Tools and open Application or Storage and then Cookies. The input is masked.
3. When the prompt asks for the port, press Enter to use the default port 47871 or enter a different port.

## Run

Run the proxy in the foreground.

```sh
aipass-proxy start
```

The proxy listens at `http://localhost:47871`. If you set a different port during setup, the proxy listens at that port.

### Run as a background service

Install the proxy as a service that starts at login.

1. Run `aipass-proxy install-service`.
2. Run the command that the output shows.

```sh
systemctl --user enable --now aipass-proxy   # Linux
launchctl load ~/Library/LaunchAgents/com.aipass-proxy.plist   # macOS
```

If the service is enabled, you do not need to run `aipass-proxy start`.

## Use the proxy

List available models.

```sh
curl http://localhost:47871/v1/models
```

Send a chat completion request.

```sh
curl http://localhost:47871/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.1-flash-lite","messages":[{"role":"user","content":"hello"}]}'
```

You can also point an OpenAI client at `http://localhost:47871/v1`. For opencode, see `opencode.json` and `plugin/README.md`. The plugin removes the need to list models by hand.

## Update

1. Run the install command with the update argument.

```sh
curl -sL https://fasu.dev/aipass-proxy | bash -s update
```

## Uninstall

Remove the proxy and the service file.

1. If you installed the proxy as a service, stop and disable the service first.

```sh
systemctl --user disable --now aipass-proxy   # Linux
launchctl unload ~/Library/LaunchAgents/com.aipass-proxy.plist   # macOS
```

2. Run the install command with the uninstall argument.

```sh
curl -sL https://fasu.dev/aipass-proxy | bash -s uninstall
```

## Contribute

To run the proxy from source, build the binary, and see the layout of the source, read `CONTRIBUTING.md`.
