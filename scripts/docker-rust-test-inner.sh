#!/usr/bin/env bash
# Wird im Container ausgeführt (WORKDIR /workspace/src-tauri).
# Expliziter Xvfb statt xvfb-run: vermeidet Hänger, bei denen nur Xvfb läuft und kein cargo-Prozess erscheint.
set -euo pipefail

JOBS="${1:?KASSEN_DOCKER_CARGO_JOBS missing}"
shift

export DISPLAY="${DISPLAY:-:99}"

# Alten Lock entfernen (nach abgebrochenem Run)
rm -f "/tmp/.X${DISPLAY#:}-lock" 2>/dev/null || true

Xvfb "${DISPLAY}" -screen 0 1280x1024x24 -nolisten tcp -ac -noreset &
XVFB_PID=$!
cleanup() { kill "${XVFB_PID}" 2>/dev/null || true; }
trap cleanup EXIT

# Socket warten (ohne xdpyinfo — nicht im Image nötig)
sock="/tmp/.X11-unix/X${DISPLAY#:}"
for _ in $(seq 1 120); do
  if [[ -S "${sock}" ]]; then
    break
  fi
  sleep 0.05
done
if [[ ! -S "${sock}" ]]; then
  echo "docker-rust-test-inner: Xvfb-Socket ${sock} nicht bereit" >&2
  exit 1
fi

cargo test --features test -j "${JOBS}" "$@"
