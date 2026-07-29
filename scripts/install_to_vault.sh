#!/bin/zsh
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "用法：$0 /path/to/test-vault" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="$(cd "$1" && pwd)"
BUNDLE="${ASSET_TRACK_BUNDLE:-$ROOT/build/obsidian/asset-track}"
PLUGIN_ROOT="$VAULT/.obsidian/plugins"
TARGET="$PLUGIN_ROOT/asset-track"

test -d "$VAULT/.obsidian" || {
  echo "目标不是 Obsidian Vault（缺少 .obsidian）：$VAULT" >&2
  exit 1
}
test -s "$BUNDLE/main.js" || {
  echo "插件尚未构建，请先运行 build_plugin_bundle.sh" >&2
  exit 1
}

mkdir -p "$PLUGIN_ROOT"
STAGE_ROOT="$(mktemp -d "$PLUGIN_ROOT/.asset-track-installing.XXXXXX")"
BACKUP_ROOT=""
cleanup() {
  rm -rf "$STAGE_ROOT"
}
trap cleanup EXIT

STAGED_TARGET="$STAGE_ROOT/asset-track"
mkdir -p "$STAGED_TARGET"
cp -R "$BUNDLE/." "$STAGED_TARGET/"
if [[ -f "$TARGET/data.json" ]]; then
  cp "$TARGET/data.json" "$STAGED_TARGET/data.json"
fi

if [[ -d "$TARGET" ]]; then
  BACKUP_ROOT="$(mktemp -d "$PLUGIN_ROOT/.asset-track-previous.XXXXXX")"
  mv "$TARGET" "$BACKUP_ROOT/asset-track"
fi

if ! mv "$STAGED_TARGET" "$TARGET"; then
  if [[ -n "$BACKUP_ROOT" && -d "$BACKUP_ROOT/asset-track" ]]; then
    if ! mv "$BACKUP_ROOT/asset-track" "$TARGET"; then
      echo "自动恢复失败，原插件保留在：$BACKUP_ROOT/asset-track" >&2
      exit 1
    fi
  fi
  echo "插件安装失败，已恢复原目录" >&2
  exit 1
fi

if [[ -n "$BACKUP_ROOT" ]]; then
  rm -rf "$BACKUP_ROOT"
  BACKUP_ROOT=""
fi
echo "$TARGET"
