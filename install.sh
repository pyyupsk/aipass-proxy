#!/usr/bin/env bash
set -euo pipefail

REPO="pyyupsk/aipass-proxy"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${VERSION:-latest}"
cmd="${1:-install}"

if [ -t 1 ]; then
  bold=$(tput bold) dim=$(tput dim) green=$(tput setaf 2) reset=$(tput sgr0)
else
  bold="" dim="" green="" reset=""
fi

info() { echo "${dim}==>${reset} $1"; }
ok() { echo "${green}✓${reset} $1"; }

if [ "$cmd" = "uninstall" ]; then
  rm -f "$INSTALL_DIR/aipass-proxy"
  rm -f "$HOME/.config/systemd/user/aipass-proxy.service" "$HOME/Library/LaunchAgents/com.aipass-proxy.plist"
  ok "Removed ${bold}$INSTALL_DIR/aipass-proxy${reset} and any installed service"
  echo "Note: run 'systemctl --user disable --now aipass-proxy' or 'launchctl unload <plist>' first if the service is running."
  exit 0
fi

if [ "$cmd" != "install" ] && [ "$cmd" != "update" ]; then
  echo "Usage: install.sh [install|update|uninstall]" >&2
  exit 1
fi

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
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

info "Detected platform: ${bold}${platform}-${platform_arch}${reset}"
info "Downloading ${asset} (${VERSION})..."
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
