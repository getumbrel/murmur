# Murmur ↔ Hermes: agents (profiles), canonical chats, group chats (hosted rooms), roster status

Target: **Hermes Agent v0.21.5 (tag v2026.9.24)**, dashboard at `http://localhost:18789`, reached by the browser only through the same-origin proxy (`/hermes/*` → dashboard, token injected).

Legend: **[LIVE]** = verified against the running instance on 2026-10-13 with the scripts in `docs/hermes/scripts/ar-*.mjs`. **[SRC]** = read from source at the tag (file:line relative to the repo root), not exercised live. **[UNVERIFIED]** = inferred; treat with care.

Live provider during verification: default profile `openai-codex` / `gpt-6.1-sol` (ChatGPT sign-in). All test profiles/rooms (`murmur-test-*`) were deleted afterwards (`ar-99-cleanup.mjs`); disbanded rooms stay as tombstones for 90 days (no purge API).

---

## 0. TL;DR for the Murmur implementation

| Need | Use | Notes |
|---|---|---|
| List agents | RPC `profiles.list` | Has `ui_meta`, `has_avatar`, `canonical_session`, `last_session`. REST `GET /api/profiles` lacks those. |
| Create agent | RPC `profiles.create` (+ `profiles.configure` for `ui_meta`, + `profiles.set_asset` for avatar) | One call writes SOUL.md, mirrors credentials, and inherits the launch model. |
| Edit SOUL / description / model / ui_meta | RPC `profiles.configure` (or REST `PUT /api/profiles/{n}/soul\|description\|model`) | `profiles.configure` also does per-key CAS on `ui_meta`. |
| Avatar | RPC `profiles.set_asset` / `profiles.get_asset` | PNG/JPEG/WebP, max 2,000,000 bytes, data URL in and out. |
| Rename / delete agent | REST `PATCH` / `DELETE /api/profiles/{name}` | No RPC equivalent. |
| 1:1 chat with an agent | Find or create the hidden session titled exactly **`Bot Chat`** in that profile (Desktop convention) | `session.list {profile,title:'Bot Chat',include_hidden:true}` → `session.resume`, or `session.create {profile,title:'Bot Chat',hidden:true,follow_profile_config:true}` + `session.title`. |
| Group chat | **Server-hosted rooms: `groups.*` RPC over `/api/ws`** | Works end to end [LIVE]. Rounds run server-side and survive a client disconnect. There are no push events: poll `groups.log`/`groups.state`. Live token streaming is possible by attaching to each member's hidden `Group: <room_id>` session. |
| Roster status | `session.active_list` (all profiles, one call), refreshed on each global `sessions.changed` | Status values: `starting`/`working`/`waiting` (approval or clarify pending)/`idle`. Rows carry no profile name, so map them via `session_key` (stored id). |
| Unread | Client-side (like Desktop), optionally persisted with REST `PATCH /api/sessions/{id} {unread, profile}` | Hermes never sets unread on its own. From 0.22.3 the PATCH also carries the chat's revision (§5). |

> **Important correction to the brief.** Hermes Desktop's Bot Mode does **not** use hosted rooms. Desktop group chats run entirely in the Desktop client. The client stores the room log in plugin storage and drives each bot with `prompt.submit`, one at a time (`apps/desktop/src/plugins/hermes-bots/group-*.ts`). **Nothing in `apps/` calls `groups.*`**. The only callers in the tree are tests. So:
> - Murmur rooms (`groups.*`) will **not** appear in Desktop, and Desktop rooms will not appear in Murmur. Desktop rooms are mirrored only as a bounded copy in the default profile's `ui_meta['hermes-bots-groups']`.
> - A browser cannot drive Desktop-style client-side rounds reliably, because a mobile tab sleeps. The server-hosted rooms are the right primitive for Murmur.
>
> Agents (profiles) **are** fully interoperable with Desktop if Murmur writes the same `ui_meta['hermes-bots']` and uses the `Bot Chat` convention (§1.6, §2).

---

## 1. Transport basics (as used by everything below)

- WebSocket: `GET /api/ws?token=<session token>` (the proxy injects it). The server's first frame is:
  `{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{"skin":{…},"change_events":true,"heartbeat":true,"replay_epoch":"…"}}}` [LIVE]
- Requests are `{"jsonrpc":"2.0","id":<str|int>,"method":"…","params":{…}}`. Responses are `{"id",result}` or `{"id",error:{code,message,data?}}`.
  - **Responses can arrive out of order.** `profiles.list`, `session.list`, `session.resume`, `session.active_list` and every `groups.*` call run on a worker pool, so always match on `id`. [SRC `tui_gateway/rpc_dispatch.py:44-90`]
- Events are `{"jsonrpc":"2.0","method":"event","params":{"type","session_id","payload","seq"?}}`.
  - `session_id` is the **runtime** id (8 hex chars), or `""` for global broadcasts.
- Server→client requests are `{"jsonrpc":"2.0","id":"srq-<hex>","method":"approval"|"clarify"|"sudo"|"secret"|…,"params":{…}}`. Answer them with `{"jsonrpc":"2.0","id":"srq-…","result":{…}}` (§4.3).
- Every `/api/ws` method is reachable; there is no allowlist [SRC `rpc_dispatch.py:17-23`]. `groups.*` work because the dashboard process starts the hosted-room worker at boot (`groups.capabilities` → `driver:true`) [LIVE].
- REST: header `X-Hermes-Session-Token: <token>`.
- Helpers: `scripts/ar-lib.mjs` provides `connect()`, `call()`, `waitFor()`, `rest()`, and a server-request hook.

---

## 2. Agents = profiles

### 2.1 Identity and naming

- **Profile id (slug):** `^[a-z0-9][a-z0-9_-]{0,63}$` (max 64). Input is lower-cased and trimmed. [SRC `hermes_constants.py:321`, `hermes_cli/profiles.py:246`]
- **Reserved names:** `hermes`, `default`, `test`, `tmp`, `root`, `sudo`. `default` already exists and cannot be created.
  - Live error for `test`: 400 `"Profile name 'test' is reserved — …"` [LIVE]
- **Invalid name:** 400 `"'bad name!' is not a valid profile name. Use lowercase letters, numbers, '-' or '_', …"` [LIVE]
- **Duplicate:** 400 `"A profile named 'x' already exists. …"` [LIVE]
- **Murmur slug rule:** use the same as Desktop `slugifyProfileName` (`apps/desktop/.../hermes-bots/labels.ts:82`):
  - fold accents;
  - turn non-ASCII characters into `u<hex>` tokens;
  - collapse everything else to `-`.
  - Keep the human name separately in `ui_meta['hermes-bots'].title`.
- **Human-facing name, by precedence** (Desktop `displayName`, `labels.ts:14-64`):
  1. `ui_meta['hermes-bots'].title`
  2. `display_name` (presentation-only; only settable for `default` via rename)
  3. **`"Hermes"` for `default`**
  4. Title-cased slug with `-`/`_` turned into spaces.
- **@handle:** the slug. For `default` it is `hermes` (Desktop `data.ts:1011-1017`).

### 2.2 Files in a profile dir (`/opt/data/profiles/<name>/`)

Created by `profiles.create` [LIVE, inspected in the container]:

```
.env (0600, stub or mirrored)   SOUL.md   config.yaml   profile.yaml   auth.json (mirrored, RPC path only)
assets/avatar.png|jpg|webp      memories/ sessions/ skills/ skins/ logs/ plans/ workspace/ cron/ home/ …
```

- **`config.yaml` of a fresh profile:** just the inherited launch model block, `model: {default, provider, base_url, api_mode}`, plus `_config_version`. [LIVE]
- **`profile.yaml`:** `description`, `description_auto`, `display_name`, `previous_names`, `role`, `ui_meta`, `_ui_meta_revisions`. [LIVE]
  ```yaml
  description: Terse tester
  description_auto: false
  ui_meta:
    murmur: {display_name: Alpha, color: '#7c3aed'}
  _ui_meta_revisions: {murmur: 1}
  ```
- **The default profile** is `name:"default"`, `path:"/opt/data"`, `is_default:true`. It cannot be deleted (REST 400 `"Cannot delete the default profile (~/.hermes)…"` [LIVE]). Present it as the user's first agent:
  - name **"Hermes"**
  - handle `@hermes`
  - Desktop shows a violet squircle `#8b5cf6` unless `ui_meta['hermes-bots'].custom` is set.
  - Renaming default (`PATCH /api/profiles/default {new_name}`) only sets `display_name`; the id stays `default`. **Murmur should not rename default.** Put the title in `ui_meta['hermes-bots'].title` instead.

### 2.3 Create: RPC `profiles.create` (recommended) vs REST `POST /api/profiles`

**RPC `profiles.create`** [LIVE]

```json
→ {"method":"profiles.create","params":{
     "name":"murmur-test-alpha",
     "description":"Test agent for Murmur",
     "soul":"# Alpha\n\nYou are Alpha, …",
     "clone_from": null,          // omit/null = fresh profile + bundled skills; "default" = config clone (Desktop's default choice)
     "model": "gpt-6.1-sol", "provider": "openai-codex",   // optional; both or neither. Omitted = inherit launch model
     "share_auth": true,          // optional (Desktop sends true); mirror_credentials defaults true
     "no_skills": false, "no_alias": false, "clone_all": false, "clone_channels": false }}
← {"ok":true,"name":"murmur-test-alpha","path":"/opt/data/profiles/murmur-test-alpha",
   "soul_written":true,"model_set":false,
   "mirrored":{"env":true,"auth":true,"model_inherited":false,"voice":true}}
```

- **Errors:** 4061 (name missing), 4062 (invalid, reserved or exists), 5062 (other). [SRC]
- **What it does, in order** [SRC `tui_gateway/methods_profiles.py:383`]:
  1. Create the dir, built in staging then renamed.
  2. Seed bundled skills (fresh profiles only).
  3. Create the CLI wrapper alias.
  4. Write `soul` to SOUL.md.
  5. Mirror the launch profile's `.env`, `auth.json` (single-use OAuth grants stripped) and voice config.
  6. Pin the model, or inherit the launch model.
- **Note:** `mirrored.model_inherited:false` was reported, yet `config.yaml` held the inherited model block. The model is seeded from the launch profile at create time anyway, so either path gets a working model [LIVE].

**REST `POST /api/profiles`** [LIVE]

```json
→ {"name":"murmur-test-gamma","description":"Second test agent",
   "clone_from":null,"clone_all":false,"clone_channels":false,"no_skills":false,
   "provider":null,"model":null,"mcp_servers":[],"keep_skills":[],"hub_skills":[]}
← {"ok":true,"name":"murmur-test-gamma","path":"/opt/data/profiles/murmur-test-gamma",
   "model_set":false,"model_error":"","mcp_written":0,"skills_disabled":0,"hub_installs":[]}
```

- It writes **no SOUL** (you get the stock Hermes `DEFAULT_SOUL_MD`) and **no `auth.json`** [LIVE].
- A turn still worked on a REST-created profile on this instance [LIVE `ar-04`]. Whether that holds for every provider is **[UNVERIFIED]**.

**Recommendation:** create through **RPC `profiles.create`**. It is one round-trip with SOUL included, it is the path Desktop uses, and it mirrors credentials (safer for per-profile `.env` keys). Use REST only for rename and delete, which have no RPC.

### 2.4 Read and edit

**`profiles.list`** [LIVE]

```json
→ {"method":"profiles.list","params":{"include_sessions":true}}
← {"profiles":[{
     "name":"murmur-test-alpha","path":"/opt/data/profiles/murmur-test-alpha","is_default":false,
     "model":"gpt-6.1-sol","provider":"openai-codex","description":"Terse tester","display_name":"",
     "skill_count":58,"previous_names":[],"role":null,
     "last_session":null,"worker_session":null,
     "canonical_session":{"id":"20261013_121853_efe487","resolved_id":"20261013_121853_efe487","root_title":"Bot Chat",
        "title":"Bot Chat","preview":"Hello there, nice meeting you!","started_at":1791893934.08,
        "last_active":1791893936.55,"message_count":2},
     "ui_meta_revisions":{"murmur":1},
     "ui_meta":{"murmur":{"display_name":"Alpha","color":"#7c3aed"}},
     "has_avatar":true}],
   "bot_mode_protocol":true}
```

- Session fields use epoch **seconds**.
- `ui_meta` appears only when non-empty. `ui_meta_revisions` is always present.
- `last_session` is the newest non-hidden session; `worker_session` is the newest tool/kanban run (shape `{id,source,title,last_active}`).
- There is **no live status** in this result (§5).
- Desktop polls it every 5 s.

**REST `GET /api/profiles`** returns `{profiles:[{name,path,is_default,model,provider,has_env,skill_count,gateway_running,description,description_auto,display_name,bot_title,distribution_*,has_alias,role}]}`.
- `bot_title` mirrors `ui_meta['hermes-bots'].title` [LIVE].
- It has no `ui_meta`, avatar or sessions.

**`profiles.describe {name}`** returns `{name, description, soul, model:{provider,default}, skills:[{name,enabled}], toolsets:[{name,label,description,tool_count,enabled}], toolsets_pinned, mcp_servers:[{name,enabled,transport}]}` [LIVE]. Use it for an agent editor screen.

**`profiles.configure`** [LIVE]. Every section is optional and independent.

```json
→ {"method":"profiles.configure","params":{
     "name":"murmur-test-alpha",
     "description":"Terse tester",
     "soul":"# Alpha\n…",
     "model":"gpt-6.1-sol","provider":"openai-codex","confirm_expensive_model":false,
     "ui_meta":{"hermes-bots":{…}, "murmur":null},           // per-key merge; null deletes the key
     "ui_meta_expected_revisions":{"hermes-bots":1},          // optional per-key CAS
     "disabled_skills":[], "enabled_toolsets":[], "enabled_mcp_servers":[] }}
← {"ok":true,"applied":{"ui_meta":true,"ui_meta_revisions":{"hermes-bots":2},"description":true}}
```

- **CAS conflict** [LIVE] returns `{"ok":false,"applied":{"ui_meta":false,"ui_meta_conflicts":{"hermes-bots":{"expected":0,"actual":1}},"ui_meta_revisions":{"hermes-bots":1}}}`. A conflict rejects the whole `ui_meta` write.
- `ui_meta` over 64 KB of JSON is refused (`ui_meta:false`) [SRC].
- An "expensive" model pick without `confirm_expensive_model:true` returns `confirm_required:true, confirm_message` and writes nothing [SRC].

**REST equivalents** [LIVE]

| Call | Body | Response |
|---|---|---|
| `GET /api/profiles/{n}/soul` | — | `{"content":"…","exists":true}` |
| `PUT /api/profiles/{n}/soul` | `{"content":"…"}` | `{"ok":true}` (atomic write) |
| `PUT /api/profiles/{n}/description` | `{"description":"…"}` | `{"ok":true,"description":"…","description_auto":false}` |
| `PUT /api/profiles/{n}/model` | `{"provider":"openai-codex","model":"gpt-6.1-sol"}` | `{"ok":true,"provider":…,"model":…}` |

- `PUT …/model`: a missing field returns 422 (pydantic). There is **no GET model route**; read `model`/`provider` from either list, or `profiles.describe.model`.
- `role` is backend-only (`"setup"` or null). Desktop's "role" is `ui_meta['hermes-bots'].title`, which REST exposes as `bot_title`.

### 2.5 Avatar

**`profiles.set_asset`** [LIVE]

```json
→ {"method":"profiles.set_asset","params":{"name":"murmur-test-alpha","asset":"avatar","data":"data:image/png;base64,iVBOR…"}}
← {"ok":true,"asset":"avatar","size":70}
→ {"method":"profiles.set_asset","params":{"name":"…","asset":"avatar","clear":true}}
← {"ok":true,"asset":"avatar","size":0,"removed":1}
```

**`profiles.get_asset`** [LIVE]

```json
→ {"method":"profiles.get_asset","params":{"name":"murmur-test-alpha","asset":"avatar"}}
← {"found":true,"mime":"image/png","size":70,"data":"data:image/png;base64,iVBOR…"}   |  {"found":false}
```

- **Accepted input:** a data URL or bare base64. The format is sniffed from magic bytes and must be PNG, JPEG or WebP.
- **Size limit:** max **2,000,000 bytes** decoded.
- **Asset names:** only `avatar` exists.
- **Storage:** `<profile>/assets/avatar.<ext>`.
- **Errors** [LIVE where marked]:

  | Code | Meaning |
  |---|---|
  | 4063 | name required |
  | 4064 | profile not found |
  | 4066 | unknown asset, e.g. `"unknown asset 'banner' (supported: avatar)"` [LIVE] |
  | 4067 | no data |
  | 4068 | bad base64 |
  | 4069 | too large |
  | 4070 | unsupported format, e.g. `"unsupported image format (PNG/JPEG/WebP only)"` for GIF [LIVE] |

- **Desktop's own pipeline:** accepts uploads up to 15 MB, center-crops them to a **256×256 PNG data URL**, then calls `set_asset` (`avatar-image.ts`). Murmur should do the same client-side.
- **Generated portrait:** Desktop calls RPC `image.generate {prompt, aspect_ratio:'square'}` and uploads the result [SRC].

**Blobatars (Desktop's default "shape" avatars).** No image is stored.
- `ui_meta['hermes-bots'].shape` holds a string:
  - `"blobatar"` (seed = bot name)
  - `"blobatar:<seed>"`
  - `"blobatar:<seed>:<kind>"`
  - `"blobatar::<kind>"`
- `kind` ∈ `round organic boxy capsule nub cloud droplet hexagon sun triangle`, mapped to the blobatar `traits.shape` values `.11 .35 .54 .65 .745 .825 .8875 .9325 .965 .99`.
- Seeds are `Math.random().toString(36).slice(2,10)`.
- Render with npm **`blobatar@2.0.0`**: `import {blobatar} from 'blobatar/blob'` then `blobatar(seed,{size,traits:{shape}})`. The library picks colors from the seed, so `color` is ignored for blobatars. [SRC `avatar.tsx:117-190`]
- Legacy shapes still exist: `circle squircle pill triangle hexagon cloud drop sigil-<n>`.
- Desktop also **back-fills** a 160×160 PNG raster of the blobatar into `set_asset`, so other surfaces get a picture. When it pulls an avatar back, it ignores a 160×160 PNG and keeps the live vector [SRC `profile-ops.ts:94-119`].
- **Murmur:** if `ui_meta['hermes-bots'].imageKind==='shape'`, render the blobatar from `shape`. Otherwise show `get_asset`.

### 2.6 Rename and delete (REST only) [LIVE]

```
PATCH  /api/profiles/murmur-test-gamma   {"new_name":"murmur-test-gamma-renamed"}
     ← {"ok":true,"name":"murmur-test-gamma-renamed","path":"/opt/data/profiles/murmur-test-gamma-renamed"}
DELETE /api/profiles/murmur-test-gamma-renamed
     ← {"ok":true,"path":"/opt/data/profiles/murmur-test-gamma-renamed"}
     (or {"ok":true,"path","identity_settled":false,"settlement_pending":true,"retry_command"} — still a success)
```

- **Rename:** stops that profile's gateway (polls up to 10 s), renames the dir, and appends the old id to `previous_names`.
  - Hosted rooms store `profile` in their roster, so **do not rename an agent that is in a live room**; recreate the room. The rename effect on rooms is **[UNVERIFIED]**.
- **Delete:** `rm -rf` of the profile dir (sessions included). It can take up to about 10 s.
- **For a slug-stable UI:** rename by changing `ui_meta['hermes-bots'].title`, not the slug. Desktop's Edit dialog does the same.

### 2.7 Interop with Hermes Desktop Bot Mode: what Desktop writes on "New Bot"

[SRC `create-dialog.tsx:118-563`, `data.ts`, `soul.ts`, `types.ts:59-89`]

1. **Compute `{slug, title}`** with `botProfileIdentity(name, title)`. If the typed name has non-ASCII characters and no title, the typed name becomes the title.
2. **Call `profiles.create`:**
   ```json
   {"name":slug,"description":[title,description].filter(Boolean).join(" — "),
    "clone_from": "default" | null,  "no_skills":false, "share_auth":true,
    "soul": composeSoul(...), "model"?:…, "provider"?:…}
   ```
   - `clone_from` defaults to `"default"`; `null` when the user picks "none".
   - `model`/`provider` are sent only if the user picked one; otherwise the model is inherited.
3. **Optional capabilities:** `profiles.configure {name, disabled_skills?, enabled_toolsets?, enabled_mcp_servers?}`.
4. **Appearance:** `profiles.configure {name, ui_meta:{"hermes-bots": BotMeta}}` (no CAS), then `profiles.set_asset` if a photo was chosen.
   ```ts
   BotMeta = { shape: string /* 'blobatar' | 'blobatar:<seed>[:<kind>]' | legacy */, color?: '#rrggbb',
               imageKind?: 'photo'|'shape', title?: string /* the human name/role shown in UI */,
               description?: string, custom?: boolean /* set by Edit dialog */, created?: number /* ms */,
               hidden?: boolean, pinned?: boolean, groups?: string[], sectionId?: string, sectionName?: string,
               screenAutoOpen?: boolean }
   ```
   - The image itself is never put in `ui_meta`.
5. **Open the canonical chat** with kickoff (§3).

**SOUL template** (`soul.ts:160-184`). When the user typed a custom soul, Desktop uses it as-is (backend ≥ this version injects the messaging protocol). Otherwise:

```
# <DisplayName>

**Role:** <title>            ← only if title
**Mission:** <description>  ← only if description

You are <DisplayName>, a persistent named agent (profile `<slug>`) on this machine.
You keep your own memory, skills, and conversation history across sessions.
```

- `profiles.list` returns `bot_mode_protocol:true` on this backend. That means the server injects the inter-agent "Messaging other agents" protocol itself, only into sessions titled **`Bot Chat`**, and only when some profile has `ui_meta['hermes-bots']`. **Do not append it to SOUL.md yourself.**

**Murmur interop rule:** on create, write `ui_meta['hermes-bots'] = {shape:'blobatar:<seed>', imageKind:'shape'|'photo', title:<name>, description?, created:Date.now()}`. Keep Murmur-only settings under a separate key such as `ui_meta.murmur` (verified that independent keys coexist with separate revisions [LIVE]). Always re-read `ui_meta_revisions` and send `ui_meta_expected_revisions` when editing, because Desktop may write concurrently.

**A new profile needs nothing else to be chat-able** [LIVE]. `session.create {profile:"<name>"}` on the single dashboard `/api/ws` works immediately, in the same process, with no per-profile gateway and no restart. `info.profile_name` confirms the binding. The `gateway_running:false` on REST rows refers to that profile's *messaging* gateway and does not matter for chat.

---

## 3. Canonical 1:1 chat per agent ("Bot Chat")

**Convention** [SRC `canonical-chat.ts`, `apps/desktop/src/AGENTS.md:65-99`]:
- There is exactly one session per profile **titled exactly `Bot Chat`**, created **hidden**.
- No id is stored anywhere. `profiles.list` exposes it as `canonical_session` [LIVE].
- Hidden sessions stay out of the normal session sidebar.

**Flow** (all [LIVE], `ar-02-canonical-chat.mjs`):

```json
// 1. lookup (exact title; follows compression lineage → resolved_id)
→ {"method":"session.list","params":{"profile":"murmur-test-alpha","title":"Bot Chat","limit":200,"include_hidden":true}}
← {"sessions":[]}                         // or [{"id","resolved_id","title":"Bot Chat","preview","started_at","message_count","source":"tui"}]

// 2a. exists → open it
→ {"method":"session.resume","params":{"session_id":"<resolved_id||id>","profile":"murmur-test-alpha"}}

// 2b. missing → create (lazy: no DB row until first prompt) …
→ {"method":"session.create","params":{"profile":"murmur-test-alpha","title":"Bot Chat","hidden":true,"follow_profile_config":true}}
← {"session_id":"cfb4e4a7","stored_session_id":"20261013_121853_efe487","message_count":0,"messages":[],
   "info":{"model":"gpt-6.1-sol","cwd":"/opt/data","lazy":true,"desktop_contract":8,"profile_name":"murmur-test-alpha",…}}
// … and materialise the title now (on "already in use" → re-run the lookup and adopt the winner)
→ {"method":"session.title","params":{"session_id":"cfb4e4a7","title":"Bot Chat"}}
← {"pending":false,"title":"Bot Chat"}

// 3. optional kickoff (Desktop sends i18n 'bot.kickoff' = "Hey, tell me about yourself!" after 400 ms)
→ {"method":"prompt.submit","params":{"session_id":"cfb4e4a7","text":"…"}}
← {"status":"streaming","user_row_id":1}
```

- **Fail closed** like Desktop does. If the lookup errors, or comes back empty while `profiles.list` shows a `canonical_session`, do **not** mint a second Bot Chat.
- **Stream events for a 1:1 turn** [LIVE], in order: `session.info` → `message.start` → `thinking.delta`×n → `reasoning.delta`×n → `message.delta {text}`×n → `reasoning.available {text}` → `message.complete {text, usage, status:"complete", persisted_turn:{row_ids,user_row_id,final_assistant_row_id}, reasoning}` → `session.info`.
  - Other frames you may see: `tool.start {tool_id,name,context,args}`, `tool.complete {…,duration_s,result}`, `session.usage`, `status.update {kind,text}` and `session.title {session_id:<stored>,title}` (auto-title).
- **Other sessions per profile:**
  - RPC `session.list {profile, limit, include_hidden?}` returns `{sessions:[{id,title,preview,started_at,message_count,source}]}`. Hidden rows (Bot Chat, room plumbing) are omitted unless `include_hidden:true` [LIVE].
  - REST `GET /api/sessions?profile=<n>` and `GET /api/profiles/sessions?profile=<n>|all` return `{sessions,total,…}`. They exclude hidden rows from `sessions`, but `total` counted them (11 vs 0 rows) [LIVE].
- **Deleting a session:** `session.delete {session_id:<stored>, profile}` fails with **4023 "cannot delete an active session"** while it is live. Call `session.close {session_id:<runtime>}` (returns `{closed:true}`) first, then delete (returns `{deleted:"<stored>"}`) [LIVE].
- **Gotcha seen live:** auxiliary auto-title generation fails on `gpt-6.1-sol`. It emits `status.update {kind:"warn", text:"⚠ Auxiliary title generation failed: Unsupported value: 'none' …"}`, and the session falls back to a truncated first-message title. That is harmless; ignore `warn` status updates in the UI or show them subtly.

---

## 4. Group chats = server-hosted rooms (`groups.*`)

### 4.1 Capabilities [LIVE]

`groups.capabilities {}` returns:

```json
{"protocol_version":2,"driver":true,"persistent_process":true,"authority_gateway_id":"install:7d96…",
 "features":["authority_epoch","coordinator_fencing","room_identity","monotonic_log","idempotent_send",
             "replayable_disband","typed_events","actor_identity","log_replication","authority_takeover"],
 "methods":["groups.capabilities","groups.list","groups.create","groups.state","groups.send","groups.rename",
            "groups.log","groups.disband","groups.replicate","groups.replica_state","groups.promote","groups.demote",
            "groups.stop","groups.retry","groups.approve","groups.peer.invite","groups.peer.revoke","groups.peer.register"],
 "max_log_limit":500, "room_link":{…}}
```

- Gate the group-chat feature on `driver:true`. Without it, `create`/`send` fail with 4123 and `stop`/`approve` with 4115.

### 4.2 Lifecycle (all [LIVE], `ar-05`, `ar-06`, `ar-08`, `ar-10`)

**Create.**
- Rules:
  - 2–6 members.
  - Each member's `profile` must be a local profile and unique.
  - `member_id` and `handle` must be unique. Ids match `^[A-Za-z0-9][A-Za-z0-9._:-]*$`, max 128 chars.
  - Handles `all`/`everyone` are reserved.
  - Name max 200.
- **`room_id` is client-chosen** and never reusable, even after disband.

```json
→ {"method":"groups.create","params":{"room_id":"murmur-test-room-mv6nkpcm","name":"Murmur test room","members":[
     {"member_id":"murmur-test-alpha","profile":"murmur-test-alpha","handle":"alpha","display_name":"Alpha"},
     {"member_id":"murmur-test-beta","profile":"murmur-test-beta","handle":"beta","display_name":"Beta"}]}}
← {"room":{"room_id":"murmur-test-room-mv6nkpcm","name":"Murmur test room",
     "members":[{"member_id":"murmur-test-alpha","profile":"murmur-test-alpha","handle":"alpha",
                 "target":{"kind":"local","profile":"murmur-test-alpha"},"display_name":"Alpha"}, …],
     "authority_gateway_id":"install:7d96…","authority_epoch":1,"revision":1,
     "created_at":1791894256.73,"updated_at":1791894256.73,"idempotent":false}}
```

- Repeating the identical create returns `idempotent:true`. A different roster under the same id returns **4110 `"room_id already exists with different state"`**.
- Validation errors are **5111**:

  | Case | Message |
  |---|---|
  | 1 or 7 members | `"members must contain between 2 and 6 entries"` |
  | same profile twice | `"member profiles must be unique"` |
  | reserved handle | `"member handles must be unique and cannot reserve @all or @everyone"` |
  | unknown profile | `"member 1 profile 'x' is not local to this gateway"` |

- **Recommended Murmur mapping:** `member_id = profile = slug`, `handle = slug` (`default` → handle `hermes`), `display_name = ui_meta['hermes-bots'].title`.

**Post a user message.**

```json
→ {"method":"groups.send","params":{"room_id":"…","event_id":"u-1791894256803",
     "payload":{"text":"Hi both! … @beta also tell @alpha a fun fact.","thread_id":"main"}}}
← {"event":{"room_id":"…","seq":1,"event_id":"user:a29c…","kind":"message.user","actor":{"kind":"user","id":"desktop"},
     "authority_epoch":1,"payload":{"text":"…","thread_id":"main"},"created_at":1791894256.81,"idempotent":false},
   "client_event_id":"u-1791894256803","accepted":true,"driver_started":true}
```

- `payload` must be exactly `{text, thread_id}`; text ≤ 64 KiB. There are no attachments in this version (`room_link.catalog.attachments:false`).
- `event_id` is your idempotency key. Re-sending the same one returns `idempotent:true` [LIVE], so it is safe to retry on reconnect.
- The stored id is `user:<sha256(event_id)>`.
- Use one `thread_id` per room (e.g. `"main"`) unless you build threads.

**Turn-taking (server policy, `gateway/hosted_room_discussion.py:617-662`)** [SRC; behavior observed LIVE]:
- **Round 0 responders:** the `@handle`s mentioned in the user text, matched case-insensitively. If there is no mention, or `@all`/`@everyone` is used, **every member** responds.
  - Live: `"@alpha what is 2+2?"` → only alpha replied, then the room settled.
- **Rounds 1–2:** only members another bot `@`-mentioned and who have not spoken since.
  - Live: beta mentioned @alpha → alpha took round 1 → beta passed → settled.
- **Order:** roster order rotated by round index. Turns are **serial** within a room. Up to 4 rooms run concurrently.
- **Passing:** a member can reply `(pass)` (or empty) to stay silent. That logs a `turn.settled {passed:true}` and no message.
- **Ending a discussion:**
  - a round with no posts → `room.activity {status:"settled", reason_code:"silent_round"}`;
  - more than 3 rounds → `{status:"bounded", reason_code:"max_rounds"}`;
  - more than 10 member messages → `{status:"bounded", reason_code:"max_messages"}`.
- **Superseding:** a newer user message in the same thread cancels pending turns of the older one (`turn.cancelled {reason:"superseded_by_newer_user_event"}`) [SRC].
- **Execution:** each member turn runs in that member profile's own **hidden session titled `Group: <room_id>`** (`source:"bot_room"`), using that profile's SOUL, model, memory and tools [LIVE: visible via `session.list {profile, include_hidden:true}`].
  - Turn deadline: `HERMES_AGENT_TIMEOUT` (default 1800 s) + 30 s, after which you get `turn.failed {reason_code:"turn_deadline_exceeded"}`.
- **Member prompt** built by the server (`_build_prompt`, `hosted_room_discussion.py:519`), for reference:
  ```
  [Discussion: "<room name>"] You are @<handle>, one participant with @a, @b and the user.

  New messages in this thread since your last turn (oldest first):
    User (user): <text>
    @<handle>: <text>
  Rules for this Discussion:
  - Reply with one conversational message only when you have something new worth adding.
  - If you have nothing new to add, reply with exactly "(pass)".
  - Mention a teammate by handle to pull them into the next round; do not repeat points already made.
  - Never reveal content from private conversations. Your reply is published verbatim.
  ```
- **Rounds keep running with no client connected** [LIVE `ar-10`]. The client sent a message, disconnected for 30 s, reconnected, and caught up with `groups.log since_seq`. That is ideal for mobile.

**Room log = history and progress (the only durable "event stream").** `groups.log` is paged by `since_seq`, with a maximum `limit` of 500.

```json
→ {"method":"groups.log","params":{"room_id":"…","since_seq":0,"limit":100}}
← {"events":[RoomEvent…],"cursor":5,"latest_seq":9,"has_more":true,"authority":{"gateway_id":"install:…","epoch":1}}
```

- Pass `cursor` back as the next `since_seq`.

Observed event sequence for the first live round:

```
seq 1 message.user     actor {kind:user,id:desktop}            payload {text, thread_id}
seq 2 message.member   actor {kind:member,id:murmur-test-alpha,profile:murmur-test-alpha,display_name:Alpha}
                       payload {text:"Hi everyone—great to be here with you and @beta!", member_id, member_index:0,
                                round_index:0, task_id:"dtask:…", turn_id:"d1.r0.p0.s1.m…", thread_id, discussion_event_id}
seq 3 turn.settled     actor {kind:gateway,id:install:…}  payload {member_id, message_event_id:"dmessage:…", passed:false, round_index:0, seen_through_seq:1, …}
seq 4 message.member   (beta, round 0)   "Hi everyone—@alpha, fun fact: octopuses have three hearts!"
seq 5 turn.settled
seq 6 message.member   (alpha, round 1)  "Thanks, @beta—three hearts …"
seq 7 turn.settled
seq 8 turn.settled     (beta, round 1) passed:true, message_event_id:null
seq 9 room.activity    payload {status:"settled", reason_code:"silent_round", thread_id, discussion_event_id}
```

- **Speaker:** `actor.id` / `payload.member_id` (= `member_id`) and `actor.profile`.
- **Durable kinds:**

  | Kind | Payload / actor |
  |---|---|
  | `message.user` | |
  | `message.member` | |
  | `turn.settled` | `{passed, message_event_id}` |
  | `turn.failed` | `{error, reason_code?}` |
  | `turn.cancelled` | `{reason}` |
  | `turn.deferred` | |
  | `room.activity` | `{status:"settled"\|"bounded", reason_code}` |
  | `room.stop_requested` | `{cancel_id}` |
  | `room.renamed` | `{name}`, actor `{kind:system,id:room-control}` |
  | `room.disbanded` | |

- `turn.started` is declared but never emitted, so "who is typing" has to come from `driver_status` or live session attachment (below).
- `created_at` is epoch **seconds**.

**State (working, blocked, approvals).**

```json
→ {"method":"groups.state","params":{"room_id":"…"}}
← {"room":{…,"latest_seq":0},"driver_status":{"running":true,"working":true,"blocked":false,
     "counts":{"settled":1,"running":1},"pending_actions":[],"peer_routes":[]}}
```

- `working:true` while any turn is queued or running. It went back to `false` exactly when `room.activity` landed [LIVE].
- `counts` keys seen: `running`, `queued`, `settled`, `cancelled`.
- **There are no push events for rooms.** During a round both the caller and an unrelated watcher connection received **only** `sessions.changed {}` [LIVE].
- **Polling recipe:** while `driver_status.working`, poll `groups.log since_seq=<cursor>` + `groups.state` every 1–1.5 s. When idle, poll on `sessions.changed`, or every 5–10 s for rooms on screen.

**Live typing/streaming for a room member (optional, [LIVE `ar-07`]).** Once a member's `Group: <room_id>` session exists (after its first turn in that room), it is a normal live session:

```json
→ {"method":"session.list","params":{"profile":"murmur-test-alpha","title":"Group: <room_id>","include_hidden":true}}
→ {"method":"session.resume","params":{"session_id":"<stored id>","profile":"murmur-test-alpha","omit_messages":true}}
```

- After that, the connection receives that member's `message.start`, `message.delta`, `tool.start`/`tool.complete` and `message.complete` frames for later room turns. They are keyed by the runtime `session_id` returned by resume.
- Map runtime sid → member for "Alpha is typing…" and streaming bubbles. Still treat `groups.log` as the source of truth.
- **Never `prompt.submit` into a `Group:` session.** The server is supposed to fence this (4120/4122), but in one live run (`ar-06`) a direct `prompt.submit` into a resumed `Group:` session was **accepted** (`status:"streaming"`). That would inject text into the agent's room context.
- **[UNVERIFIED]** Whether attaching mid-first-turn reliably catches that first turn. It worked once in `ar-06` and missed in one `ar-07` attempt.

**Stop a round.**

```json
→ {"method":"groups.stop","params":{"room_id":"…"}}        // cancel_id optional (default "desktop-stop")
← {"cancelled":1}
```

- Log entries: `room.stop_requested {cancel_id}`, then `turn.cancelled {reason:"member turn cancelled"}`. `driver_status.working` becomes `false` [LIVE].

**Approvals inside rooms** [LIVE `ar-08`, with the member profile set to `approvals.mode: manual`].
- The pending approval shows up only in `groups.state`:
  ```json
  "pending_actions":[{"kind":"approval","task_id":"dtask:…","execution_generation":1,"run_id":null,"session_id":"bdbe6342",
     "request_id":"6af6…","member_id":"murmur-test-alpha",
     "approval":{"command":"rm -rf /tmp/…","description":"delete in root path","pattern_keys":["delete in root path"],
                 "choices":["once","deny"],"allow_permanent":true,"allow_session":true,"request_id":"6af6…"}}]
  ```
- Answer it with:
  ```json
  → {"method":"groups.approve","params":{"room_id":"…","member_id":"murmur-test-alpha","task_id":"dtask:…",
       "execution_generation":1,"choice":"deny","request_id":"6af6…"}}
  ← {"approved":true,"result":{"resolved":1}}
  ```
  - Choices in rooms are only `once`/`deny`.
- With the default `smart` approval mode, the same command was auto-approved and no action appeared.
- `blocked:true` and `pending_actions:[{kind:"retry",task_id}]` (answered with `groups.retry {room_id,task_id}`) cover failed or indeterminate turns [SRC, not triggered live].

**List, rename, disband.**

```json
→ {"method":"groups.list","params":{}}          // {include_disbanded?, limit≤500, offset?}; most recently updated first
← {"rooms":[{room_id,name,members,authority_gateway_id,authority_epoch,revision,created_at,updated_at,idempotent,latest_seq}],"next_offset":null}
→ {"method":"groups.rename","params":{"room_id":"…","event_id":"rn-1791894276764","name":"Renamed room"}}
← {"room":{…,"name":"Renamed room","revision":2,"latest_seq":10,"event":{"kind":"room.renamed","actor":{"id":"room-control","kind":"system"},"payload":{"name":"Renamed room"},…}}}
→ {"method":"groups.disband","params":{"room_id":"…"}}
← {"tombstone":{"room_id":"…","disbanded_at":1791894277.03,"idempotent":false,"event":{"seq":13,"event_id":"system:room-disbanded","kind":"room.disbanded",…}}}
```

- After disband, `groups.log`/`groups.state` return **4112 "hosted room not found"** unless you pass `include_disbanded:true`.
- Tombstones are kept for 90 days, and the `room_id` can never be reused.
- The member `Group: <room_id>` sessions are **not** deleted. They are hidden; delete them yourself if wanted.
- Rooms are **host-global**, stored in `/opt/data/shared-state.db`, not per profile. Their message limits are §4.4.

**Adding or removing members: not supported.** The roster is frozen at create time. There is no `groups.*` method for it; re-creating with a different roster returns 4110 [LIVE].
- **Murmur workaround:** "edit members" = create a new room (new `room_id`) with the new roster and disband the old one.
  - You may seed context by sending the new room a first user message that summarises the old one.
  - Present the two rooms as one conversation client-side, e.g. keep `ui_meta.murmur.rooms` on `default` linking old→new room ids. This chaining is a Murmur design choice, not a Hermes feature.

### 4.3 Approvals and clarify in 1:1 chats (needed for the roster's "waiting" state) [LIVE `ar-08`]

1. Once per connection: `client.capabilities {"server_requests":true}`. It returns `{"server_requests":["approval","clarify","display.install.sudo","preview.act","preview.read","secret","sudo","terminal.read","tour","vault.code","vault.save_login","vault.unlock_prompt","window.read"]}`.
   - If **no** attached connection has advertised this, approvals are withdrawn immediately and the agent reports that approval was unavailable [LIVE].
2. The server sends:
   ```json
   {"jsonrpc":"2.0","id":"srq-737429dd2102","method":"approval","params":{"session_id":"05abff72",
     "command":"rm -rf /tmp/murmur-approval-probe-dir-3","pattern_key":"delete in root path","pattern_keys":["delete in root path"],
     "description":"delete in root path","allow_permanent":true,"allow_session":true,
     "request_id":"444a3ef272684719a19840dfea649390","choices":["once","session","always","deny"]}}
   ```
3. Reply `{"jsonrpc":"2.0","id":"srq-737429dd2102","result":{"choice":"deny"}}`, or use RPC `approval.respond {session_id, choice, request_id}`.
   - A withdrawal arrives as event `request.cancel {id, method, reason}`.
   - Server requests reach only connections attached to that session.

### 4.4 Limits [SRC]

| Limit | Value |
|---|---|
| Members per room | 2–6 |
| Message size | 64 KiB |
| `groups.log` page size | ≤ 500 events / 2 MiB |
| Events per room | 50k |
| Active rooms per host | 256 |
| Discussion | 3 rounds / 10 member messages per user message |
| Concurrency | 4 rooms run concurrently; serial within a room |

---

## 5. Roster status from one connection

**`session.active_list {}`** returns every live (in-process) session across **all profiles**. The `profile` param is ignored: the same result came back with and without it [LIVE].

```json
← {"sessions":[{"current":false,"id":"cfb4e4a7","session_key":"20261013_121853_efe487","title":"Bot Chat",
     "status":"idle","model":"gpt-6.1-sol","preview":"Hello there, nice meeting you!",
     "message_count":2,"started_at":1791893933.97,"last_active":1791893950.86}]}
```

- **Status values seen live, polling every 0.7 s:**
  - 1:1 turn: `starting` → `working` → `idle`;
  - with a pending approval: `working` → **`waiting`** → (after deny) `working` → `idle`.
  - Enum also lists `streaming` and `resuming`; no emitter was found [SRC].
- **No profile field.** Join on `session_key` (stored id) against each agent's `canonical_session.id`/`resolved_id` from `profiles.list`, or against ids you created or resumed.
  - Stored ids are timestamp-random and effectively unique; the server notes they *can* collide across profiles.
- **Sessions outlive their connection.** A session created by a closed connection stays listed until it is reaped. Those reaps arrive as the global event `session.reclaimed {session_id, stored_session_id, reason:"ws_orphan_reap"}` [LIVE].
- **Room turns:** hosted room member sessions (`Group: …`) also show up here while they run. Prefer `groups.state.driver_status` for room status.

**Events.**
- Per-session frames (`message.*`, `tool.*`, server requests) go **only** to connections attached to that session (created, resumed, activated or prompted from it).
- An unrelated observer connection received **only** `sessions.changed {}` (`session_id:""`, no `seq`) during other sessions' turns, about every 2–3 s while state changed [LIVE].
- Other global broadcasts: `cron.changed`, `platforms.changed`, `pairing.changed`, `pet.changed`, `skin.changed`, `session.reclaimed`, `bot_relay.outbox.pending`.
- `sessions.changed` only watches the `state.db` files of the launch profile plus profiles this process has already been asked about via `profile` [SRC `change_watcher.py:132-144`]. Calling `profiles.list`/`session.list {profile}` for every agent at startup covers that **[UNVERIFIED that list alone registers the home]**. Keep a slow backstop poll.

**Recommended Murmur roster algorithm** (mirrors Desktop `use-background-sync.ts:974-1035`, `row-helpers.ts`, `roster-actions.ts`):

1. Poll `profiles.list` on start, then every ~5 s while visible (or on `sessions.changed`).
2. Call `session.active_list` on every `sessions.changed` (debounced ~250 ms), plus every 30 s as a backstop.
3. Per agent:
   - **waiting** = the agent's Bot Chat `session_key` appears with `status:"waiting"`, or a server-request `approval`/`clarify` is open on your connection;
   - **working** = `starting` or `working`, or the agent is a member of a room whose `driver_status.working` is true and it is the current speaker;
   - otherwise **idle**.
   - Desktop also shows "work" when `worker_session.last_active` is less than 150 s old (cron/kanban runs live in other processes and are invisible to `active_list`).
4. **Unread.** Hermes does not set it automatically, so do it client-side. Keep `lastSeen[agent] = canonical_session.last_active` (or `message_count`) when the user views the chat. The agent is unread if a newer `last_active` or `message_count` arrives while that chat isn't focused (Desktop: `rosterWatermarks` plus `markSessionUnreadFinished`).
   - To sync across devices, persist with REST `PATCH /api/sessions/{stored_id} {"unread":true|false,"profile":"<name>"}`, which returns `{"ok":true,"title":"Bot Chat","unread":true}` [LIVE].
   - From Hermes 0.22.3 the PATCH must also carry `request_id` (any id of the client's own, so a retry can't apply twice) and `expected_revision`, the `runtime_revision` from `GET /api/sessions/{stored_id}/mutation-snapshot?profile=<name>`. A PATCH without them gets 409 `client_upgrade_required`, and one with a stale revision gets 409 `revision_conflict`. Older Hermes has no mutation snapshot (404) and takes the PATCH bare.
   - The flag lives in `sessions.last_read_at`. REST listings hide hidden sessions, so read your own flag back via `GET /api/sessions/{id}`, or keep it in `ui_meta.murmur` [UNVERIFIED single-session GET shape].
   - For rooms: unread = `latest_seq > lastSeenSeq[room]` (from `groups.list`).

---

## 6. Scripts (Node 22, no deps; run from `docs/hermes/scripts/`)

| Script | What it verifies |
|---|---|
| `ar-lib.mjs` | WS/REST helpers (token scrape, JSON-RPC, event wait, server-request hook) |
| `ar-01-profile-create.mjs [name]` | `profiles.create` / `configure` (ui_meta) / `set_asset` / `get_asset` / `describe` / `list`, REST row + soul |
| `ar-02-canonical-chat.mjs [profile]` | Bot Chat lookup / create / title / prompt, full event stream, observer sees only `sessions.changed`, `active_list` statuses, `canonical_session` |
| `ar-03-rest-profile.mjs [name] [--keep]` | REST create / soul / description / model, name validation, rename, delete, default undeletable |
| `ar-04-quick-turn.mjs <profile> [text]` | Profile is chat-able on the shared `/api/ws` |
| `ar-05-hosted-room.mjs [A] [B] [--keep]` | Full `groups.*` lifecycle with log / state polling and push-event census |
| `ar-06-room-routing-stop.mjs` | @mention routing, roster change → 4110, attach to `Group:` session, mid-round stop |
| `ar-07-room-live-stream.mjs` | Live `message.delta` streaming of room members via attached `Group:` sessions |
| `ar-08-approval-status.mjs` | 1:1 approval server request + `waiting` status; room approval via `pending_actions` + `groups.approve` (needs member profile `approvals.mode: manual`) |
| `ar-09-interop-sessions.mjs` | `ui_meta['hermes-bots']` → REST `bot_title`, CAS, key delete, asset errors / clear, session lists, unread PATCH, close→delete |
| `ar-10-room-offline.mjs` | Room validation errors, idempotent send, round completes while disconnected, post-disband 4112 |
| `ar-99-cleanup.mjs` | Disband `murmur-test-*` rooms, delete `murmur-test-*` profiles |

Scripts that create profiles expect `murmur-test-alpha`/`-beta` to exist; create them with `ar-01` (alpha) and `ar-01 murmur-test-beta`.

## 7. Open items / not verified

- Room retry flow (`blocked`, `pending_actions kind:"retry"`, `groups.retry`) was not triggered live.
- `turn.failed` / `turn.deferred` / `bounded` endings were not observed live (only `settled`).
- Effect of renaming or deleting a profile that is a member of a live room: **[UNVERIFIED]**. Avoid it, or recreate the room.
- The fence against `prompt.submit` into `Group:` sessions did not fire in one live run. Treat those sessions as read-only.
- Whether `sessions.changed` covers profiles never touched with `profile` in this process: **[UNVERIFIED]**.
- Desktop rooms (client-side, plugin storage + `ui_meta['hermes-bots-groups']` on default) are a separate system. Murmur cannot see or continue them, and vice versa.
