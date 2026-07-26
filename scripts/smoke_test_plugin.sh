#!/bin/zsh
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "用法：$0 /path/to/test-vault" >&2
  exit 2
fi

VAULT="$(cd "$1" && pwd)"
PLUGIN="$VAULT/.obsidian/plugins/asset-track"
SIDECAR="$PLUGIN/sidecar/AssetTrackSidecar"

test -s "$PLUGIN/main.js"
test -s "$PLUGIN/manifest.json"
test -s "$PLUGIN/styles.css"
test -x "$SIDECAR"
grep -q '"isDesktopOnly": true' "$PLUGIN/manifest.json"

TEMP_ROOT="$(mktemp -d /private/tmp/asset-track-obsidian-smoke.XXXXXX)"
TOKEN="smoke-$(date +%s)-$$"
STDOUT="$TEMP_ROOT/stdout.log"
STDERR="$TEMP_ROOT/stderr.log"
cleanup() {
  if [[ -n "${SIDECAR_PID:-}" ]]; then
    kill "$SIDECAR_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

ASSET_TRACK_DB_PATH="$TEMP_ROOT/accounting_system.db" \
ASSET_TRACK_BOOTSTRAP_TOKEN="$TOKEN" \
ASSET_TRACK_PARENT_PID="$$" \
"$SIDECAR" >"$STDOUT" 2>"$STDERR" &
SIDECAR_PID="$!"

READY=""
for _ in {1..600}; do
  READY="$(grep '"event": "ready"' "$STDOUT" | tail -1 || true)"
  [[ -n "$READY" ]] && break
  kill -0 "$SIDECAR_PID" >/dev/null 2>&1 || {
    cat "$STDERR" >&2
    exit 1
  }
  sleep 0.1
done
[[ -n "$READY" ]] || {
  echo "sidecar ready 超时（60 秒）" >&2
  cat "$STDERR" >&2
  exit 1
}

PORT="$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["port"])' <<<"$READY")"
SESSION="$(curl -fsS -X POST -H "X-AssetTrack-Bootstrap: $TOKEN" \
  "http://127.0.0.1:$PORT/api/v1/session" | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["session"])')"
curl -fsS -H "X-AssetTrack-Session: $SESSION" \
  "http://127.0.0.1:$PORT/health/ready" >/dev/null
curl -fsS -H "X-AssetTrack-Session: $SESSION" \
  "http://127.0.0.1:$PORT/api/v1/current-asset" >/dev/null
curl -fsS -H "X-AssetTrack-Session: $SESSION" \
  "http://127.0.0.1:$PORT/api/v1/months" >/dev/null
curl -fsS -X POST -H "X-AssetTrack-Bootstrap: $TOKEN" \
  "http://127.0.0.1:$PORT/internal/shutdown" >/dev/null

echo "插件文件与 bundled sidecar 冒烟通过：$PLUGIN"
