# Murmur ↔ Hermes: apps, WhatsApp, who can message, usage, moving agents and passwords

Target: Hermes Agent **0.22** (`ghcr.io/getumbrel/hermes-agent-umbrel:v0.22.0-4`). Routes are in
`hermes_cli/web_routers/*.py`, RPCs in `tui_gateway/methods*.py`. Everything here is per agent (a Hermes
profile, passed as `?profile=` or `profile` in the body) unless it says otherwise. Each part was checked
against a throwaway Hermes; what couldn't be (a real app sign-in, a linked phone, a live model) is said.

---

## 1. Apps (MCP servers from Hermes's catalog)

**Where:** the Apps tile on the agent page (`src/features/apps/`, state in `src/state/apps.ts`). Connected
apps first, each with an on/off switch and a quiet status; below, an icon wall with search, everyday apps
first and "For developers" after. Umbrel opens Settings → Umbrel instead.

| Step | Hermes |
|---|---|
| Catalog (same for every agent) | `GET /api/mcp/catalog` |
| The agent's apps | `GET /api/mcp/servers` (plugin-owned ones are hidden) |
| Add | `POST /api/mcp/catalog/install {name, env, enable, profile}` |
| Point the sign-in back at Murmur | `PUT /api/config {config:{mcp_servers:{<app>:{oauth:{redirect_uri}}}}}` |
| Sign in | `POST /api/mcp/servers/{name}/auth` → `{flow_id, authorization_url}`, then poll `GET /api/mcp/oauth/flows/{id}` until `approved`; cancel with `DELETE` |
| Pick up the change in open chats | RPC `reload.mcp {confirm:true}` |
| Manage | `PUT /api/mcp/servers/{name}/enabled`, `DELETE /api/mcp/servers/{name}` |
| Health | `POST /api/mcp/servers/{name}/test`, one at a time (parallel tests stumble) |

**The OAuth return goes through Murmur.** Hermes would send the app back to its own address, which the
browser can't reach, and it ignores the scheme in forwarded headers. So before each sign-in Murmur sets that
server's `oauth.redirect_uri` to `<Murmur's origin>/hermes/api/mcp/oauth/callback/<app>` (it stays in the
agent's config). `server/oauth-return.ts` lets exactly that GET through without Murmur's password cookie or
the desktop app's header, because it often arrives in the person's own browser. Hermes treats the route as
public and checks the one-time `state`; Murmur passes the query on with no credentials and shows its own
"You're signed in" page (which closes itself), never Hermes's.

**Caveats**
- Most apps (Notion, Linear, Todoist, Gamma…) only accept an https or loopback return address. Over plain
  `http://umbrel.local` connecting fails at once with "Open Murmur over https to connect it". It works over
  https, on localhost, and in the desktop app. Hermes's own dashboard has the same limit.
- Seven catalog apps are hidden because they can't start a sign-in through Hermes 0.22 (Algolia, Asana,
  Dropbox, Hugging Face, Indeed, Semgrep, Strava). The list is hard-coded in `apps.ts` and will go stale.
- Sign-ins are per agent: "Also for" adds the app to another agent, which then signs in on its own.
- Removing an app leaves its saved token on Hermes's disk (no API to delete it), so adding it back is quick.
- An abandoned sign-in blocks that app for up to 5 minutes. Retrying from the same tab releases it.
- Brand marks come from Simple Icons (inline SVG paths, `features/apps/marks.ts`); others get a coloured initial.

## 2. WhatsApp

**Where:** the WhatsApp tile beside Telegram on the agent page, and its sheet (`src/features/whatsapp/`,
state in `src/state/whatsapp.ts`). Two modes: **Your WhatsApp** (`self-chat`: talk in "Message yourself")
or **A spare number** (`bot`: anyone can write; new people wait for your OK, §3).

| Step | Hermes |
|---|---|
| Start, get a QR | `POST /api/messaging/whatsapp/onboarding/start {mode, profile}` → `{pairing_id, status, qr_payload, expires_at}` |
| Follow it | `GET …/onboarding/{id}`: `installing` → `starting` → `waiting` (QR) → `connected` (scanned) / `expired` / `error` |
| Save it, turn WhatsApp on | `POST …/onboarding/{id}/apply?profile=`; Murmur restarts messaging itself if Hermes's restart didn't start (`POST /api/gateway/restart`) |
| Stop the bridge | `DELETE …/onboarding/{id}` (also on sheet close and `pagehide`) |
| Status | `GET /api/messaging/platforms`, plus `GET /api/status` → `gateway_platforms.whatsapp` (below) |
| Disconnect | `PUT /api/messaging/platforms/whatsapp {enabled:false, clear_env:[…]}` |
| The linked name and number | RPC `profiles.configure {ui_meta:{'murmur-whatsapp':{name, phone, mode}}}` (Hermes doesn't keep them where Murmur can read) |

Unlike Telegram (driven by Murmur's server), the setup runs in the tab. That's safe because Hermes saves the
link the moment the phone scans and a fresh start reports it as already linked: a tab that sleeps, or a
Hermes that forgets the setup (`404`), just starts again and finishes. `410` means the code expired.

**Caveats**
- Hermes links WhatsApp the way WhatsApp Web does, through an **unofficial bridge** (Baileys, in
  `scripts/whatsapp-bridge/`). WhatsApp doesn't officially support this, so the sheet says a spare number is
  the safest bet. The first start installs the bridge, so it can take a minute.
- Hermes 0.22 calls WhatsApp "not configured" for every agent but the main one. Murmur treats a saved
  `whatsapp_setup.mode` as set up and reads the agent's own messaging status for how it's doing.
- Disconnect can't unlink the device (no API): it stays under Linked devices on the phone, and the confirm
  says so. Removing it there and then setting up again is untested.
- A phone can't scan its own screen, so in "Your WhatsApp" mode on a phone the sheet suggests a computer.

## 3. Who can message an agent ("Needs you")

**Where:** request cards under "Needs you" on Home and in the wide sidebar ("Sam wants to message Atlas",
Allow / Not now), and a people list inside the WhatsApp and Telegram sheets (`src/features/access/`,
state in `src/state/access.ts`).

- `GET /api/pairing` → `{pending, approved}`; `POST /api/pairing/approve {platform, request_id, profile}`;
  `POST /api/pairing/revoke {platform, user_id, profile}`. The `pairing.changed` event refetches every agent's
  list; a 60 s poll catches a missed one.
- **Not now** only hides a request in this browser (localStorage, an hour). Hermes can't decline one; it
  expires on its own after an hour.
- WhatsApp user ids aren't always phone numbers, so they're never shown as names.
- Telegram set up through Murmur allows only the owner, so it rarely produces requests.

## 4. Usage

- **Plan limits and resting models:** see [models-and-onboarding.md](models-and-onboarding.md), §5.1.
- **This chat** (`src/state/insights.ts`, `chat-screen/chat-info.tsx`): once a chat is over half full, a small
  ring sits beside the model chip; tapping it (or Chat info in the chat menu) opens a sheet with how full
  it is, what's taking the room (folded from `session.context_breakdown`'s eight categories into five),
  the spend and how many times it made room. RPC `session.usage` gives the live context numbers; spend
  comes from `GET /api/sessions/{id}` (`actual_cost_usd`, else `estimated_cost_usd`), because 0.22 doesn't
  send cost in `session.usage`. Hidden when a plan covers the chat (`cost_status: included`) or nothing was spent.
- **This week** (agent page, between the tiles and Chats; `agent-page/week.tsx`): `GET /api/analytics/usage?days=31`
  → seven day bars, this month's spend and the three most-used kinds of tool. Hidden until there's been a chat
  that week.
- **Costs are estimates.** Hermes prices tokens from its own table unless the provider reports a billed
  amount. Murmur prefers billed, and marks estimates with "≈".

## 5. Moving an agent

| What | Where in Murmur | Hermes |
|---|---|---|
| Export one agent | Edit sheet → Export | `POST /api/profiles/{name}/export {extra_files:{'murmur.json': look}}`, then `GET /api/fs/download?path=` |
| Import an agent | Settings → Agents, and the New agent sheet | `GET /api/files` (home), `POST /api/files/upload-stream`, `POST /api/profiles/import {archive, name}`, `DELETE /api/files` (the staged upload), `GET /api/fs/read-text` (the look) |

Files stream to disk through Murmur's relay (`fs/download` is the one Hermes path allowed to be markup); nothing
is held in memory. Hermes names them (`scout-<date>-<time>.tar.gz`). An imported agent
gets a fresh id and name if taken ("Scout 2"), its name, colour and role back from `murmur.json`, and is
settled in like any new agent (timezone, toolsets, Umbrel).

**Caveats**
- **An agent export leaves keys and sign-ins behind** (`.env`, `auth.json`, and its passwords in `vault/`); an
  imported agent thinks with the main agent's keys. Whether it includes chats is Hermes's call: named agents' do, the main agent's don't.
- **No "back up everything".** Backing up is umbrelOS's job (its backups include Murmur and its Hermes) or
  the Hermes host's; a second backup button would only make people wonder which one counts. (Hermes's own
  `POST /api/ops/backup` also fails on a fresh `v0.22.0-4` image until `hermes pm repair`.)
- Exported archives stay on Hermes's disk after download; nothing cleans them up yet.

## 6. Passwords (the vault)

**Where:** the Passwords tile on the agent page (`src/features/vault/`, state in `src/state/vault.ts`).
`test/contract/vault.contract.ts` checks all of this, including a login and a card saved from Murmur being
filled into real pages by the agent's browser.

Each agent has its own encrypted vault (`<profile home>/vault/`, Fernet, 0600). Hermes fills its items into
pages for the agent through `browser_vault` (deferred behind `tool_search`); the agent sees handles and a
login's identifier, never a password, card or address.

| RPC | Params | Result |
|---|---|---|
| `vault.list` | `{profile}` | `{items:[{id, kind, label, origin, created_at, identifier?, identifier_type?, has_otp?, backend}]}`. Metadata only. Unlocked password managers' items come too (`backend` other than `local`); Murmur shows only `local` |
| `vault.add` | `{profile, kind: login\|payment\|address, label, origin, secret}` | `{id}` |
| `vault.remove` | `{profile, id}` | `{removed}` (`false` if already gone) |

**`secret`, by kind** (Hermes's field names are what checkout pages are filled from):
- `login`: `identifier_type` (`email`, `phone`, `username`), `identifier`, `password`, and optionally `otp_secret`
  (a base32 seed or an `otpauth://totp` link: Hermes then makes the sign-in codes). The identifier moves into the
  item's metadata.
- `payment`: `card_number`, `exp_month`, `exp_year` (Murmur sends four digits; Hermes derives `MM/YY` for a
  combined field), `cvc`, and optionally `cardholder_name` and `billing_postal_code`.
- `address`: `address_line1`, `city`, `postal_code`, `country`, and optionally `address_line2` and `state`.

**Caveats**
- **No edit, and no way back to a secret.** A change is a new item and the old one removed (Murmur adds first,
  then removes). Its id changes, which is harmless: the agent lists handles each time.
- **One exact site per item.** Fills are refused on any other origin (`origin_mismatch`), and a card or address
  without one is never filled (`no_origin`). `github.com` and `www.github.com` are different sites, so a login
  saved from chat (`vault.save_login`, which takes the page's own origin) is the surest kind.
- **Errors** are code 5095 with a readable message ("payment items require cvc", "authenticator key must be a
  base32 secret or an otpauth:// URI"); Murmur retells them.
- **A card is filled only after an OK**: an `approval` with `pattern_keys: ["mcp_elicitation"]` ("Fill payment
  card 'Visa •••• 4242' on …"), which Murmur's approval card already shows.
- **The browser redacts what it echoes**: any saved value that comes back in a tool result (even a card's
  `12` expiry month) reads as `«redacted-vault-secret»`.
- 1Password and Bitwarden (`vault.sources`, `vault.unlock`, `vault.lock`, `vault.source.set`) need their CLIs
  inside Hermes's container, which Umbrel doesn't have; Murmur leaves them out.
