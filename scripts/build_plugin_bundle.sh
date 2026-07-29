#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build/obsidian"
BUNDLE="$BUILD/asset-track"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/manifest.json','utf8')).version")"
ARCHIVE="$ROOT/build/AssetTrack-$VERSION.zip"
CACHE_ROOT="${TMPDIR:-/tmp}/asset-track-obsidian-npm-cache"

echo "[1/4] 安装依赖并验证 TypeScript 插件"
npm ci --prefix "$ROOT" --cache "$CACHE_ROOT" --no-audit --no-fund
npm run typecheck --prefix "$ROOT"
npm run lint --prefix "$ROOT"
npm run test --prefix "$ROOT"
npm run build --prefix "$ROOT"
npm run release:check --prefix "$ROOT"

echo "[2/4] 组装标准 Community Plugin 目录"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE"
cp "$ROOT/dist/main.js" "$BUNDLE/main.js"
cp "$ROOT/manifest.json" "$BUNDLE/manifest.json"
cp "$ROOT/styles.css" "$BUNDLE/styles.css"

echo "[3/4] 验证统一插件 bundle"
test -s "$BUNDLE/main.js"
test -s "$BUNDLE/manifest.json"
test -s "$BUNDLE/styles.css"
test "$(find "$BUNDLE" -maxdepth 1 -type f | wc -l | tr -d ' ')" = "3"
! grep -q "AssetTrackSidecar" "$BUNDLE/main.js"
! grep -q "127.0.0.1" "$BUNDLE/main.js"
cmp -s "$ROOT/dist/main.js" "$BUNDLE/main.js"
cmp -s "$ROOT/manifest.json" "$BUNDLE/manifest.json"
cmp -s "$ROOT/styles.css" "$BUNDLE/styles.css"

echo "[4/4] 生成带 asset-track 顶层目录的 ZIP"
rm -f "$ARCHIVE"
(
  cd "$BUILD"
  zip -qr "$ARCHIVE" asset-track
)
test -s "$ARCHIVE"
ZIP_FILES="$(unzip -Z1 "$ARCHIVE" | sort)"
EXPECTED_FILES=$'asset-track/\nasset-track/main.js\nasset-track/manifest.json\nasset-track/styles.css'
test "$ZIP_FILES" = "$EXPECTED_FILES"
MAIN_SIZE="$(wc -c < "$BUNDLE/main.js" | tr -d ' ')"
echo "main.js: $MAIN_SIZE bytes"
echo "$BUNDLE"
echo "$ARCHIVE"
