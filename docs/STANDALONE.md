# Running Murmur on its own

Murmur ships as an umbrelOS app, but it is plain MIT software. It runs anywhere Node 22 or Docker runs. It can come with its own Hermes, or use any Hermes Agent dashboard you already have: one on the same computer, or one somewhere else on your network.

Murmur is a small server plus a web app. The server serves the app and talks to Hermes for it. It signs in to Hermes itself, so Hermes passwords and tokens never reach the browser.

## Quick start

### Docker Compose, with Hermes built in (recommended)

[`docker-compose.yml`](../docker-compose.yml) runs Murmur and a Hermes of its own, side by side:

```sh
git clone https://github.com/getumbrel/murmur && cd murmur
cp .env.example .env    # set MURMUR_HERMES_PASSWORD, e.g. to the output of: openssl rand -hex 32
docker compose up -d
```

Open http://localhost:3000. On first run Murmur asks where your agents should live: **Start fresh** uses the Hermes that came with it, with nothing else to set up. If Murmur finds a Hermes you already run on this computer, it offers that too.

- **Private.** The built-in Hermes isn't published on any port. Only Murmur can reach it, and it signs in with `MURMUR_HERMES_PASSWORD`, which Hermes and Murmur both read from `.env`.
- **Staying signed in.** Set `MURMUR_HERMES_SECRET` (at least 16 characters) too, so Hermes keeps Murmur's sign-in across restarts. Without it, Murmur just signs in again.
- **Your data.** Murmur's settings are in the `murmur-data` volume, and Hermes's agents, chats and API keys in `hermes-data`.
- **Resources.** The first start of Hermes takes from about 15 seconds to a few minutes, and Murmur shows its progress. Hermes uses about 600 MB of memory while idle, and its image is about 1.1 GB to download.

### Docker, Murmur alone

To use a Hermes you already run, without the built-in one:

```sh
docker build -t murmur .
docker run -d --name murmur -p 3000:3000 -v murmur-data:/data murmur
```

Open http://localhost:3000. Murmur asks for the address of your Hermes dashboard, checks it, and remembers it in `/data/murmur.json`.

To pin the address instead of choosing it in the app:

```sh
docker run -d --name murmur -p 3000:3000 -v murmur-data:/data \
  -e HERMES_URL=http://192.168.1.20:9119 \
  -e HERMES_USERNAME=me -e HERMES_PASSWORD='…' \
  murmur
```

### Node

```sh
npm ci && npm run build
HERMES_URL=http://localhost:9119 node server/index.ts   # or leave HERMES_URL out and choose in the app
```

## Connecting to Hermes

Murmur works out how to sign in by reading Hermes's public `/api/status`.

| How Hermes is running | What Murmur does |
|---|---|
| `hermes dashboard` on the **same computer** (it listens on 127.0.0.1 by default) | Reads the dashboard's session key from its page. Nothing to type except the address, e.g. `http://localhost:9119`. |
| A dashboard on **another computer** (`--host 0.0.0.0`) | Hermes requires a sign-in for this. Turn on its built-in password sign-in, then enter the same username and password in Murmur. |
| You already have the dashboard's session key | Set `HERMES_TOKEN`. Hermes makes a new key every time it starts unless you set `HERMES_DASHBOARD_SESSION_TOKEN` on it, so this mostly suits fixed setups. |

To turn on Hermes's password sign-in (bundled with Hermes, no extra service needed):

```sh
HERMES_DASHBOARD_BASIC_AUTH_USERNAME=me \
HERMES_DASHBOARD_BASIC_AUTH_PASSWORD='a long password' \
hermes dashboard --host 0.0.0.0 --port 9119
```

The Hermes Docker image does the same with `HERMES_DASHBOARD=1` plus those two variables.

With a password, Murmur signs in once and keeps the short-lived access token in memory. It renews the token the way Hermes Desktop does (`/auth/native/refresh`) and asks for a new single-use ticket for every live connection. If Hermes restarts and forgets its sessions, Murmur signs in again on its own. You don't need to, but setting `HERMES_DASHBOARD_BASIC_AUTH_SECRET` on Hermes keeps its sessions alive across restarts.

**Murmur in Docker, Hermes on the same machine.** Inside a container, `localhost` means the container itself. Use `http://host.docker.internal:9119` on macOS and Windows. On Linux, run Murmur with `--network host`. A dashboard bound to 127.0.0.1 only accepts connections from its own machine, so that is the only way to reach it without a password.

**Hermes's gateway.** Routines, Telegram and WhatsApp run in Hermes's gateway, which `hermes dashboard` doesn't start, and a Hermes whose gateway has never run has nowhere to keep chats yet. When Murmur finds it off, it asks Hermes to start it. Where Hermes can't (Hermes 0.22.5's Docker images can't yet), Murmur shows the command to run on the computer running Hermes, or in its container: `hermes gateway start`. Hermes's Docker image runs both when started with `gateway run` and `HERMES_DASHBOARD=1`.

## More than one Hermes

Murmur can be connected to several Hermes, say one on your Umbrel and one on a VPS, and switch between them like Slack workspaces. Add them in **Settings → Server → Add another server**. Each one is checked first, then saved with its own address, sign-in and name (rename it from its ⓘ details).

- **One at a time, per browser.** The Hermes in use is remembered in a `murmur_hermes` cookie (an id, not a credential; `SameSite=Lax`, readable by the page so it knows which Hermes it's for before it loads anything). Different browsers can use different Hermes at the same time.
- **Nothing mixes.** Switching reloads the app under a short "Switching to …" screen, so the live connection, cached data, chats and groups all start fresh. Unread marks, drafts and the other things Murmur keeps in the browser are filed per Hermes. Every tab names its Hermes on each request, so an old tab never talks to the new Hermes by mistake; other tabs follow a switch, and a tab whose Hermes was removed elsewhere moves to the first one.
- **`HERMES_URL` stays put.** A Hermes set by the environment is always first and can't be removed or edited here, only renamed. You can still add others beside it.
- **The built-in stays too.** Once used, Murmur's built-in Hermes ("Built-in") is one of the list for good: it can be renamed, but not removed or pointed elsewhere. Until then, Settings → Server offers it, and any Hermes Murmur found, as suggestions.
- Removing a Hermes only makes Murmur forget it. Its agents and chats stay in that Hermes.

## Protecting Murmur itself

Anyone who can open Murmur can talk to your agents, and through them, to whatever your agents can do. On umbrelOS, umbrelOS signs people in before they reach Murmur. Running on your own, set a password:

```sh
-e MURMUR_PASSWORD='something long'
```

With it set, Murmur shows a sign-in screen. Hermes, the live connection and Murmur's settings API all need a signed, HttpOnly, SameSite=Lax cookie, which lasts 30 days. Changing the password signs everyone out. Sign-in attempts are limited to 10 every 10 minutes per address. The web app's static files stay public: they hold no secrets and are needed to draw the sign-in screen. So does one Hermes address, `GET /hermes/api/mcp/oauth/callback/<app>`, where an app (Notion, Linear…) sends the browser back after someone signs in to it for an agent: that often happens in another browser, without Murmur's cookie. Hermes keeps it public too and accepts only the one-time state it issued, and Murmur passes on nothing but the address.

More protections are always on:

- **No cross-site use.** Requests to Hermes and settings changes must come from Murmur's own page. A browser's `Origin` has to match the host it reached, or `X-Forwarded-Host`, or both have to be loopback. Without this, any website you visit could open Murmur's WebSocket. If a reverse proxy rewrites `Host`, list the public origin in `MURMUR_ALLOWED_ORIGINS`.
- **Only names you trust.** Murmur answers only to IP addresses, `localhost`, single-label names like `nas`, `*.local`, Tailscale `*.ts.net` names, and the names you list. This stops DNS rebinding, where a website points its own name at your computer to get around the check above. If you reach Murmur at a domain of your own (`murmur.example.com`), add it to `MURMUR_ALLOWED_HOSTS` or `MURMUR_ALLOWED_ORIGINS`. Otherwise Murmur answers `403` and says so.
- **Credentials stay server-side.** The browser never sees the Hermes password, token, access token or tickets. Murmur only passes on Hermes's API (`/hermes/api/*`), never its pages, which carry the token. It strips cookies, `Authorization` and forwarding headers from browser requests before passing them to Hermes.
- **No framing.** Murmur's pages can't be put inside another site's frame, so nobody can trick a click onto an approval.

For access from outside your home network, put Murmur behind HTTPS (Caddy, Tailscale Serve, a Cloudflare tunnel) rather than exposing port 3000. Murmur marks its cookie `Secure` when the request arrived over HTTPS (`X-Forwarded-Proto: https`).

### What's stored where

`DATA_DIR/murmur.json` (mode 0600, in a 0700 directory) holds:

- each Hermes added in the app: an id, its name, its address and, if it has one, its username and password. Murmur keeps the password so it can sign in again after Hermes restarts. (A file from before multiple Hermes, with a single `hermes` entry, is moved into this list the first time Murmur reads it.)
- the built-in Hermes, once chosen or added: its place in the list and its name. Its address and password always come from the environment.
- a new name for the `HERMES_URL` Hermes, if you renamed it.
- the secret that signs Murmur's own cookie, unless you set `MURMUR_SECRET`.
- `setupSeen`, written on the first start, so an update can be told apart from a new install (see `GET /murmur/setup` below).

Keep the data volume private. If you'd rather not keep the Hermes password on disk, pass it as `HERMES_PASSWORD` from your secret manager instead. Settings that come from the environment are never written to the file.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where `murmur.json` lives. |
| `HERMES_URL` | unset | A Hermes set by the server: always listed first, read-only, never removed, and the app never asks where agents live. Others can still be added in the app. Without it, the app asks on first run and uses the Hermes chosen or added there. |
| `HERMES_NAME` | "Hermes Agent", "This computer", or the host | What the app calls the `HERMES_URL` Hermes (until it's renamed there). |
| `HERMES_USERNAME`, `HERMES_PASSWORD` | unset | Sign-in for a password-protected Hermes. Used with `HERMES_URL`. |
| `HERMES_TOKEN` | unset | A fixed dashboard session key. Used with `HERMES_URL`. |
| `MURMUR_BUILTIN_HERMES_URL` | unset | The Hermes that comes with Murmur, e.g. `http://hermes:9119` in `docker-compose.yml`. Unset: no built-in, and no "Start fresh". |
| `MURMUR_BUILTIN_HERMES_USERNAME`, `MURMUR_BUILTIN_HERMES_PASSWORD` | `murmur`, unset | The built-in's dashboard sign-in: the same values as its `HERMES_DASHBOARD_BASIC_AUTH_USERNAME` and `_PASSWORD`. |
| `MURMUR_FIND_HERMES` | the Hermes Agent app on umbrelOS, and `localhost:9119`, `127.0.0.1:9119`, `localhost:18789` | Where to look for a Hermes you already have, as `Name=url` pairs or bare addresses, comma-separated. What answers is offered on first run, and in Settings → Server. A password-protected one is sent nothing until someone signs in. |
| `MURMUR_PASSWORD` | unset | Requires this password to use Murmur. |
| `MURMUR_SECRET` | generated, saved in `DATA_DIR` | Key that signs Murmur's sign-in cookie. |
| `MURMUR_ALLOWED_ORIGINS` | unset | Extra browser origins allowed to use Murmur, comma-separated (`https://murmur.example.com`). Their hosts are allowed too. `*` turns the origin check off. |
| `MURMUR_ALLOWED_HOSTS` | unset | Extra host names Murmur answers to, comma-separated. A leading dot (`.example.com`) allows subdomains, and `*` turns the check off (only safe behind a proxy that signs people in, as on umbrelOS). |
| `MURMUR_LOCAL_MODEL_URLS` | Ollama and LocalAI on umbrelOS | `Name=url` pairs to look for local model servers. |
| `STATIC_DIR` | `dist` | The built web app. |

## Server API

Every response is JSON with `cache-control: no-store`. Changes need a same-origin request (and, with `MURMUR_PASSWORD`, the sign-in cookie).

**Which Hermes a request is for:** the `X-Murmur-Hermes: <id>` header (REST), or `?hermes=<id>` on the WebSocket, then the `murmur_hermes` cookie, then the first Hermes. A header or parameter naming a Hermes that no longer exists gets `409 {"error":"hermes_gone"}` rather than another Hermes's data. Any response fixes a cookie that names no Hermes.

| Endpoint | Body | Answer |
|---|---|---|
| `GET /murmur/setup` | `?again=1` to look afresh | `Setup`: whether a Hermes is chosen yet, the built-in's state, and the Hermes Murmur found that it doesn't have. What it found is reused for a few seconds unless `again` is set ("Check again"). |
| `POST /murmur/setup` | `{use: 'builtin'}` or `{use: 'found', id, username?, password?}` | Makes it this Murmur's Hermes and this browser's: `{connection, active, connections}`. `422` with the `Connection` if it can't be used, `404` for an unknown `id`, `409 {error: 'decided', active, connections}` once a Hermes is chosen. |
| `GET /murmur/connections` | | `{active, connections: Connection[]}`: each Hermes with its status (checked, or from the last 10 seconds), and the one this browser uses. |
| `POST /murmur/connections` | `{url, username?, password?, name?, activate?}`, or `{found: id, username?, password?}`, or `{builtin: true}` | Tests, then saves: `{connection, active, connections}`. `422` with the `Connection` if it can't connect, `409 {error}` if it's already added. `activate: true` also switches this browser to it. A found Hermes is named by its id from `GET /murmur/setup`, so the address a sign-in goes to is always the server's. |
| `PATCH /murmur/connections/:id` | `{name}` or `{url, username?, password?}` | Renames, or tests and then saves a new address or sign-in (its live sockets close and reconnect). A blank password keeps the saved one for the same address and username. The `HERMES_URL` one can only be renamed (`409`). |
| `DELETE /murmur/connections/:id` | | Forgets it and closes its sockets: `{active, connections}`. A browser that was using it moves to the first. `409` for the `HERMES_URL` one and the built-in. |
| `POST /murmur/connections/:id/activate` | | This browser uses it from now on (sets the cookie): `{active, connections}`. |
| `GET /murmur/connection` | | The `Connection` for this request's Hermes. |
| `POST /murmur/connection/test` | `{url, username?, password?}` | A `Connection` for that address. Nothing is saved. |
| `PUT /murmur/connection` | `{url, username?, password?}` | Tests, then saves this request's Hermes (on a first run, adds one). `422` with the `Connection` if it can't connect; `409` for the `HERMES_URL` one. |
| `DELETE /murmur/connection` | | Forgets this request's Hermes and returns the first one's `Connection`. |
| `GET /murmur/session` | | `{required, signedIn}` |
| `POST /murmur/login` | `{password}` | `200 {ok}` and sets the cookie, `401 {error}`, or `429 {error}` with `Retry-After` |
| `POST /murmur/logout` | | Clears the cookie and closes the live connections it opened. |

```ts
type Connection = {
  id: string                  // 'env' for HERMES_URL, 'builtin' for the built-in, 'default' before any is set up
  name: string                // "Built-in", "Hermes Agent", "VPS", …
  url: string                 // normalized: http(s)://host[:port][/prefix]
  managed: boolean            // true when HERMES_URL sets it, or it's the built-in
  source: 'env' | 'saved' | 'default' | 'builtin'
  mode: 'token' | 'password' | 'unknown'
  status: 'connected' | 'unreachable' | 'needs-login' | 'bad-login'
  hermesVersion?: string
  username?: string
  error?: string              // ready to show: "Couldn’t reach that address. …"
}

type Setup = {
  decided: boolean            // a Hermes is chosen (or pinned by HERMES_URL): the app doesn't ask
  umbrel: boolean             // running on umbrelOS
  builtin: null | {           // null: this Murmur has no built-in Hermes
    state: 'starting' | 'ready' | 'unreachable' | 'outdated'
    version?: string
    minVersion?: string       // with 'outdated'
    hasModel?: boolean        // a model is set up
    agents?: number
    added: boolean            // it's in the list of connections
  }
  found: Array<{              // every Hermes found, minus those Murmur has (by address or by install)
    id: string                // stable per address; send it back to choose or add it
    name: string              // "Hermes Agent", "Hermes on this computer", "Hermes on studio.local"
    where: 'umbrel' | 'computer' | 'network'
    url: string
    host: string              // "studio.local:9119"
    version?: string
    outdated?: boolean
    minVersion?: string
    needsSignIn?: boolean     // password-protected: Murmur sent it nothing
    hasModel?: boolean
    agents?: Array<{ id: string; name: string; hue?: number; color?: string; isDefault?: boolean }>
    agentCount?: number
    chats?: number
  }>
}
```

`builtin.state` is `starting` from when Murmur starts until the built-in answers and takes Murmur's sign-in (for up to five minutes), and again for a minute if it goes quiet after that, as on a restart. Then it's `unreachable`.

An update from a Murmur that was pinned to the Hermes Agent app on umbrelOS is decided on its first start when it can be told apart from a new install (a `murmur.json` from before, without `setupSeen`, and no Hermes saved): the Hermes Agent app is saved as the chosen Hermes when it answers, so nobody who used it is asked again. Otherwise the app asks, with the Hermes Agent app first.
