#!/usr/bin/env bash
# Regenerates every image in docs/assets from the real, running application.
#
# Starts an isolated server and a production build of the web app on their
# own ports (so nothing else interferes with the simulation), drives the app
# in a GPU-accelerated Chrome through Playwright, and writes the results.
#
#   ./scripts/capture-docs.sh
#
# Requirements: a built server (`cargo build --release -p aegis-server`), a
# built web app (`pnpm build`), Google Chrome, ffmpeg (for the demo clip).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/docs/assets"
SERVER_PORT=8798
WEB_PORT=4184
URL="http://127.0.0.1:$WEB_PORT"
LIGHT='{"quality":"ultra","autoRotate":false,"theme":"light"}'
NIGHT='{"quality":"ultra","autoRotate":false,"theme":"night"}'
mkdir -p "$OUT"

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

shot() { (cd "$ROOT/apps/web" && node scripts/capture.mjs --url "$URL" --reset "$@" >/dev/null); echo "  wrote ${*: -1}"; }

echo "Capturing to $OUT"
# The compositor can only capture the WebGL 2 canvas in headless Chrome, so
# interface screenshots use that backend (same shaders, real GPU).
# The overview, with a kind of service selected: the opening view and its card.
shot --webgl2 --settings "$LIGHT" --wait 55 --node kind:api-gateway --settle 2 --out "$OUT/overview.png"
shot --webgl2 --settings "$LIGHT" --wait 10 --click explore-incident,scenario-start-ddos-surge --settle 27 --out "$OUT/incident-ddos.png"
# A regional failure is read by place: the arrangement by region.
shot --webgl2 --settings "$NIGHT" --arrangement regions --wait 10 --click explore-incident,scenario-start-regional-outage --settle 19 --out "$OUT/incident-regional-outage.png"
shot --webgl2 --settings "$LIGHT" --wait 10 --click open-menu,menu-trace \
  --select 'authz-principal=User::"mallory",authz-action=Action::"exportLedger"' --then authz-evaluate \
  --settle 5 --out "$OUT/cedar-denial.png"
shot --webgl2 --settings "$LIGHT" --arrangement regions --wait 10 --focus use-gateway --settle 2 --out "$OUT/closeup.png"
shot hyperscale-stress --webgl2 --settings "$LIGHT" --wait 10 --out "$OUT/stress-overview.png"
shot hyperscale-stress --webgl2 --settings "$LIGHT" --arrangement regions --wait 12 --out "$OUT/stress-regions.png"
shot hyperscale-stress --webgl2 --settings "$LIGHT" --arrangement dependencies --wait 12 --out "$OUT/stress-dependencies.png"
shot --webgl2 --settings "$LIGHT" --wait 8 --click open-menu,menu-view --settle 2 --out "$OUT/table-view.png"
# A frame straight from the WebGPU backend, read back from an offscreen target.
shot --settings "$LIGHT" --wait 9 --scenario ddos-surge --after 24 --readback --out "$OUT/webgpu-frame.png"

# A short clip of an incident from start to mitigation, at 2x.
shot --webgl2 --settings '{"quality":"high","autoRotate":false,"theme":"light"}' --width 1280 --height 720 --wait 6 \
  --speed 2 --click explore-incident,scenario-start-ddos-surge --video "$OUT/demo.webm" --duration 27 --out "$OUT/demo.webm"
if command -v ffmpeg >/dev/null; then
  ffmpeg -loglevel error -y -ss 5 -i "$OUT/demo.webm" -an -c:v libx264 -pix_fmt yuv420p -crf 26 -movflags +faststart "$OUT/demo.mp4"
  # The GIF is a shorter, smaller cut for the README; the MP4 is the full clip.
  ffmpeg -loglevel error -y -ss 7 -t 16 -i "$OUT/demo.mp4" \
    -vf "fps=8,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
    "$OUT/demo.gif"
  rm -f "$OUT/demo.webm"
  echo "  wrote $OUT/demo.mp4 and $OUT/demo.gif"
fi
