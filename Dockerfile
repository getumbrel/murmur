# syntax=docker/dockerfile:1

# Base images are pinned by digest so a tag rebuilds the same bytes, and
# Dependabot (.github/dependabot.yml) proposes the bumps. The runtime stage's
# Alpine release must stay the one the Node image is built on (3.24).

# ── Build ───────────────────────────────────────────────────────────────────
# The web build is platform-independent, so it always runs natively on the
# build machine (no emulation when cross-building arm64/amd64).
FROM --platform=$BUILDPLATFORM node:22-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
# An empty folder for the runtime stage's /data, which runs no commands.
RUN mkdir /data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# The Node binary for the target platform.
FROM node:22-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS node

# ── Runtime ─────────────────────────────────────────────────────────────────
# The server has no dependencies and Node 22.18+ runs TypeScript natively, so
# the image is plain Alpine with the node binary (and the two C++ runtime
# libraries it links), the server's .ts files and the static build. No npm,
# npx, corepack or yarn: nothing installs at runtime. The stage only copies
# files, so cross-building it needs no emulation.
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
COPY --from=node /usr/lib/libstdc++.so.6 /usr/lib/libgcc_s.so.1 /usr/lib/
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
# MIT asks for these notices to travel with every copy, and the bundle in
# dist/ contains the vendored Hermes client.
COPY LICENSE ./LICENSE
COPY src/hermes/vendor/LICENSE ./licenses/hermes-agent.LICENSE

# HERMES_URL is left unset so the app asks where agents live on first run: the
# built-in Hermes (MURMUR_BUILTIN_HERMES_URL, set by docker-compose.yml and the
# umbrelOS compose) or one Murmur finds or is given.
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
# Owner-only, like the 0600 murmur.json inside it: it can hold Hermes passwords.
COPY --from=build --chown=1000:1000 --chmod=700 /data /data
VOLUME /data
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/index.ts"]
