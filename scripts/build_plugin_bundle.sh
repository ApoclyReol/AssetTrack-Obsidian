#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build/obsidian"
BUNDLE="$BUILD/asset-track"
PYINSTALLER="$BUILD/pyinstaller"

echo "[1/5] 安装并构建 Obsidian 插件"
npm ci --prefix "$ROOT" --cache /private/tmp/asset-track-obsidian-npm-cache --no-audit --no-fund
npm run test --prefix "$ROOT"
npm run build --prefix "$ROOT"

echo "[2/5] 构建无需系统 Python 的 sidecar"
rm -rf "$PYINSTALLER"
mkdir -p "$PYINSTALLER"
export PYINSTALLER_CONFIG_DIR="${PYINSTALLER_CONFIG_DIR:-$BUILD/pyinstaller-cache}"
"$ROOT/.venv/bin/pyinstaller" \
  --noconfirm \
  --clean \
  --onedir \
  --name AssetTrackSidecar \
  --distpath "$PYINSTALLER" \
  --workpath "$BUILD/pyinstaller-work" \
  --specpath "$BUILD/pyinstaller-spec" \
  --paths "$ROOT/backend" \
  --hidden-import assettrack.api.sidecar \
  --exclude-module pytest \
  --exclude-module _pytest \
  "$ROOT/backend/assettrack/api/sidecar.py"

echo "[3/5] 组装插件目录"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/sidecar"
cp "$ROOT/dist/main.js" "$BUNDLE/main.js"
cp "$ROOT/manifest.json" "$BUNDLE/manifest.json"
cp "$ROOT/versions.json" "$BUNDLE/versions.json"
cp "$ROOT/styles.css" "$BUNDLE/styles.css"
cp -R "$PYINSTALLER/AssetTrackSidecar/." "$BUNDLE/sidecar/"

echo "[4/5] 本地 ad-hoc 签名 sidecar"
if command -v codesign >/dev/null 2>&1; then
  find "$BUNDLE/sidecar" -type f -print0 | while IFS= read -r -d '' file_path; do
    if file "$file_path" | grep -q "Mach-O"; then
      codesign --force --sign - "$file_path"
    fi
  done
fi

echo "[5/5] 验证插件 bundle"
test -s "$BUNDLE/main.js"
test -s "$BUNDLE/manifest.json"
test -s "$BUNDLE/styles.css"
test -x "$BUNDLE/sidecar/AssetTrackSidecar"
echo "$BUNDLE"
