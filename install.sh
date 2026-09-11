#!/usr/bin/env bash
set -euo pipefail

REPO="pyyupsk/aipass-proxy"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

if [ -t 1 ]; then
  bold=$(tput bold) dim=$(tput dim) green=$(tput setaf 2) reset=$(tput sgr0)
else
  bold="" dim="" green="" reset=""
fi

info() { echo "${dim}==>${reset} $1"; }
ok() { echo "${green}✓${reset} $1"; }

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

info "Detected platform: ${bold}${platform}-${platform_arch}${reset}"
info "Downloading ${asset}..."
mkdir -p "$INSTALL_DIR"
curl -#L -o "$INSTALL_DIR/aipass-proxy" "$url"
chmod +x "$INSTALL_DIR/aipass-proxy"
ok "Installed to ${bold}$INSTALL_DIR/aipass-proxy${reset}"

echo
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "${bold}Add it to your PATH:${reset}"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    echo
    ;;
esac
echo "${bold}Next steps:${reset}"
echo "  aipass-proxy setup"
echo "  aipass-proxy start             # run it in the foreground"
echo "  aipass-proxy install-service   # or, one-time: run it in the background, starts on login"
