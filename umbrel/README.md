# Murmur on umbrelOS

`murmur/` is the app folder for [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps). Copy it into that repo as `murmur/` when submitting. `gallery/murmur/` holds the store images and icon, laid out the way [getumbrel/umbrel-apps-gallery](https://github.com/getumbrel/umbrel-apps-gallery) keeps them.

| File | Purpose |
|---|---|
| `murmur/umbrel-app.yml` | Store listing. It needs no other app, uses port `18793`, which no other store app uses, and lets umbrelOS move its data (`storage.dataRoot`). `version` matches `package.json`. |
| `murmur/docker-compose.yml` | `app_proxy`, Murmur's `web` container (`murmur_web_1:3000`, running as user 1000:1000) and its own Hermes (`murmur_hermes_1:9119`). `web` mounts `${APP_DATA_DIR}/data/murmur` at `/data` for `murmur.json`: which Hermes was chosen, any others added in Settings → Server (with their sign-ins), and their names. Hermes keeps its agents, chats and API keys in `${APP_DATA_DIR}/data/hermes`, a folder Murmur's container can't see. Both sit under `data/`, so they move together when umbrelOS relocates the app's data. |
| `murmur/exports.sh` | The built-in Hermes's dashboard password and session secret, derived per install. Only Murmur and its Hermes see them. |
| `murmur/data/murmur/.gitkeep`, `murmur/data/hermes/.gitkeep` | Ship the data folders so umbrelOS creates them owned by the app user, not root. |
| `gallery/murmur/icon.svg` | 256×256 square icon with no rounded corners. umbrelOS applies its own mask. |
| `gallery/murmur/1.jpg`–`5.jpg` | 1440×900 screenshots for the Umbrel team's App Store images: home, a chat asking for approval, a group, the agent templates and the welcome. |

## Store screenshots

The screenshots come from the real app, built for production, with invented demo data on a throwaway Hermes. Every agent, chat and group in them is made up; no real Hermes is ever used. To retake them after the UI changes:

```sh
sh umbrel/gallery/tools/retake.sh
```

It needs Docker and Playwright's Chromium, takes about two minutes and removes everything it started when it's done. It works in four steps:

1. `tools/model.mjs` is a scripted, OpenAI-compatible model, so every reply, work step and approval comes out the same each time.
2. A Hermes Agent container (the store app's image) starts with an empty data folder, and Murmur's server serves a fresh build against it.
3. `tools/seed.mjs` adds the demo agents (Scout, Wren, Basil, Quill, Sunny and Ada), one chat each, and the "Lisbon weekend" group, then backdates the chats so the roster reads like a real week. It refuses to run against port 18789, where a real Hermes usually lives.
4. `tools/capture.mjs` takes each shot at 1440×900 with a device scale factor of 2, then scales it down to a 1440×900 JPEG. The main agent's chat is sent live while it's captured, because only a live turn can ask for approval. Shots 3 and 5 are in dark mode.

## Releasing a version

1. Bump `version` in `package.json` and in `murmur/umbrel-app.yml`, then write `releaseNotes` in plain words. The `release` workflow refuses a tag that doesn't match both.
2. Push a tag such as `git tag v0.1.0 && git push --tags`. The `release` workflow builds `linux/amd64` and `linux/arm64` images and pushes them to `ghcr.io/getumbrel/murmur:v0.1.0`. It prints the multi-arch digest in the run summary. You can also read it from the registry:
   ```sh
   docker buildx imagetools inspect ghcr.io/getumbrel/murmur:v0.1.0 --format '{{json .Manifest.Digest}}'
   ```
3. Pin that digest in `murmur/docker-compose.yml`, for example `ghcr.io/getumbrel/murmur:v0.1.0@sha256:…`.

## Submitting to the store

Murmur was submitted in [getumbrel/umbrel-apps#6196](https://github.com/getumbrel/umbrel-apps/pull/6196). For a new version:

1. Copy `murmur/` over the app's folder in a branch of `getumbrel/umbrel-apps`, with the new digest and `releaseNotes`.
2. Run the store's linter there: `node .tools/lint-apps.mjs murmur --check-images`.
3. Test it on a real Umbrel. Install it from a community app store, or copy the folder into a dev Umbrel's app store. Check the following:
   - Murmur opens behind the Umbrel login.
   - On first run it asks where your agents should live. With the Hermes Agent app installed, it offers that app with its agents; without it, "Start fresh" readies the built-in Hermes (the first start takes a minute or two on a small Umbrel).
   - An update from a version that used the Hermes Agent app carries on with it, without asking.
   - Chats stream.
   - Approvals work.
   - "Add to Home Screen" picks up the icon and name (those files are on `PROXY_AUTH_WHITELIST`).
4. Open the PR with the store's template.

A new app ships with `gallery: []` and no `icon`. The Umbrel team makes the App Store images and hosts them, with the icon, in [getumbrel/umbrel-apps-gallery](https://github.com/getumbrel/umbrel-apps-gallery). `gallery/murmur/` keeps the screenshots and `icon.svg` to hand over.

## How Murmur reaches Hermes

All apps share `umbrel_main_network`, and Murmur's server talks to Hermes directly, never through an app proxy.

- **The built-in Hermes** (`murmur_hermes_1:9119`) runs Hermes's dashboard and messaging gateway, like the Hermes Agent app, but gated by Hermes's own username and password sign-in. The password and the key that signs its sessions come from `exports.sh`, so only Murmur can get in. It has no `app_proxy` and no published port, and other apps on the network get `401` from everything but Hermes's public status and health checks. Murmur signs in like any password-protected Hermes: a short-lived access token for REST, and a single-use ticket for each live connection.
- **The Hermes Agent app** (`hermes-agent_web_1:18789`), when it's installed, is offered on first run (`MURMUR_FIND_HERMES`). It runs with `HERMES_UMBREL_APP_PROXY_AUTH=1`, so it trusts every request that reaches its port and puts its per-start dashboard session token in its page. Murmur reads the token from that page, as before, and fetches a fresh one when Hermes restarts.

A session token alone can't gate a Hermes dashboard any more (from 0.22, Hermes won't serve a gated dashboard without a sign-in provider), so the old plan for the Hermes Agent app to export one no longer applies. If it ever drops its app-proxy bypass for a password, Murmur can sign in to it as it does to the built-in.
