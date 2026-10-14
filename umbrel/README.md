# Murmur on umbrelOS

`murmur/` is the app folder for [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps). Copy it into that repo as `murmur/` when submitting. `gallery/murmur/` holds the store images and icon, laid out the way [getumbrel/umbrel-apps-gallery](https://github.com/getumbrel/umbrel-apps-gallery) keeps them.

| File | Purpose |
|---|---|
| `murmur/umbrel-app.yml` | Store listing. It depends on `hermes-agent` and uses port `18793`, which no other store app uses. `version` matches `package.json`. |
| `murmur/docker-compose.yml` | `app_proxy` plus one `web` container (`murmur_web_1:3000`, running as user 1000:1000). It mounts `${APP_DATA_DIR}/data` at `/data` for `murmur.json`, which holds any other Hermes added in Settings → Hermes (with their sign-ins) and a new name for "This Umbrel". With `HERMES_URL` pinned and no `MURMUR_PASSWORD`, nothing else is written there. |
| `murmur/data/.gitkeep` | Ships the data folder so umbrelOS creates it owned by the app user, not root. |
| `gallery/murmur/icon.svg` | 256×256 square icon with no rounded corners. umbrelOS applies its own mask. |
| `gallery/murmur/1.jpg`–`5.jpg` | 1440×900 store screenshots, in the order `gallery:` lists them: home, a chat asking for approval, a group, the agent templates and the welcome. |

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

> **Release blockers.** Two placeholders are left on purpose, each marked with a `TODO(…)` comment. Fill them before the folder goes into `umbrel-apps`. Check with `grep -rn '<digest>\|/pull/TODO' murmur/`, which must print nothing:
> - `TODO(digest)`: `image: …@sha256:<digest>` in `docker-compose.yml` (step 3 above). v0.1.0 has not been pushed yet.
> - `TODO(submission)`: `submission: …/pull/TODO` in `umbrel-app.yml` (the PR URL, once it's open).

## Submitting to the store

1. Copy `murmur/` into a branch of `getumbrel/umbrel-apps`.
2. Test it on a real Umbrel. Install it from a community app store, or copy the folder into a dev Umbrel's app store. Check the following:
   - Murmur opens behind the Umbrel login.
   - Chats stream.
   - Approvals work.
   - "Add to Home Screen" picks up the icon and name (those files are on `PROXY_AUTH_WHITELIST`).
3. Open the PR:
   - Attach `gallery/murmur/` (the icon and `1.jpg`–`5.jpg`). The Umbrel team uploads them to the gallery repo under `murmur/`, where `gallery:` in the manifest points.
   - Fill in `submission` with the PR URL and remove its `TODO(submission)` comment.

## How Murmur reaches Hermes (and a follow-up for the Hermes app)

All apps share `umbrel_main_network`. Murmur's server talks directly to `http://hermes-agent_web_1:18789` (`HERMES_URL`). It does not go through Hermes's app proxy.

The Hermes Agent app runs with `HERMES_UMBREL_APP_PROXY_AUTH=1`, which means Hermes trusts every request that reaches its port and puts its per-start dashboard session token into the page. Murmur reads the token from that page and attaches it to REST and WebSocket calls. When Hermes restarts and rejects the old token, Murmur fetches a fresh one.

This works today, but it relies on Hermes's app-proxy auth bypass. The cleaner setup is for the Hermes Agent app to export a dedicated token:

```sh
# hermes-agent/exports.sh
export APP_HERMES_AGENT_TOKEN="$(derive_entropy "hermes-agent-dashboard-token")"
```

```yaml
# hermes-agent/docker-compose.yml (web.environment)
HERMES_DASHBOARD_SESSION_TOKEN: ${APP_HERMES_AGENT_TOKEN}
```

```yaml
# murmur/docker-compose.yml (web.environment)
HERMES_TOKEN: ${APP_HERMES_AGENT_TOKEN}
```

Murmur's server already supports `HERMES_TOKEN`: it uses that token and stops reading the page. Once the Hermes app ships the export, add the line above.
