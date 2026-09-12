#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/install.sh" --source-only

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

pass=0
fail=0

assert() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ok - $desc"
    pass=$((pass + 1))
  else
    echo "  FAIL - $desc (expected: $expected, got: $actual)"
    fail=$((fail + 1))
  fi
}

echo -n "hello" >"$tmp/binary"
sha256=$(sha256sum "$tmp/binary" | cut -d' ' -f1)
printf '%s  binary\nabc123  other-asset\n' "$sha256" >"$tmp/checksums.txt"

echo "verify_checksum:"

if verify_checksum "$tmp/binary" "$tmp/checksums.txt" "binary" 2>/dev/null; then
  assert "accepts a matching checksum" "0" "0"
else
  assert "accepts a matching checksum" "0" "1"
fi

echo -n "tampered" >"$tmp/binary"
if verify_checksum "$tmp/binary" "$tmp/checksums.txt" "binary" 2>/dev/null; then
  assert "rejects a mismatched checksum" "1" "0"
else
  assert "rejects a mismatched checksum" "1" "1"
fi

if verify_checksum "$tmp/binary" "$tmp/checksums.txt" "nonexistent-asset" 2>/dev/null; then
  assert "rejects an asset missing from checksums.txt" "1" "0"
else
  assert "rejects an asset missing from checksums.txt" "1" "1"
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
