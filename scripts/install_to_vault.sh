#!/bin/zsh
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "用法：$0 /path/to/test-vault" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="$(cd "$1" && pwd)"
BUNDLE="$ROOT/build/obsidian/asset-track"
TARGET="$VAULT/.obsidian/plugins/asset-track"

test -d "$VAULT/.obsidian" || {
  echo "目标不是 Obsidian Vault（缺少 .obsidian）：$VAULT" >&2
  exit 1
}
test -s "$BUNDLE/main.js" || {
  echo "插件尚未构建，请先运行 build_plugin_bundle.sh" >&2
  exit 1
}

TEMP_TARGET="$VAULT/.obsidian/plugins/.asset-track-installing"
rm -rf "$TEMP_TARGET"
mkdir -p "$TEMP_TARGET"
cp -R "$BUNDLE/." "$TEMP_TARGET/"
if [[ -f "$TARGET/data.json" ]]; then
  cp "$TARGET/data.json" "$TEMP_TARGET/data.json"
fi
rm -rf "$TARGET"
mv "$TEMP_TARGET" "$TARGET"
echo "$TARGET"
