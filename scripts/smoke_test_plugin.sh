#!/bin/zsh
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "用法：$0 /path/to/test-vault" >&2
  exit 2
fi

SOURCE="$(cd "$1" && pwd)"
if [[ -d "$SOURCE/.obsidian" ]]; then
  PLUGIN="$SOURCE/.obsidian/plugins/asset-track"
else
  PLUGIN="$SOURCE"
fi

test -s "$PLUGIN/main.js"
test -s "$PLUGIN/manifest.json"
test -s "$PLUGIN/styles.css"
grep -q '"isDesktopOnly": true' "$PLUGIN/manifest.json"
test "$(find "$PLUGIN" -maxdepth 1 -type f | wc -l | tr -d ' ')" = "3"
! test -e "$PLUGIN/sidecar"
! grep -q "AssetTrackSidecar" "$PLUGIN/main.js"
node -e "const sqlite=require('node:sqlite');const db=new sqlite.DatabaseSync(':memory:');db.exec('CREATE TABLE smoke(value INTEGER)');db.prepare('INSERT INTO smoke VALUES (?)').run(1);if(db.prepare('SELECT value FROM smoke').get().value!==1)process.exit(1);db.close()"
echo "标准 TypeScript 插件与 node:sqlite 冒烟通过：$PLUGIN"
