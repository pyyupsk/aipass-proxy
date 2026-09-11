#!/usr/bin/env bash
set -euo pipefail

REPO="pyyupsk/aipass-proxy"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

os=$(uname -s)
arch=$(uname -m)

case "$os" in
  Linux) platform="linux" ;;
  Darwin) platform="darwin" ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

case "$arch" in
  x86_64) platform_arch="x64" ;;
  arm64 | aarch64) platform_arch="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="aipass-proxy-${platform}-${platform_arch}"
url="https://github.com/${REPO}/releases/latest/download/${asset}"

mkdir -p "$INSTALL_DIR"
echo "Downloading $asset..."
curl -sL -o "$INSTALL_DIR/aipass-proxy" "$url"
chmod +x "$INSTALL_DIR/aipass-proxy"

echo "Installed to $INSTALL_DIR/aipass-proxy"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Add it to your PATH: export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac
echo "Next: aipass-proxy setup && aipass-proxy start"
