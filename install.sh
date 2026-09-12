#!/usr/bin/env bash
set -euo pipefail

REPO="pyyupsk/aipass-proxy"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${VERSION:-latest}"

if [ -t 1 ]; then
  bold=$(tput bold) dim=$(tput dim) green=$(tput setaf 2) reset=$(tput sgr0)
else
  bold="" dim="" green="" reset=""
fi

info() { echo "${dim}==>${reset} $1"; }
ok() { echo "${green}✓${reset} $1"; }

verify_checksum() {
  local file="$1" checksums_file="$2" asset_name="$3"
  local expected actual
  expected=$(grep -E " ${asset_name}\$" "$checksums_file" | cut -d' ' -f1)
  if [ -z "$expected" ]; then
    echo "No checksum entry found for ${asset_name} in ${checksums_file}" >&2
    return 1
  fi
  actual=$(sha256sum "$file" | cut -d' ' -f1)
  if [ "$expected" != "$actual" ]; then
    echo "Checksum mismatch for ${asset_name}: expected ${expected}, got ${actual}" >&2
    return 1
  fi
}

main() {
  local cmd="${1:-install}"

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

  local os arch platform platform_arch
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

  local asset url checksums_url tmp_dir
  asset="aipass-proxy-${platform}-${platform_arch}"
  if [ "$VERSION" = "latest" ]; then
    url="https://github.com/${REPO}/releases/latest/download/${asset}"
    checksums_url="https://github.com/${REPO}/releases/latest/download/checksums.txt"
  else
    url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
    checksums_url="https://github.com/${REPO}/releases/download/${VERSION}/checksums.txt"
  fi

  info "Detected platform: ${bold}${platform}-${platform_arch}${reset}"
  info "Downloading ${asset} (${VERSION})..."
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT
  curl -#L -o "$tmp_dir/$asset" "$url"
  curl -sL -o "$tmp_dir/checksums.txt" "$checksums_url"
  verify_checksum "$tmp_dir/$asset" "$tmp_dir/checksums.txt" "$asset" || {
    echo "Refusing to install: checksum verification failed." >&2
    exit 1
  }
  ok "Verified checksum"

  mkdir -p "$INSTALL_DIR"
  mv "$tmp_dir/$asset" "$INSTALL_DIR/aipass-proxy"
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
}

if [ "${1:-}" != "--source-only" ]; then
  main "$@"
fi
