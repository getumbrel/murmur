#!/bin/sh
# Retakes the store screenshots (umbrel/gallery/murmur/1-5.jpg) end to end:
# a throwaway Hermes with an empty data folder, the scripted model, a
# production build of Murmur, the demo data, then the captures. Everything is
# local and removed afterwards. Your own Hermes is never touched.
#
#   sh umbrel/gallery/tools/retake.sh
#
# Needs Docker and Playwright's Chromium (npx playwright install chromium).
# Ports can be changed with HERMES_PORT, MODEL_PORT and MURMUR_PORT.
set -eu

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
TOOLS="$ROOT/umbrel/gallery/tools"
NAME=murmur-gallery-hermes
HERMES_PORT=${HERMES_PORT:-18889}
MODEL_PORT=${MODEL_PORT:-18991}
MURMUR_PORT=${MURMUR_PORT:-3217}
# The same Hermes image and settings as the store app (see dev/docker-compose.yml).
IMAGE=$(sed -n 's/^ *image: *//p' "$ROOT/dev/docker-compose.yml" | head -n 1)
WORK=$(mktemp -d)
PIDS=""

cleanup() {
  for pid in $PIDS; do kill "$pid" 2>/dev/null || true; done
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

mkdir -p "$WORK/hermes" "$WORK/murmur"

PORT=$MODEL_PORT node "$TOOLS/model.mjs" &
PIDS="$PIDS $!"

docker run -d --name "$NAME" -p "$HERMES_PORT:$HERMES_PORT" -v "$WORK/hermes:/opt/data" \
  --add-host=host.docker.internal:host-gateway \
  -e HERMES_UID=1000 -e HERMES_GID=1000 -e HERMES_DASHBOARD=1 -e HERMES_DASHBOARD_PORT="$HERMES_PORT" \
  -e HERMES_UMBREL_APP_PROXY_AUTH=1 -e HERMES_TUI_DIR=/app/umbrel-tui \
  -e HERMES_UPSTREAM_TUI_ENTRY=/opt/hermes/ui-tui/dist/entry.js -e HERMES_GATEWAY_BOOTSTRAP_STATE=running \
  "$IMAGE" gateway run >/dev/null

(cd "$ROOT" && npx vite build --outDir "$WORK/dist" --emptyOutDir --logLevel warn)
(cd "$ROOT" && exec env PORT="$MURMUR_PORT" HERMES_URL="http://localhost:$HERMES_PORT" DATA_DIR="$WORK/murmur" \
  STATIC_DIR="$WORK/dist" node server/index.ts) &
PIDS="$PIDS $!"

GROUP=$(HERMES_URL="http://localhost:$HERMES_PORT" CONTAINER=$NAME DATA="$WORK/hermes" \
  MODEL_URL="http://host.docker.internal:$MODEL_PORT/v1" node "$TOOLS/seed.mjs" | tail -n 1)

MURMUR_URL="http://localhost:$MURMUR_PORT" GROUP=$GROUP node "$TOOLS/capture.mjs"
