# Changelog

## [0.3.0](https://github.com/pyyupsk/aipass-proxy/compare/v0.2.1...v0.3.0) (2026-09-13)


### Features

* add CLI for interactive setup and background service install ([d69cb0d](https://github.com/pyyupsk/aipass-proxy/commit/d69cb0ddff39f42afa6301590e1143b209634f64))
* add JSON-schema structured output and tool-call retry ([#9](https://github.com/pyyupsk/aipass-proxy/issues/9)) ([260372b](https://github.com/pyyupsk/aipass-proxy/commit/260372b0abaa38e5f17d2307cfb756730c91db7d))
* add opencode.json to register aipass provider ([514bef7](https://github.com/pyyupsk/aipass-proxy/commit/514bef75265653cb727d35c5e7dad26e6b8c53bf))
* add tool-calling support and fix Cloudflare 403s ([a2a7747](https://github.com/pyyupsk/aipass-proxy/commit/a2a7747de2345fec51843cab48ff440009c09b92))
* add version pinning, update, and uninstall to install.sh ([8bd7eb1](https://github.com/pyyupsk/aipass-proxy/commit/8bd7eb1001bceb947accaf83919a966551e2d565))
* build standalone binary distribution via bun build --compile ([0071869](https://github.com/pyyupsk/aipass-proxy/commit/0071869bcba06689aaed1fc6c7e65daf38c32172))
* detect AIPass session expiry and surface a clear 401 ([#8](https://github.com/pyyupsk/aipass-proxy/issues/8)) ([47b42e5](https://github.com/pyyupsk/aipass-proxy/commit/47b42e5b1116017c43e4f4511e6966601f7515d4))
* fetch real model list from AIPass, add browser headers ([87d8eef](https://github.com/pyyupsk/aipass-proxy/commit/87d8eef0476513a83b0612f3a3b7d37281bf29f9))
* mask token input during setup, clarify port default prompt ([cf79522](https://github.com/pyyupsk/aipass-proxy/commit/cf79522d7d73fa997b72f7836610b00dd5963296))
* proxy OpenAI chat completions to AIPass Gemini backend ([4e226d6](https://github.com/pyyupsk/aipass-proxy/commit/4e226d65e4e1e7df440c69236ac7814e17bb99d9))
* re-inject tool prompt every turn and support parallel tool calls ([e4fa233](https://github.com/pyyupsk/aipass-proxy/commit/e4fa23345e91683a60610e38c82f2a997ff487f0))
* store config in ~/.config/aipass-proxy instead of cwd .env ([5de90c8](https://github.com/pyyupsk/aipass-proxy/commit/5de90c866113f09fd6dc2d051c7189336271a77b))
* stream text replies through even when tools are present ([4b3bb36](https://github.com/pyyupsk/aipass-proxy/commit/4b3bb36336f01cdb72f5278581197eb919544c76))
* validate chat completions request body with zod ([ae55bcf](https://github.com/pyyupsk/aipass-proxy/commit/ae55bcf68b8fdfe0310beadc30726a8284e07042))
* verify sha256 checksum in install.sh before installing ([#11](https://github.com/pyyupsk/aipass-proxy/issues/11)) ([3f5e222](https://github.com/pyyupsk/aipass-proxy/commit/3f5e222e18a6d64164d6493d644640f598da1527))


### Bug Fixes

* avoid unbound variable in install.sh EXIT trap ([#12](https://github.com/pyyupsk/aipass-proxy/issues/12)) ([3d87ce4](https://github.com/pyyupsk/aipass-proxy/commit/3d87ce499ac6db11d0611a6f76089289736b1acb))
* bind proxy server to localhost only ([#5](https://github.com/pyyupsk/aipass-proxy/issues/5)) ([d5a384a](https://github.com/pyyupsk/aipass-proxy/commit/d5a384ac531ae85da91cfc52d634e72b5711b295))
* evade WAF traversal block on tool-result round-trips ([27de649](https://github.com/pyyupsk/aipass-proxy/commit/27de64967f80e2dc0a3d3be79c03e7477d8a41a7))
* key sessions on OpenCode's x-session-id header, evict oldest when full ([6f82b0c](https://github.com/pyyupsk/aipass-proxy/commit/6f82b0c431786dfab2c1eb1ed402a5b34da99fba))
* match release-please tag format to existing v0.1.x tags ([#2](https://github.com/pyyupsk/aipass-proxy/issues/2)) ([745e29b](https://github.com/pyyupsk/aipass-proxy/commit/745e29b7bccd18f5858664c9326b269f914bb8df))
* reuse one aipass conversation per opencode session ([a5476d9](https://github.com/pyyupsk/aipass-proxy/commit/a5476d9d9e42047313bf5a2137c336f9f3b433ef))
* shape upstream errors instead of bare 500s ([9fc61c3](https://github.com/pyyupsk/aipass-proxy/commit/9fc61c34a71f500c11d98d8ffd76aeac9f97ac48))
* surface stream errors and stop model echoing raw tool results ([06ca1d3](https://github.com/pyyupsk/aipass-proxy/commit/06ca1d3f7d1aed39c8563333e95d54f2b7495190))


### Performance Improvements

* use bytecode compilation for faster binary startup ([9c5797d](https://github.com/pyyupsk/aipass-proxy/commit/9c5797def5d29fa02527f292beb170df5bbdf03b))

## [0.2.1](https://github.com/pyyupsk/aipass-proxy/compare/v0.2.0...v0.2.1) (2026-09-13)


### Bug Fixes

* avoid unbound variable in install.sh EXIT trap ([#12](https://github.com/pyyupsk/aipass-proxy/issues/12)) ([3d87ce4](https://github.com/pyyupsk/aipass-proxy/commit/3d87ce499ac6db11d0611a6f76089289736b1acb))

## [0.2.0](https://github.com/pyyupsk/aipass-proxy/compare/v0.1.2...v0.2.0) (2026-09-12)


### Features

* add JSON-schema structured output and tool-call retry ([#9](https://github.com/pyyupsk/aipass-proxy/issues/9)) ([260372b](https://github.com/pyyupsk/aipass-proxy/commit/260372b0abaa38e5f17d2307cfb756730c91db7d))
* add version pinning, update, and uninstall to install.sh ([8bd7eb1](https://github.com/pyyupsk/aipass-proxy/commit/8bd7eb1001bceb947accaf83919a966551e2d565))
* detect AIPass session expiry and surface a clear 401 ([#8](https://github.com/pyyupsk/aipass-proxy/issues/8)) ([47b42e5](https://github.com/pyyupsk/aipass-proxy/commit/47b42e5b1116017c43e4f4511e6966601f7515d4))
* verify sha256 checksum in install.sh before installing ([#11](https://github.com/pyyupsk/aipass-proxy/issues/11)) ([3f5e222](https://github.com/pyyupsk/aipass-proxy/commit/3f5e222e18a6d64164d6493d644640f598da1527))


### Bug Fixes

* bind proxy server to localhost only ([#5](https://github.com/pyyupsk/aipass-proxy/issues/5)) ([d5a384a](https://github.com/pyyupsk/aipass-proxy/commit/d5a384ac531ae85da91cfc52d634e72b5711b295))
* match release-please tag format to existing v0.1.x tags ([#2](https://github.com/pyyupsk/aipass-proxy/issues/2)) ([745e29b](https://github.com/pyyupsk/aipass-proxy/commit/745e29b7bccd18f5858664c9326b269f914bb8df))

## [0.1.2](https://github.com/pyyupsk/aipass-proxy/compare/v0.1.1...v0.1.2) (2026-09-11)

### Features

* mask token input during setup, clarify port default prompt ([cf79522](https://github.com/pyyupsk/aipass-proxy/commit/cf79522d7d73fa997b72f7836610b00dd5963296))

### Performance Improvements

* use bytecode compilation for faster binary startup ([9c5797d](https://github.com/pyyupsk/aipass-proxy/commit/9c5797def5d29fa02527f292beb170df5bbdf03b))

## [0.1.1](https://github.com/pyyupsk/aipass-proxy/compare/v0.1.0...v0.1.1) (2026-09-11)

### Features

* store config in ~/.config/aipass-proxy instead of cwd .env ([5de90c8](https://github.com/pyyupsk/aipass-proxy/commit/5de90c866113f09fd6dc2d051c7189336271a77))

## 0.1.0 (2026-09-11)

### Features

* proxy OpenAI chat completions to AIPass Gemini backend ([4e226d6](https://github.com/pyyupsk/aipass-proxy/commit/4e226d65e4e1e7df440c69236ac7814e17bb99d9))
* fetch real model list from AIPass, add browser headers ([87d8eef](https://github.com/pyyupsk/aipass-proxy/commit/87d8eef0476513a83b0612f3a3b7d37281bf29f9))
* add opencode.json to register aipass provider ([514bef7](https://github.com/pyyupsk/aipass-proxy/commit/514bef75265653cb727d35c5e7dad26e6b8c53bf))
* add tool-calling support and fix Cloudflare 403s ([a2a7747](https://github.com/pyyupsk/aipass-proxy/commit/a2a7747de2345fec51843cab48ff440009c09b92))
* stream text replies through even when tools are present ([4b3bb36](https://github.com/pyyupsk/aipass-proxy/commit/4b3bb36336f01cdb72f5278581197eb919544c76))
* re-inject tool prompt every turn and support parallel tool calls ([e4fa233](https://github.com/pyyupsk/aipass-proxy/commit/e4fa23345e91683a60610e38c82f2a997ff487f0))
* validate chat completions request body with zod ([ae55bcf](https://github.com/pyyupsk/aipass-proxy/commit/ae55bcf68b8fdfe0310beadc30726a8284e07042))
* add CLI for interactive setup and background service install ([d69cb0d](https://github.com/pyyupsk/aipass-proxy/commit/d69cb0ddff39f42afa6301590e1143b209634f64))
* build standalone binary distribution via bun build --compile ([0071869](https://github.com/pyyupsk/aipass-proxy/commit/0071869bcba06689aaed1fc6c7e65daf38c32172))

### Bug Fixes

* reuse one aipass conversation per opencode session ([a5476d9](https://github.com/pyyupsk/aipass-proxy/commit/a5476d9d9e42047313bf5a2137c336f9f3b433ef))
* surface stream errors and stop model echoing raw tool results ([06ca1d3](https://github.com/pyyupsk/aipass-proxy/commit/06ca1d3f7d1aed39c8563333e95d54f2b7495190))
* evade WAF traversal block on tool-result round-trips ([27de649](https://github.com/pyyupsk/aipass-proxy/commit/27de64967f80e2dc0a3d3be79c03e7477d8a41a7))
* shape upstream errors instead of bare 500s ([9fc61c3](https://github.com/pyyupsk/aipass-proxy/commit/9fc61c34a71f500c11d98d8ffd76aeac9f97ac48))
* key sessions on OpenCode's x-session-id header, evict oldest when full ([6f82b0c](https://github.com/pyyupsk/aipass-proxy/commit/6f82b0c431786dfab2c1eb1ed402a5b34da99fba))
