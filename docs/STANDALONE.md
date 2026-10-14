# Running Murmur on its own

Murmur ships as an umbrelOS app, but it is plain MIT software. It runs anywhere Node 22 or Docker runs, and it can use any Hermes Agent dashboard: one on the same computer, or one somewhere else on your network.

Murmur is a small server plus a web app. The server serves the app and talks to Hermes for it. It signs in to Hermes itself, so Hermes passwords and tokens never reach the browser.

## Quick start

### Docker

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

## More than one Hermes

Murmur can be connected to several Hermes, say one on your Umbrel and one on a VPS, and switch between them like Slack workspaces. Add them in **Settings → Server → Add another server**. Each one is checked first, then saved with its own address, sign-in and name (rename it from its ⓘ details).

- **One at a time, per browser.** The Hermes in use is remembered in a `murmur_hermes` cookie (an id, not a credential; `SameSite=Lax`, readable by the page so it knows which Hermes it's for before it loads anything). Different browsers can use different Hermes at the same time.
- **Nothing mixes.** Switching reloads the app under a short "Switching to …" screen, so the live connection, cached data, chats and groups all start fresh. Unread marks, drafts and the other things Murmur keeps in the browser are filed per Hermes. Every tab names its Hermes on each request, so an old tab never talks to the new Hermes by mistake; other tabs follow a switch, and a tab whose Hermes was removed elsewhere moves to the first one.
- **`HERMES_URL` stays put.** A Hermes set by the environment (on umbrelOS, "This Umbrel") is always first and can't be removed or edited here, only renamed. You can still add others beside it.
- Removing a Hermes only makes Murmur forget it. Its agents and chats stay in that Hermes.

## Protecting Murmur itself

Anyone who can open Murmur can talk to your agents, and through them, to whatever your agents can do. On umbrelOS, umbrelOS signs people in before they reach Murmur. Running on your own, set a password:

```sh
-e MURMUR_PASSWORD='something long'
```

With it set, Murmur shows a sign-in screen. Hermes, the live connection and Murmur's settings API all need a signed, HttpOnly, SameSite=Lax cookie, which lasts 30 days. Changing the password signs everyone out. Sign-in attempts are limited to 10 every 10 minutes per address. The web app's static files stay public: they hold no secrets and are needed to draw the sign-in screen.

More protections are always on:

- **No cross-site use.** Requests to Hermes and settings changes must come from Murmur's own page. A browser's `Origin` has to match the host it reached, or `X-Forwarded-Host`, or both have to be loopback. Without this, any website you visit could open Murmur's WebSocket. If a reverse proxy rewrites `Host`, list the public origin in `MURMUR_ALLOWED_ORIGINS`.
- **Only names you trust.** Murmur answers only to IP addresses, `localhost`, single-label names like `nas`, `*.local`, Tailscale `*.ts.net` names, and the names you list. This stops DNS rebinding, where a website points its own name at your computer to get around the check above. If you reach Murmur at a domain of your own (`murmur.example.com`), add it to `MURMUR_ALLOWED_HOSTS` or `MURMUR_ALLOWED_ORIGINS`. Otherwise Murmur answers `403` and says so.
- **Credentials stay server-side.** The browser never sees the Hermes password, token, access token or tickets. Murmur only passes on Hermes's API (`/hermes/api/*`), never its pages, which carry the token. It strips cookies, `Authorization` and forwarding headers from browser requests before passing them to Hermes.
- **No framing.** Murmur's pages can't be put inside another site's frame, so nobody can trick a click onto an approval.

For access from outside your home network, put Murmur behind HTTPS (Caddy, Tailscale Serve, a Cloudflare tunnel) rather than exposing port 3000. Murmur marks its cookie `Secure` when the request arrived over HTTPS (`X-Forwarded-Proto: https`).

### What's stored where

`DATA_DIR/murmur.json` (mode 0600, in a 0700 directory) holds:

- each Hermes added in the app: an id, its name, its address and, if it has one, its username and password. Murmur keeps the password so it can sign in again after Hermes restarts. (A file from before multiple Hermes, with a single `hermes` entry, is moved into this list the first time Murmur reads it.)
- a new name for the `HERMES_URL` Hermes, if you renamed it.
- the secret that signs Murmur's own cookie, unless you set `MURMUR_SECRET`.

Keep the data volume private. If you'd rather not keep the Hermes password on disk, pass it as `HERMES_PASSWORD` from your secret manager instead. Settings that come from the environment are never written to the file.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where `murmur.json` lives. |
| `HERMES_URL` | unset | A Hermes set by the server: always listed first, read-only, never removed. Others can still be added in the app. Without it, the Hermes added in the app are used, falling back to `http://hermes-agent_web_1:18789` (Hermes on umbrelOS) until one is. |
| `HERMES_NAME` | "This Umbrel", "This computer", or the host | What the app calls the `HERMES_URL` Hermes (until it's renamed there). |
| `HERMES_USERNAME`, `HERMES_PASSWORD` | unset | Sign-in for a password-protected Hermes. Used with `HERMES_URL`. |
| `HERMES_TOKEN` | unset | A fixed dashboard session key. Used with `HERMES_URL`. |
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
| `GET /murmur/connections` | | `{active, connections: Connection[]}`: each Hermes with its status (checked, or from the last 10 seconds), and the one this browser uses. |
| `POST /murmur/connections` | `{url, username?, password?, name?, activate?}` | Tests, then saves: `{connection, active, connections}`. `422` with the `Connection` if it can't connect, `409 {error}` if it's already added. `activate: true` also switches this browser to it. |
| `PATCH /murmur/connections/:id` | `{name}` or `{url, username?, password?}` | Renames, or tests and then saves a new address or sign-in (its live sockets close and reconnect). A blank password keeps the saved one for the same address and username. The `HERMES_URL` one can only be renamed (`409`). |
| `DELETE /murmur/connections/:id` | | Forgets it and closes its sockets: `{active, connections}`. A browser that was using it moves to the first. `409` for the `HERMES_URL` one. |
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
  id: string                  // 'env' for HERMES_URL, 'default' before any is set up
  name: string                // "This Umbrel", "VPS", …
  url: string                 // normalized: http(s)://host[:port][/prefix]
  managed: boolean            // true when HERMES_URL sets it
  source: 'env' | 'saved' | 'default'
  mode: 'token' | 'password' | 'unknown'
  status: 'connected' | 'unreachable' | 'needs-login' | 'bad-login'
  hermesVersion?: string
  username?: string
  error?: string              // ready to show: "Couldn’t reach that address. …"
}
```
