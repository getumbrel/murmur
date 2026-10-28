# Murmur ↔ Hermes: apps, email, WhatsApp, who can message, usage, moving agents and passwords

Target: Hermes Agent **0.22** (`ghcr.io/getumbrel/hermes-agent-umbrel:v0.22.5-1`, the first with `murmur-mail`). Routes are in
`hermes_cli/web_routers/*.py`, RPCs in `tui_gateway/methods*.py`. Everything here is per agent (a Hermes
profile, passed as `?profile=` or `profile` in the body) unless it says otherwise. Each part was checked
against a throwaway Hermes; what couldn't be (a real app sign-in, a linked phone, a live model) is said.

---

## 1. Apps (MCP servers from Hermes's catalog)

**Where:** the Apps tile on the agent page (`src/features/apps/`, state in `src/state/apps.ts`). Connected
apps first, each with an on/off switch and a quiet status; below, an icon wall with search, everyday apps
first and "For developers" after. Umbrel opens Settings → Umbrel instead. The same sheet holds the agent's
email (§7) and the apps that connect through Nous Research (§8): `apps-sheet.tsx` is a router, with a file per
kind of app (`home.tsx` the list and wall, `direct.tsx` these, `email.tsx`, `hosted.tsx`).

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
- Every app shows its real icon. Full-colour ones are bundled SVGs (`features/apps/icons/`, from the maker's own logo). The rest are
  Simple Icons glyphs on the brand's colour (`features/apps/marks.ts`). `app-icon.test.ts` fails if any app Murmur names, or any app
  in Nous's catalog, would fall back to a coloured initial.

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

From Hermes 0.22.4 one setup runs at a time. A start while an earlier one still holds on (put away while its
bridge was downloading, or open in another tab) gets `409` "Another WhatsApp QR setup is still active…", so
Murmur keeps showing "Getting a code" and asks again every 1.5 s, for as long as Hermes keeps a setup (10
minutes).

**Caveats**
- Hermes links WhatsApp the way WhatsApp Web does, through an **unofficial bridge** (Baileys, in
  `scripts/whatsapp-bridge/`). WhatsApp doesn't officially support this, so the sheet says a spare number is
  the safest bet. The first start installs the bridge, so it can take a minute.
- Hermes 0.22 calls WhatsApp "not configured" for every agent but the main one. Murmur treats a saved
  `whatsapp_setup.mode` as set up and reads the agent's own messaging status for how it's doing.
- Disconnect can't unlink the device (no API): it stays under Linked devices on the phone, and the confirm
  says so. Removing it there and then setting up again is untested: Hermes keeps the old link and reports it
  as linked. From 0.22.4, `reset_session: true` on start puts the old link aside and pairs afresh (WhatsApp
  must be off first); Murmur doesn't use it yet.
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

## 7. Email (`murmur-mail`)

**Where:** Email leads the Apps wall; once connected it's a row (provider mark, address, switch) with a Manage
page (`src/features/apps/email.tsx`, state in `src/state/mail.ts` and, for chats, `src/state/mail-chat.ts`).
`test/contract/mail.contract.ts` checks all of this against a fake mail server (GreenMail).

Email isn't Hermes's own: it's the `murmur-mail` plugin that Umbrel's image bundles
([getumbrel/hermes-agent-umbrel](https://github.com/getumbrel/hermes-agent-umbrel), `umbrel-context/plugins/murmur-mail`).
One account per agent, from Gmail, iCloud Mail, Fastmail, Yahoo Mail or anywhere else, signed in with an app
password over IMAP and SMTP. Mail goes straight between the provider and Hermes. The agent can search, read and
draft; every send waits for the person to approve that exact message. A Hermes without the plugin answers `404`
to its status route, and Murmur shows no Email tile.

| Step | Hermes |
|---|---|
| Is there email, and whose | `GET /api/plugins/murmur-mail/status?profile=` → `{plugin, version, enabled, configured, account, missing, inherited}`. `account` is everything but the password; `404` means no plugin |
| On or off (the row's switch) | `GET /api/config?profile=&include_defaults=false` → `agent.disabled_toolsets`; `PUT /api/config {config:{agent:{disabled_toolsets}}}` adds or removes `email` |
| Sign in, before saving anything | `POST /api/plugins/murmur-mail/check?profile=` with the whole account (`address`, `password`, `imap_host`/`_port`/`_security`, `smtp_…`, `provider`, `save_sent`) → `{ok:true, account, newest}` (the three newest messages, the proof) or `{ok:false, error:{kind, where, detail}}` |
| Save | `PUT /api/env {key, value, profile}` for each `MURMUR_MAIL_*` key: `AGENT` first, `PASSWORD` last; an earlier account's extras are `DELETE /api/env {key, profile}` |
| Switch the plugin on for an agent made since Hermes started | RPC `plugins.manage {action:'toggle', key:'murmur-mail', enable:true, profile}` |
| Bring the tools to the agent's next chat | `PUT /api/config {config:{plugins:{entries:{'murmur-mail':{settings:{account}}}}}}` |
| A new password | `POST …/check {password}` (laid over the saved account), then `PUT /api/env` `MURMUR_MAIL_PASSWORD` |
| Remove | `DELETE /api/env` for every `MURMUR_MAIL_*` key, then `account: ''` in the plugin's settings |
| A new agent | `GET …/status` → `inherited: true` → delete the copied keys (`createAgent` calls `forgetInheritedMail`) |

**In a chat.** The tools are `email_search`, `email_read`, `email_draft` and `email_send` (toolset `email`).
Hermes loads plugin tools on demand, so the model reaches them through `tool_search` and `tool_call`, but
`tool.start` and `tool.complete` carry the real `email_*` name and arguments (Hermes unwraps a single call).
Search and read results arrive inside `<untrusted_tool_result source="email_…">`, the boundary Hermes puts around
web pages; `readMailResult` takes the JSON out. `tool-labels.ts` turns them into "Searched your email · unread,
last 2 days", "Reading ‘Re: Thursday’s offsite plan’", "Drafting a reply", "Sending an email to Priya Raman".

**Sending.** The plugin's `pre_tool_call` hook returns `{action:'approve', message, rule_key}` for every
`email_send`, so Hermes asks through its usual `approval` request:
`command: '<email_send> (plugin approval rule)'`, `pattern_keys: ['plugin_rule:murmur-mail-send:<32 hex>']`,
and a `description` that is the whole message (`Send an email from …`, then `To:`, `Cc:`, `Bcc:`, `Subject:`, a
blank line and every word). `approval-text.ts` reads it back (`readSendApproval`), and the card shows it with
**Send** (`once`) and **Don't send** (`deny`) only: `session` and `always` would write allowlist entries for one
message into config.yaml, and each message needs its own yes anyway. The plugin's `post_approval_response`
hook records a person's yes for that exact message (a digest of from, to, cc, bcc, subject, body and reply), and
`email_send` only sends a message it holds a yes for.

**Caveats**
- **Nothing goes out without a person's yes.** Where Hermes would let a call through unasked (approvals switched
  off, `/yolo`, a routine with nobody to answer, a smart-approvals yes), there's no person's yes to spend: the tool answers
  `kind: not_approved` and tells the agent to save a draft. A denied or invalid send never runs at all (no
  `tool.start`); the model only sees the refusal.
- **Switching off is the agent's `email` toolset, not the plugin's switch.** Hermes 0.22.5 refuses a plugin's
  `/api/plugins/<name>/…` routes for an agent that has it in `plugins.disabled`, so status would answer `404` and
  Murmur would read it as "no email on this Hermes".
- **Hermes keeps an agent's tool list until its config.yaml changes**, so `.env` writes alone don't add or remove
  tools; the account setting above is what refreshes it. Chats already open keep the tools they started with.
- **The account is read from the agent's own `.env`** through Hermes's profile secret scope
  (`agent.secret_scope.build_profile_secret_scope`), not `get_secret`: with several agents, Hermes's frozen launch
  environment keeps returning deleted keys for the main agent until a restart.
- **`profiles.create` copies the main agent's `.env`** (its mail password included) into every new agent.
  `MURMUR_MAIL_AGENT` names the owner, so the plugin ignores a copy and reports it as `inherited`, and Murmur
  deletes it.
- **Agents made while Hermes runs have no `plugins.enabled`.** Umbrel's image enables the plugin for every agent
  at start; `connectMail` switches it on for the rest.
- **Failures** come back as `kind`: `wrong_password`, `app_password` (the provider said it wants one),
  `unreachable`, `tls`, `incomplete` or `unknown`, with `where` (`imap`/`smtp`, shown as incoming/outgoing).
  Telling `app_password` from `wrong_password` relies on the provider's wording; iCloud, Fastmail and Yahoo
  usually just say "authentication failed", so their wrong-password copy says to use an app password.
- **A health check is a real sign-in**, so it runs at most every ten minutes, only while the sheet is open, and
  never retries: providers lock out bursts of failed sign-ins.
- **A copy in Sent:** Gmail and Yahoo file sent mail themselves; for the rest the plugin appends a copy (it makes
  a Sent folder if there's none). A reply marks the original `\Answered`. Drafts go to the `\Drafts` folder.
- **Not yet:** attachments (listed, never fetched or sent), HTML mail, moving or deleting mail, and a name for
  sent mail (`MURMUR_MAIL_NAME`; the sheet doesn't ask). Opening the account's mail on the web opens Gmail's
  Drafts or the provider's inbox, not the draft itself.
- **Untested against the real providers** (no real accounts in tests): the four providers' servers, app-password
  pages and steps come from their help pages.

## 8. Apps through Nous

**Where:** among the everyday apps on the Apps wall (Slack, Asana, Box, Shopify, Granola, Discord and the rest of
Nous's catalog that Hermes can't connect itself), connected rows with "· via Nous", and a card above the composer
when an agent asks to connect one mid-chat (`src/features/apps/hosted.tsx`, `src/features/chat/connect-card.tsx`;
state in `src/state/hosted-apps.ts`, `hosted-apps-consent.ts`, `hosted-apps-chat.ts`).
`test/contract/hosted-apps.contract.ts` checks what can be checked without making a Nous account.

These are Hermes's built-in hosted connectors: Nous Research runs each app's sign-in and calls the app for the
agent (Composio behind it), so the app's data passes through their servers. An app Hermes's own catalog has
(§1) keeps connecting directly, and shows once; Jira and Confluence count as Atlassian. Gmail, Calendar and
Drive will appear here by themselves when Nous carries them.

| Step | Hermes |
|---|---|
| Catalog | RPC `connectors.catalog {profile:'default'}` → `{connectors:[{slug, name, description, …}]}`. With no Nous identity it's Nous's public catalog; offline, `5034 CATALOG_UNAVAILABLE` |
| Connected accounts | `connectors.accounts {profile:'default'}` → `{accounts:[{connection_id, connector, status, label, …}]}` (empty, without asking Nous, when there's no identity) |
| Asked yet? | `profiles.list` → the main agent's `ui_meta['murmur-nous'] = {since}`; or `free_tier.status {profile:'default'}` → `has_guest` (an identity made before Murmur asked) |
| Agree (once per Hermes) | `profiles.configure {name:'default', ui_meta:{'murmur-nous':{since}}}`, which must answer `applied.ui_meta: true`; then every agent's `agent.disabled_toolsets` loses `connections` |
| Connect | `connectors.connect {profile:'default', owner:{type:'account'}, connectors:[slug]}` → `{op_id, seq, deadline_at, settled, targets:[{name, state, connect_url, connection_id}]}`. The link opens in the tab opened in the tap |
| Follow it | `connection.update` events (owner `account`, without the link), `connectors.operation.status {owner, op_id}` for the whole snapshot, `connectors.operation.wake` when the person comes back. States: `initiated` → `connected`, `failed`, `expired`; Hermes gives up after 300 s |
| Cancel | `connection.respond {owner, op_id, result:{settled_by:'continue'}}`, then `connectors.accounts.remove` of the half-made account |
| Sign in again | `connectors.connect {…, reconnect:true, connection_id}` |
| Disconnect | `connectors.accounts.remove {profile:'default', connection_id}` (`CONNECTION_NOT_FOUND` counts as done) |
| An agent asks in a chat | `connection.request` / `connection.update` with owner `{type:'session'}` → the card; `connectors.connect {owner:{type:'session', session_id}, connectors:[name]}` for a fresh link, `connection.respond` for Not now and Done; `session.resume` → `pending_connection` |
| In chat steps | `manage_connections` ("Connecting Slack", "Checking your apps"); a Nous app's own tools arrive as `tool_call` with `args.calls[].name = connectors__<slug>__<ACTION>` ("Using Slack", with its mark) |

**The first connect makes an account at Nous** (a guest identity for this Hermes, made without a sign-in), so
Murmur asks first: the path (the app → Nous Research → the agent), one sentence, "How Nous handles your data"
(`portal.nousresearch.com/privacy`), **Continue** and **Not now**. Not now calls nothing. The answer is kept on the
main agent, so every browser and device sees it, and it's asked once per Hermes.

**What makes one.** `connectors.connect`, `connectors.tools`, `connectors.accounts.rename`,
`connectors.accounts.remove`, `connectors.policy.set`, and every action of the agent's `manage_connections` tool
(its `status` included). Never `connectors.list`, `connectors.catalog`, `connectors.accounts`,
`connectors.operation.*`, `connection.respond` or `free_tier.status`. So until the person agrees, every agent has
the `connections` toolset switched off: the app does it (`src/state/toolsets.ts`, on load, for new agents and
imports), and so does Murmur's server for the built-in Hermes's agents when it comes up (`server/discovery.ts`),
so an agent reached over Telegram or a routine first can't make one either.

**Caveats**
- **Per Hermes, not per agent.** The identity lives in the main agent's `auth.json` (and `<root>/shared/nous_auth.json`),
  and agents Murmur makes share it (`share_auth`), so every call names `profile: 'default'`. A connected app
  serves every agent, and Disconnect removes it for all of them and at Nous. Hermes has no per-agent or
  per-app switch, so a Nous app's row has a chevron, not a toggle.
- **Agreeing turns `connections` back on for every agent**, because Hermes only lets an agent reach Nous's apps
  (through `tool_search` and `tool_call`) while `manage_connections` is among its tools. A Hermes that already has
  an identity counts as agreed for the toolset; the question still shows on the first connect from Murmur.
- **In a desktop-source chat Hermes holds the turn up to 300 s for an answer** to an agent's connect: the card
  above the composer answers it. A card for one of Hermes's own apps (`kind: 'mcp'`) points to the Apps sheet.
- **Unverified without a Nous account** (making one is off limits in tests): the real sign-in, what an account's
  `label` holds, and Nous's finished page, which may try to open `hermes-desktop://` because Hermes marks these
  requests as from a desktop app (Murmur closes the tab as soon as Hermes sees the account).
- **A sign-in left half-way** (the tab or Murmur closed) isn't cleaned up: Nous lets it expire, and it lists as
  "Sign in again".
- Murmur never loads Nous's `logo_url` at runtime; the icons ship with Murmur (`features/apps/icons/`, `features/apps/marks.ts`).
