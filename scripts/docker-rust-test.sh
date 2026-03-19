#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="kassensystem-rust-tests"
DOCKERFILE_PATH="docker/rust-tests/Dockerfile"
# Weniger parallele Jobs = geringerer RAM-Spitzenwert beim Bau (wichtig für WebKit-Link in Docker).
: "${KASSEN_DOCKER_CARGO_JOBS:=1}"

docker build -f "${DOCKERFILE_PATH}" -t "${IMAGE_NAME}" .

# -t: Pseudo-TTY → Cargo-Ausgabe oft zeilenweise statt „stilles“ Puffern.
# Inneres Skript: Xvfb explizit (statt xvfb-run), damit nicht nur Xvfb läuft und cargo nie startet.
docker run --rm -t \
  -v "$(pwd)":/workspace \
  -w /workspace/src-tauri \
  -e KASSEN_DOCKER_CARGO_JOBS="${KASSEN_DOCKER_CARGO_JOBS}" \
  "${IMAGE_NAME}" \
  bash /workspace/scripts/docker-rust-test-inner.sh "${KASSEN_DOCKER_CARGO_JOBS}" "$@"
