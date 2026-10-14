# Murmur

**A beautiful way to use Hermes.**

Murmur is a mobile-first web app for talking to [Hermes Agent](https://github.com/NousResearch/hermes-agent) agents. You can chat with one agent, or with several together in a group. It ships as an umbrelOS app next to the Hermes Agent app and uses that app's agents, chats and models, and it also runs on its own ([`docs/STANDALONE.md`](docs/STANDALONE.md)). Agents, chats and models all live in Hermes. Murmur itself only remembers its connection settings: on a standalone install, `DATA_DIR/murmur.json` holds the Hermes address (and its password, if it has one) and the key that signs Murmur's sign-in cookie.

## Develop

You need Node 22.18+ (it runs the server's TypeScript directly) and Docker.

```sh
npm install

# 1. A local Hermes, the same image and settings as the Umbrel store app
docker compose -f dev/docker-compose.yml up -d        # http://localhost:18789

# 2. In one terminal, the Murmur server (proxies Hermes)
HERMES_URL=http://localhost:18789 npm run dev:server   # :3000

# 3. In another, the web app with HMR
npm run dev:web                                        # http://localhost:5173
```

The dev Hermes container is named `hermes-agent_web_1`, just like on Umbrel, and keeps its data in `dev/hermes-data/` (gitignored). The first time you open Murmur it walks you through connecting a model. Vite forwards `/hermes` and `/murmur` to the server. To point it at a server on another port, set `MURMUR_SERVER=http://localhost:3001`.

| Command | |
|---|---|
| `npm run typecheck` | `tsc -b` for the app and the server |
| `npm run build` | Typecheck, then build the app into `dist/` |
| `npm start` | Serve `dist/` and proxy Hermes, the same way production does |
| `node scripts/shot.mjs <url> <out.png> [w] [h] [dark\|light]` | Take a screenshot with Playwright |

### Server environment

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where `murmur.json` lives |
| `HERMES_URL` | unset, then the address chosen in the app, then `http://hermes-agent_web_1:18789` | Pins the Hermes dashboard address |
| `HERMES_NAME` | "This Umbrel", "This computer" or the host | What the app calls the `HERMES_URL` Hermes |
| `HERMES_TOKEN` | *(read from the dashboard page)* | A fixed Hermes session token, if Hermes has one set |
| `HERMES_USERNAME`, `HERMES_PASSWORD` | unset | Sign-in for a password-protected Hermes |
| `MURMUR_PASSWORD` | unset | Puts Murmur behind its own password |
| `MURMUR_SECRET` | generated, kept in `DATA_DIR` | Signs Murmur's sign-in cookie |
| `MURMUR_ALLOWED_HOSTS` | unset | Extra host names Murmur answers to, beyond IPs, `localhost`, `*.local`, `*.ts.net` and single-label names |
| `MURMUR_ALLOWED_ORIGINS` | unset | Extra browser origins allowed to use Murmur (their hosts are allowed too) |
| `STATIC_DIR` | `dist` | |
| `MURMUR_LOCAL_MODEL_URLS` | `Ollama=http://ollama_ollama_1:11434,LocalAI=http://localai_api_1:8080` | Local model servers to offer during setup |

[`docs/STANDALONE.md`](docs/STANDALONE.md) explains each one, and the server's own API.

## Architecture

- **`server/`** is a small, dependency-free Node server (`index.ts` is the entry). It serves the built app with an SPA fallback. It also proxies `/hermes/api/*` (REST and the `/api/ws` WebSocket) to Hermes and attaches the dashboard session token on the server side. Nothing else of Hermes is proxied, because its pages carry that token, so the browser never sees it, and everything stays same-origin behind Umbrel's login. When Hermes restarts it rotates the token, and the server picks up the new one on the first 401 or 403.
- **`/murmur/local`** looks for model servers such as Ollama on the Umbrel network, because the browser can't reach other containers.
- **`src/hermes/`** talks to Hermes over the same JSON-RPC socket that Hermes Desktop uses:
  - `gateway.ts` owns the single connection and redials it, and exposes `rpc()`.
  - `rest.ts` wraps the dashboard REST API.
  - `vendor/` holds Hermes's own typed client and the generated wire contract.
- **`src/state/`** has these stores:
  - `chats.ts` is a zustand store that folds streamed events into chat items.
  - `agents.ts` and `readiness.ts` are React Query hooks. Agents are Hermes profiles, and readiness reports whether a model is set up.
  - `sync.ts` keeps chat lists fresh when they change anywhere.
- **`src/features/`** holds the pieces each screen is built from: `chat/` (thread, composer, tool and approval cards), `group/`, `agents/` (the agent editor and new-group sheets), `agent-page/` with its `routines/`, `memory/` and `telegram/` sections, `voice/`, `media/`, `settings/`, `connection/` and `onboarding/`. **`src/screens/`** assembles them into routes (wouter, with screen transitions in `src/lib/transitions.ts`), and **`src/ui/`** has the primitives (Button, Sheet, ListRow, Buddy and others).
- **Dev-only pages** (`playground.html`, `onboarding.html`, `connection.html`, `routines.html`, `ui.html`, `buddy.html`) work under `npm run dev:web` and are never part of `vite build`.
- The design rules are in [`docs/DESIGN.md`](docs/DESIGN.md). The Hermes integration specs and the live probe scripts that back them are in [`docs/hermes/`](docs/hermes).

## Brand

The mark is two buddies, violet and coral, leaning together into a lowercase **m**; every agent in the app is a buddy from the same family. The lockup sets the mark beside **murmur** in Inter 600, and Umbrel signs off quietly with "Murmur by Umbrel".

- [`docs/BRAND.md`](docs/BRAND.md) has the colours, clear space, minimum sizes, voice and the rules for using the mark.
- `src/ui/brand.tsx` has the components (`MurmurMark`, `MurmurWordmark`, `ByUmbrel`) and `design/icon/` the exported icons.
- `/buddy.html` (dev only) shows the whole system live.

## Updating the vendored Hermes client

`src/hermes/vendor/` is an exact copy of `apps/shared/src/` from `NousResearch/hermes-agent`. Its tag must match the Hermes version on the Umbrel store. When the Hermes Agent app is bumped:

1. Find the new tag and image digest in [`hermes-agent/docker-compose.yml`](https://github.com/getumbrel/umbrel-apps/blob/master/hermes-agent/docker-compose.yml) in umbrel-apps.
2. Copy the files in, with Hermes's MIT license (its notice has to ship with the copy; the Docker image carries it as `licenses/hermes-agent.LICENSE`):
   ```sh
   TAG=v2026.9.24
   for f in gateway-contract.generated.ts gateway-events.ts json-rpc-channel.ts json-rpc-gateway.ts; do
     curl -fsSL "https://raw.githubusercontent.com/NousResearch/hermes-agent/$TAG/apps/shared/src/$f" -o "src/hermes/vendor/$f"
   done
   curl -fsSL "https://raw.githubusercontent.com/NousResearch/hermes-agent/$TAG/LICENSE" -o src/hermes/vendor/LICENSE
   ```
3. Update the tag in `src/hermes/vendor/README.md` and the image in `dev/docker-compose.yml`.
4. Run `npm run typecheck`. Contract drift shows up as type errors.
5. Re-run the probes in `docs/hermes/scripts/` against the new dev Hermes.

## Deploy

- **Image.** The `Dockerfile` builds the app with `node:22-alpine` and ships `server/`, `dist/` and the license notices on plain Alpine with just the `node` binary copied in (no npm, npx, corepack or yarn), which is about 56 MB compressed. Both base images are pinned by digest. The runtime stage only copies files, so cross-building for the other architecture needs no emulation. The image runs as user 1000:1000, keeps `/data` at mode 0700, listens on `:3000`, and has a health check at `/healthz`.
  ```sh
  docker build -t murmur .
  docker run --init -p 3000:3000 -e HERMES_URL=http://<hermes-host>:18789 murmur
  ```
- **Release.** Pushing a `v*` tag runs `.github/workflows/release.yml`. It first checks that the tag matches `version` in both `package.json` and `umbrel/murmur/umbrel-app.yml`, then builds `linux/amd64` and `linux/arm64` images and pushes them to `ghcr.io/getumbrel/murmur`. The run summary prints the digest to pin.
- **CI.** `.github/workflows/ci.yml` runs the typecheck, the build and a Docker build on every push to `main` (or `master`) and every pull request, then starts the image and checks `/healthz`, the app, the manifest and the `/data` permissions. There are no unit tests yet. Workflow actions are pinned to commit SHAs, and `.github/dependabot.yml` proposes monthly bumps for them and for the base images.
- **umbrelOS.** The store app lives in [`umbrel/murmur/`](umbrel/murmur), and its icon and screenshots in [`umbrel/gallery/murmur/`](umbrel/gallery/murmur). `sh umbrel/gallery/tools/retake.sh` retakes the screenshots on a throwaway Hermes with demo data. See [`umbrel/README.md`](umbrel/README.md) for how to submit it, and for the planned move from Hermes's app-proxy auth bypass to a dedicated exported token.
