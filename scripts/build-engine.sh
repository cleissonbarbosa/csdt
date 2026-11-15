#!/usr/bin/env bash
# Builds the AEGIS engine for the browser: the server's own routes, service
# and Cedar engine as one WebAssembly module (apps/wasm), copied to where the
# web client's static build picks it up.
#
#   ./scripts/build-engine.sh
#
# Needs the wasm32-unknown-unknown target of the toolchain in use:
#
#   rustup target add wasm32-unknown-unknown
set -euo pipefail

cd "$(dirname "$0")/.."

TARGET=wasm32-unknown-unknown
OUT=apps/web/src/engine/aegis.wasm

if command -v rustup >/dev/null && ! rustup target list --installed | grep -qx "$TARGET"; then
  echo "build-engine: the $TARGET target is not installed. Run: rustup target add $TARGET" >&2
  exit 1
fi

cargo build --locked -p aegis-wasm --target "$TARGET" --profile wasm
cp "target/$TARGET/wasm/aegis_wasm.wasm" "$OUT"
echo "build-engine: wrote $OUT ($(wc -c <"$OUT") bytes)"
