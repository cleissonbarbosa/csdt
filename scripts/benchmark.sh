#!/usr/bin/env bash
# Runs the rendering benchmark against an isolated server and a production
# build of the web app, so nothing else touches the simulation while frames
# are being timed.
#
#   ./scripts/benchmark.sh [--seconds 12] [--headed] [--out results.json]
#
# Requirements: `cargo build --release -p aegis-server`, `pnpm build`, Chrome.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_PORT=8798
WEB_PORT=4184
URL="http://127.0.0.1:$WEB_PORT"

cleanup() { kill "${SERVER_PID:-}" "${WEB_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT

AEGIS_BIND="127.0.0.1:$SERVER_PORT" AEGIS_ALLOWED_ORIGINS="$URL" AEGIS_LOG=warn \
  "$ROOT/target/release/aegis-server" &
SERVER_PID=$!
(cd "$ROOT/apps/web" && AEGIS_API_PROXY="http://127.0.0.1:$SERVER_PORT" \
  exec pnpm exec vite preview --host 127.0.0.1 --port "$WEB_PORT" --strictPort) >/dev/null &
WEB_PID=$!
for _ in $(seq 1 60); do
  curl -fsS "$URL/api/v1/health" >/dev/null 2>&1 && break
  sleep 0.5
done

cd "$ROOT/apps/web"
node scripts/benchmark.mjs --url "$URL" "$@"
