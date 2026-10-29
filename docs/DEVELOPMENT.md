# Developing Murmur

Murmur is a React app and a small Node server that relays to [Hermes Agent](https://github.com/NousResearch/hermes-agent). This page covers running it locally, how it's built, and how it ships. For what Murmur is, see the [README](../README.md).

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

`HERMES_URL` pins the server to that Hermes, so Murmur never asks where agents live. To work on that first-run choice, start the built-in Hermes too, and run the server without `HERMES_URL` and with a fresh data folder:

```sh
docker compose -f dev/docker-compose.yml --profile builtin up -d builtin   # Murmur's built-in Hermes, on 127.0.0.1:9119
DATA_DIR=/tmp/murmur-first-run \
MURMUR_BUILTIN_HERMES_URL=http://localhost:9119 MURMUR_BUILTIN_HERMES_PASSWORD=murmur-dev-password \
MURMUR_FIND_HERMES='Hermes Agent=http://localhost:18789' \
  npm run dev:server
```

`GET /murmur/setup` then offers the built-in and the dev Hermes. Delete the data folder to be asked again.

| Command | |
|---|---|
| `npm run typecheck` | `tsc -b` for the app and the server |
| `npm run build` | Typecheck, then build the app into `dist/` |
| `npm test` | The unit tests (Vitest) |
| `npm run test:contract` | The Hermes contract suite, against a real Hermes in Docker (below) |
| `npm start` | Serve `dist/` and proxy Hermes, the same way production does |
| `node scripts/shot.mjs <url> <out.png> [w] [h] [dark\|light]` | Take a screenshot with Playwright |

### Server environment

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where `murmur.json` lives |
| `HERMES_URL` | unset: the app asks where agents live, then uses the Hermes chosen or added there | Pins the Hermes dashboard address, with no choice to make |
| `HERMES_NAME` | "Hermes Agent", "This computer" or the host | What the app calls the `HERMES_URL` Hermes |
| `HERMES_TOKEN` | *(read from the dashboard page)* | A fixed Hermes session token, if Hermes has one set |
| `HERMES_USERNAME`, `HERMES_PASSWORD` | unset | Sign-in for a password-protected Hermes |
| `MURMUR_BUILTIN_HERMES_URL` | unset | The Hermes that comes with Murmur (`http://murmur_hermes_1:9119` on umbrelOS, `http://hermes:9119` in `docker-compose.yml`). Unset: no built-in |
| `MURMUR_BUILTIN_HERMES_USERNAME`, `MURMUR_BUILTIN_HERMES_PASSWORD` | `murmur`, unset | The built-in's dashboard sign-in (its `HERMES_DASHBOARD_BASIC_AUTH_*`) |
| `MURMUR_FIND_HERMES` | the Hermes Agent app's container address, `localhost:9119`, `127.0.0.1:9119`, `localhost:18789` | Where to look for a Hermes people already have, as `Name=url,…` |
| `MURMUR_PASSWORD` | unset | Puts Murmur behind its own password |
| `MURMUR_SECRET` | generated, kept in `DATA_DIR` | Signs Murmur's sign-in cookie |
| `MURMUR_ALLOWED_HOSTS` | unset | Extra host names Murmur answers to, beyond IPs, `localhost`, `*.local`, `*.ts.net` and single-label names |
| `MURMUR_ALLOWED_ORIGINS` | unset | Extra browser origins allowed to use Murmur (their hosts are allowed too) |
| `STATIC_DIR` | `dist` | |
| `MURMUR_LOCAL_MODEL_URLS` | `Ollama=http://ollama_ollama_1:11434,LocalAI=http://localai_api_1:8080` | Local model servers to offer during setup |

[`STANDALONE.md`](STANDALONE.md) explains each one, and the server's own API.

## Architecture

- **`server/`** is a small, dependency-free Node server (`index.ts` is the entry). It serves the built app with an SPA fallback. It also proxies `/hermes/api/*` (REST and the `/api/ws` WebSocket) to Hermes and attaches the dashboard session token on the server side. Nothing else of Hermes is proxied, because its pages carry that token, so the browser never sees it, and everything stays same-origin behind Umbrel's login. When Hermes restarts it rotates the token, and the server picks up the new one on the first 401 or 403.
- **`/murmur/setup`** (`server/setup.ts`, `server/discovery.ts`) is the first-run question of where agents live: the Hermes built into Murmur, or one it found (the Hermes Agent app on umbrelOS, or a Hermes nearby, read briefly and in parallel; a password-protected one is sent nothing). The app's side is `src/state/setup.ts`.
- **App sign-ins come back through the server.** Before an app's OAuth sign-in, Murmur points its `redirect_uri` at `/hermes/api/mcp/oauth/callback/<app>`. `server/oauth-return.ts` lets that one GET through without Murmur's password cookie or the desktop app's header, since it often lands in the person's own browser; Hermes checks the one-time state, and Murmur shows its own page. See [`hermes/apps-messaging-insights.md`](hermes/apps-messaging-insights.md).
- **`/murmur/local`** looks for model servers such as Ollama on the Umbrel network, because the browser can't reach other containers. One that answers with no models is still listed, so the app can say it's there but empty.
- **Running a model on Hermes's own machine** uses Hermes 0.22's local runtime (`/api/local-models`, through the usual `/hermes` proxy). `src/state/local-tiers.ts` is the table of models Murmur offers, priced the way Hermes's estimator prices a launch; `src/state/local-runtime.ts` installs the runtime if needed, downloads, switches the main agent, and picks a setup up again from Hermes's jobs after a reload. The onboarding playground shows every state (`onboarding.html?screen=connect&open=device&device=downloading`).
- **`src/hermes/`** talks to Hermes over the same JSON-RPC socket that Hermes Desktop uses:
  - `gateway.ts` owns the single connection and redials it, and exposes `rpc()`.
  - `rest.ts` wraps the dashboard REST API.
  - `vendor/` holds Hermes's own typed client and the generated wire contract.
- **`src/state/`** has these stores:
  - `chats.ts` is a zustand store that folds streamed events into chat items.
  - `agents.ts` and `readiness.ts` are React Query hooks. Agents are Hermes profiles, and readiness reports whether a model is set up.
  - `sync.ts` keeps chat lists fresh when they change anywhere.
  - `apps.ts` (MCP apps and their sign-ins), `mail.ts` and `mail-chat.ts` (an agent's email, through the `murmur-mail` plugin), `hosted-apps.ts`, `hosted-apps-consent.ts` and `hosted-apps-chat.ts` (apps through Nous Research, asked once), `vault.ts` (an agent's saved logins, cards and addresses), `whatsapp.ts` (linking, run from the tab), `access.ts` (who can message an agent), `limits.ts` and `insights.ts` (plan gauges, a chat's room and spend, the week), `backups.ts` (export and import an agent) and `toolsets.ts` (keeps desktop-only tools off every agent, and Nous's `connections` until the person agrees).
  - The live moments inside a turn (plan, helpers, reactions, previews) are pure reducers in `src/features/chat/live.ts`, which `chats.ts` routes events to.
- **`src/features/`** holds the pieces each screen is built from: `chat/` (thread, composer, tool and approval cards), `group/`, `agents/` (the agent editor and new-group sheets), `agent-page/` with its `routines/`, `memory/`, `telegram/`, `whatsapp/`, `apps/`, `vault/` and `access/` sections, `voice/`, `media/`, `settings/`, `connection/` and `onboarding/`. **`src/screens/`** assembles them into routes (wouter, with screen transitions in `src/lib/transitions.ts`), and **`src/ui/`** has the primitives (Button, Sheet, ListRow, Buddy and others).
- **Dev-only pages** (`playground.html`, `onboarding.html`, `connection.html`, `routines.html`, `ui.html`, `buddy.html`) work under `npm run dev:web` and are never part of `vite build`.
- The design rules are in [`DESIGN.md`](DESIGN.md). The Hermes integration specs and the live probe scripts that back them are in [`hermes/`](hermes).

## Hermes contract tests

Murmur depends on a lot of Hermes behaviour that no type can describe, such as how a routine's run is named, that a quiet run ends in `[SILENT]`, or which fields a chat's rows carry. `npm run test:contract` checks that behaviour against a real Hermes. It needs Docker and nothing else, and takes about four minutes once the images are pulled.

- **What runs.** `test/contract/setup.ts` starts the Hermes image that `umbrel/murmur/docker-compose.yml` pins, set up like Murmur's built-in Hermes (password sign-in, the gateway running). It also starts a scripted fake model (`test/contract/fake-model.ts`) and connects it the way onboarding does, then starts Murmur's own server pinned to that Hermes. Each run starts from a fresh Hermes with no saved data, and leaves the Hermes and Murmur logs in `test-results/contract/`.
- **How tests talk to it.** Tests go through Murmur's server, so the proxy, the sign-in and the socket ticket are covered too. They also call Murmur's own data layer, such as `createAgent`, `connectLocal`, `isQuiet` and `fetchAgentChats`, through a small browser stand-in (`test/contract/browser.ts`).
- **Steering the model.** A test steers the fake model with tags in its message: `[[say: text]]`, `[[silent]]`, `[[tool: terminal {"command":"…"}]]`, several tools in one turn with `toolsTag(…)`, `[[slow: 200]]` and `[[fail]]`. Anything else gets "pong".
- **Apps through Nous.** `hosted-apps.contract.ts` never makes a Nous account: it calls nothing that could, except where Hermes refuses it first, and checks on disk afterwards that there's still none. One test reads Nous Research's public app catalog over the internet; offline, it checks that Hermes answers "unavailable" the way Murmur expects and skips the rest. On a Hermes bump, read what changed in `tui_gateway/methods_connectors.py` before running it: a refusal that moved after the account is made would make one.
- **Email.** `mail.contract.ts` runs Murmur's own `connectMail`, `checkMail`, `changeMailPassword`, `setMailEnabled` and `disconnectMail`, and chats that search, read, draft and send, against the `murmur-mail` plugin in Umbrel's Hermes image and a fake mail server: GreenMail (`greenmail/standalone:2.1.5`, `test/contract/greenmail.ts`) with made-up accounts, on a Docker network of its own that the Hermes container joins as `mail`. The sending tests hold the approval the way the card does and check the mail server has nothing until the person says yes, and nothing at all when they say no or nobody is asked. The test reads what landed through GreenMail's REST API.
- **A Hermes without the plugin.** The email tests need an image that bundles `murmur-mail`, and fail at once, saying so, against one that doesn't. To test a build of [getumbrel/hermes-agent-umbrel](https://github.com/getumbrel/hermes-agent-umbrel) before it's released and pinned, build it and point the suite at it:
  ```sh
  # in a hermes-agent-umbrel checkout
  docker build -t murmur-local/hermes-agent-umbrel:v0.22.5-mail .
  # here
  HERMES_IMAGE=murmur-local/hermes-agent-umbrel:v0.22.5-mail npm run test:contract
  ```
  Or put the plugin into any image as it starts: `MURMUR_MAIL_PLUGIN=<hermes-agent-umbrel>/umbrel-context/plugins/murmur-mail` tests a working copy without building (into the pinned image, say), and `MURMUR_MAIL_PLUGIN=pinned` takes the one in the pinned Umbrel image. `MURMUR_MAIL_PLUGIN=add` puts nothing in: the email tests have Murmur add it from GitHub, the way it does for a Hermes of someone's own (`addMailPlugin`), so Hermes needs to reach github.com. The plugin's own unit tests live with it, in that repo's `tests/`.
- **Another Hermes.** Set `HERMES_IMAGE` to test against a different image, for example `HERMES_IMAGE=nousresearch/hermes-agent:latest npm run test:contract`.
- **In CI.** `ci.yml` runs the suite on every pull request against the pinned Hermes. `hermes-nightly.yml` runs it every night against Hermes's newest release, twice: with the pinned image's `murmur-mail` put into it (`MURMUR_MAIL_PLUGIN=pinned`), so the email tests check that plugin against Hermes's next release too, and with Murmur adding it (`MURMUR_MAIL_PLUGIN=add`), as it does for anyone running that release themselves. It can also be started by hand with any image, such as an Umbrel build you're about to pin.

When the suite finds something new about Hermes, add a test for it here, rather than another probe script in `docs/hermes/scripts/`. Those scripts remain for exploring.

## Updating the vendored Hermes client

`src/hermes/vendor/` is an exact copy of `apps/shared/src/` from `NousResearch/hermes-agent`. Its tag must match the Hermes that Murmur bundles. To bump it:

1. Find the new tag, and the digest of `ghcr.io/getumbrel/hermes-agent-umbrel` at that tag (the image the Hermes Agent app on umbrelOS uses, [`hermes-agent/docker-compose.yml`](https://github.com/getumbrel/umbrel-apps/blob/master/hermes-agent/docker-compose.yml) in umbrel-apps).
2. Copy the files in, with Hermes's MIT license (its notice has to ship with the copy; the Docker image carries it as `licenses/hermes-agent.LICENSE`):
   ```sh
   TAG=v0.22.5
   for f in gateway-contract.generated.ts gateway-events.ts json-rpc-channel.ts json-rpc-gateway.ts; do
     curl -fsSL "https://raw.githubusercontent.com/NousResearch/hermes-agent/$TAG/apps/shared/src/$f" -o "src/hermes/vendor/$f"
   done
   curl -fsSL "https://raw.githubusercontent.com/NousResearch/hermes-agent/$TAG/LICENSE" -o src/hermes/vendor/LICENSE
   ```
3. Update the tag in `src/hermes/vendor/README.md`, and the image in `umbrel/murmur/docker-compose.yml`, `docker-compose.yml` and `dev/docker-compose.yml` (which upgrades `dev/hermes-data` in place on its next start). If the new image's `murmur-mail` changed, move `MAIL_PLUGIN_SOURCE.ref` in `src/state/mail.ts` to the hermes-agent-umbrel commit it was built from, so a Hermes of someone's own gets the same plugin.
4. Run `npm run typecheck`. Contract drift shows up as type errors.
5. Run `npm run test:contract`. It tests the image you just pinned, and any behaviour Murmur relies on that changed fails there, the `murmur-mail` plugin's included (the Umbrel image must bundle it; see above).

## Desktop

Murmur also runs as a desktop app for macOS, Windows and Linux. It's an Electron window onto the same web app, with Murmur's server running inside the app. See [`DESKTOP.md`](DESKTOP.md) for signing, releases and updates.

```sh
npm run desktop:dev                          # the app in Electron, with Vite's hot reload
npm run desktop:dist                         # installers for this computer, in desktop/release/
npm run desktop:dist -- --mac --x64 --arm64  # or name the platforms and architectures
```

`.github/workflows/desktop.yml` builds and smoke-tests all three platforms on every pull request that touches the app. On a version tag, it attaches the installers to the release.

## Deploy

- **Image.** The `Dockerfile` builds the app with `node:22-alpine` and ships `server/`, `dist/` and the license notices on plain Alpine with just the `node` binary copied in (no npm, npx, corepack or yarn), which is about 56 MB compressed. Both base images are pinned by digest. The runtime stage only copies files, so cross-building for the other architecture needs no emulation. The image runs as user 1000:1000, keeps `/data` at mode 0700, listens on `:3000`, and has a health check at `/healthz`.
  ```sh
  docker build -t murmur .
  docker run --init -p 3000:3000 -e HERMES_URL=http://<hermes-host>:18789 murmur
  ```
  `docker-compose.yml` runs the same image beside its own Hermes, as on umbrelOS ([`STANDALONE.md`](STANDALONE.md)).
- **Release.** Pushing a `v*` tag runs `.github/workflows/release.yml`. It first checks that the tag matches `version` in both `package.json` and `umbrel/murmur/umbrel-app.yml`, then builds `linux/amd64` and `linux/arm64` images and pushes them to `ghcr.io/getumbrel/murmur`. The run summary prints the digest to pin. `.github/workflows/desktop.yml` attaches the desktop apps to the same release.
- **CI.** `.github/workflows/ci.yml` runs the typecheck, the unit tests, the build and a Docker build on every push to `main` (or `master`) and every pull request. It then starts the image and checks `/healthz`, the app, the manifest and the `/data` permissions, and runs the Hermes contract suite. `hermes-nightly.yml` runs that suite against Hermes's newest release. Workflow actions are pinned to commit SHAs, and `.github/dependabot.yml` proposes monthly bumps for them and for the base images.
- **umbrelOS.** The store app lives in [`umbrel/murmur/`](../umbrel/murmur), and its icon and App Store gallery in [`umbrel/gallery/murmur/`](../umbrel/gallery/murmur), mirrored in getumbrel/umbrel-apps-gallery. `sh umbrel/gallery/tools/retake.sh` takes plain screenshots on a throwaway Hermes with demo data. It runs Murmur beside its own Hermes and offers the Hermes Agent app when it's installed. See [`umbrel/README.md`](../umbrel/README.md) for how to submit it.
