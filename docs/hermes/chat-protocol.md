# Hermes chat protocol (`/api/ws` JSON-RPC): integration spec for Murmur

Target: **Hermes Agent v0.21.5, tag `v2026.9.24`**. Tested against the Umbrel image
`ghcr.io/getumbrel/hermes-agent-umbrel:v2026.9.24` (container `hermes-agent_web_1`, dashboard on `:18789`).
The image's `tui_gateway/` matches the tagged source exactly. Its `hermes_cli/` differs from the tag in two
places only: an Umbrel auth patch in `web_server.py` and Docker update text in `config.py`.

Verification legend:
- **[live]**: observed on the running instance on 2026‑10‑13, with provider `openai-codex` and models
  `gpt-6.1-sol`, `gpt-6-luna`, `gpt-6-sol` and `gpt-5.6-sol`.
- **[source]**: read from the tagged source only and not exercised live.

Test scripts are in `docs/hermes/scripts/` (see [§10](#10-test-scripts)). Every JSON frame quoted below is a
real frame from those scripts. Some are trimmed with `…`.

---

## 0. Mental model

- `/api/ws` is a **JSON‑RPC 2.0 peer‑to‑peer** channel. Each WebSocket text message is one JSON object.
- Message kinds:
  1. **Client → server request**: `{"jsonrpc":"2.0","id":<string|number>,"method":"…","params":{…}}`. You get
     exactly one response, `{"jsonrpc":"2.0","id":…,"result":{…}}` or `{"jsonrpc":"2.0","id":…,"error":{"code":…,"message":…,"data"?:…}}`.
  2. **Server → client notifications (events)**: always `{"jsonrpc":"2.0","method":"event","params":{"type":"<event>","session_id":"<runtime sid or \"\">","payload":{…},"seq":<int>}}`.
     These have no `id` and need no reply.
  3. **Server → client requests**: approval, clarify, sudo, secret and others. They look like
     `{"jsonrpc":"2.0","id":"srq-<12hex>","method":"approval","params":{"session_id":…,…}}`. **You must reply**
     with `{"jsonrpc":"2.0","id":"srq-…","result":{…}}` or with an `error`.
- **Two session ids.** Do not confuse them:
  - `session_id` is the **runtime id**: 8 hex characters, e.g. `"057c7e14"`. It names a live, in‑memory session
    in this process. Every session‑scoped RPC and every event's `params.session_id` uses it.
  - `stored_session_id` (also called `session_key`) is the **database id**, e.g. `"20261013_121632_c3e926"`.
    `session.list`, `session.resume`, `session.delete`, REST `/api/sessions/*` and the `session.title`
    *event payload* use it.
  - A runtime id is ephemeral. The server reaps it about 20 s after the last socket leaves (see [§1.7](#17-disconnect-orphan-reaping)).
    To reopen the same chat, call `session.resume(stored_id)`, which returns a runtime id, possibly a new one.
- One gateway process serves **all profiles**. You pick the profile per session with the `profile` param.
  There is no per‑profile socket (see [§7](#7-multiple-concurrent-sessions-on-one-socket)).

---

## 1. Connecting

### 1.1 URL and auth  [live]

```
ws(s)://<dashboard-host>/api/ws?token=<SESSION_TOKEN>
```

- The token is the dashboard session token embedded in the SPA HTML as `window.__HERMES_SESSION_TOKEN__="…"`
  (`curl -s localhost:18789/ | grep -oE '__HERMES_SESSION_TOKEN__="[^"]+' | cut -d'"' -f2`). REST uses the same
  value in the `X-Hermes-Session-Token` header. **The WebSocket accepts the token only as the `?token=` query
  parameter.** The header alone is rejected.
- The token is generated per dashboard process, so it **changes when the container restarts**. The proxy must
  re‑scrape it, for example after a WS `HTTP 403` or a REST `401`, and retry.
- No subprotocol is needed. **Do not send `Sec-WebSocket-Protocol: hermes-gateway-v1`** in this mode: the
  server accepts the upgrade without echoing a protocol, and clients that require the echo (the `ws` lib,
  browsers) then fail with "Server sent no subprotocol".
- Rejected upgrades are refused **before** the WebSocket is accepted, so the client sees a plain
  **HTTP 403**, not a 4401 or 4403 close code.

Upgrade gate matrix, observed with `scripts/02-auth-origin.mjs`:

| Attempt | Result |
|---|---|
| no credential | HTTP 403 |
| `?token=nope` | HTTP 403 |
| `?token=<good>` | OPEN, first frame `gateway.ready` |
| `X-Hermes-Session-Token: <good>` header, no query | HTTP 403 |
| good token + `Host: localhost:5173` | OPEN |
| good token + `Origin: http://localhost:5173` | OPEN |
| good token + `Host`/`Origin: evil.example.com` | OPEN |
| good token + subprotocol `hermes-gateway-v1` | server accepts, but the client errors ("Server sent no subprotocol") |
| `?ticket=bogus` | HTTP 403 (tickets only apply in gated mode) |

**Why Host and Origin are not checked here.** On this deployment the dashboard runs as
`hermes dashboard --host 0.0.0.0` with `HERMES_UMBREL_APP_PROXY_AUTH=1`. That combination puts it in "insecure"
(non‑gated) mode, so:
- any Host or Origin is accepted, because a `0.0.0.0` bind skips the Host and Origin checks;
- any peer IP is accepted;
- auth is only the legacy `?token=`.

**[source] Other deployments behave differently.** `hermes_cli/web_server_chat.py::_ws_host_origin_reason`
and `_ws_auth_reason` apply:
- **Loopback bind (the default `hermes dashboard`).** `Host` must be a loopback name. `Origin`, when present
  and `http(s)`, must also point at loopback. The peer IP must be loopback.
- **Gated mode** (a non‑loopback bind without the Umbrel flag). `?token=` is refused. You need a single‑use,
  30‑second `?ticket=` minted by the dashboard's OAuth login, or the subprotocol pair
  `hermes-gateway-v1, hermes-gateway-ticket.<ticket>`.

**Proxy recommendation.** Proxy `/hermes/api/ws` to `ws://hermes:18789/api/ws?token=<token>`, appending the
token server‑side. Optionally rewrite `Host`/`Origin` to the upstream host so the same proxy also works
against a loopback‑bound Hermes. Never expose the token to the browser.

### 1.2 First frame: `gateway.ready`  [live]

The server sends this immediately after accept. You may send requests before it arrives.

```json
{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{
  "skin":{"name":"default","colors":{…},"light_colors":{…},"dark_colors":{},"branding":{"agent_name":"Hermes Agent",…},…},
  "change_events":true,"heartbeat":true,"replay_epoch":"1d7f3018ca674cf68378c70c7629c863"}}}
```

- `heartbeat: true` means the server answers `gateway.ping`.
- `replay_epoch` identifies the server process. If it changes between connections, the backend restarted:
  drop all `seq` watermarks (see [§1.6](#16-reconnect-and-replay)).
- `change_events: true` means the server broadcasts `sessions.changed` and `platforms.changed`, among others.

### 1.3 Capability handshake: send `client.capabilities` first  [live]

```json
-> {"jsonrpc":"2.0","id":"c-1","method":"client.capabilities","params":{"server_requests":true}}
<- {"jsonrpc":"2.0","id":"c-1","result":{"server_requests":["approval","clarify","display.install.sudo","preview.act","preview.read","secret","sudo","terminal.read","tour","vault.code","vault.save_login","vault.unlock_prompt","window.read"]}}
```

**This is mandatory.** A socket that never advertises `server_requests:true` is treated as a legacy client:
every approval is **withdrawn immediately** and the command is blocked. Observed with
`NO_CAPS=1 scripts/04-approval.mjs`:

```json
"result":{"output":"","exit_code":-1,"error":"BLOCKED: Command approval was withdrawn before the user answered (the attached client cannot answer approval requests (update the Hermes app)). …","status":"blocked","user_summary":"The approval prompt was withdrawn or never reached you — the command did not run."}
```

Send `client.capabilities` again on every new socket. The advertisement is per transport.

The official client also calls `gateway.capabilities`, which returned `{"per_session_exclusive_submit":true}`.

### 1.4 Heartbeat  [live]

- Client → server: `{"jsonrpc":"2.0","id":"heartbeat-1","method":"gateway.ping","params":{}}`, answered with
  `{"jsonrpc":"2.0","result":{"ok":true},"id":"heartbeat-1"}`. The server answers this on the read loop, so it
  never queues behind a slow RPC.
- The server does **not** ping the client.
- The official client (`apps/shared/src/json-rpc-channel.ts`) pings **every 15 s** and drops the socket if
  **45 s** pass with no inbound frame of any kind. Streamed deltas count as liveness. Do the same: it keeps
  proxy idle timeouts from firing.
- Server side [source]: a socket send that blocks for 30 s causes the server to close with code 1011. TCP
  keepalive is enabled.

### 1.5 RPC timing  [live + source]

- Most RPCs answer within milliseconds.
- `session.create` returns in about 30 ms. The agent is built *after* the reply, and the first
  `session.info` event arrives when the build finishes, about 2 s later.
- `prompt.submit` returns `{"status":"streaming"}` immediately. Everything after that arrives as events.
- Long handlers run on a pool. Their responses can arrive **out of order** relative to other responses, so
  always correlate by `id`.
- The official client's default request timeout is 120 s.
- `session.usage` can take about 1 s: it fetches account limits.

### 1.6 Reconnect and replay  [live]

Every session‑scoped event carries `seq`, a per‑runtime‑session monotonic integer starting at 1. Session‑less
broadcasts (`session_id: ""`) carry no `seq`. The server keeps a replay ring per session with these limits
(`tui_gateway/event_replay.py`):
- the last **512** events per session;
- at most **4 MiB** per session;
- at most **64** sessions;
- at most **64 MiB** for the whole process.

Reconnect procedure:
1. Open a new socket, wait for `gateway.ready`, then send `client.capabilities`.
2. If `replay_epoch` changed, the backend restarted. Clear the watermarks and refetch state through
   `session.resume` or REST history.
3. For each session you had open, call
   `session.events.since {"session_id":"<runtime sid>","last_seen":<last seq you processed>}`.
   - It returns `{"events":[<event params objects>…],"latest_seq":8,"truncated":false,"count":1,"epoch":"1d7f…","open_requests":[]}`.
   - If `truncated:true`, the gap was evicted: refetch history.
   - Dispatch only events whose `seq` is greater than your watermark, so nothing is applied twice.
   - `open_requests` lists server→client requests that are still unanswered (see step 5).
4. **Re‑attach**, or you will not get live events. A new socket receives **no live events** for an existing
   session until it calls `session.resume` (or `session.activate`). Observed: 0 live frames in 5 s on the new
   socket while the turn was still running. `session.resume {"session_id":"<stored_id>"}` re‑binds the
   session's emits to your socket. For a live session it returns the **same runtime id**, plus:

```json
{"session_id":"0a86d8e1","session_key":"20261013_122118_282901","resumed":"20261013_122118_282901","running":true,
 "status":"working","turn_started_at":…,"inflight":{"assistant":"","streaming":true,"user":"Use the terminal tool to run `sleep 6; …"},
 "message_count":…,"messages":[…],"messages_omitted":…,"info":{…SessionLiveInfo…},"open_requests":[…]?,"pending_approval":{…}?}
```

5. Re‑deliver `open_requests` to your request handler and mark them `replayed`. Answer with the same `id`.
   Verified with `scripts/15-approval-reconnect.mjs`: an approval opened on socket 1 was answered from socket 2
   after `session.resume`, and the command ran.

`session.events.since(sid, 0)` after a finished turn returned all 176 events of that session, with types
`session.info`, `message.start`, `thinking.delta`, `status.update`, `session.title`, `tool.start`,
`session.usage`, `tool.complete`, `message.delta`, `reasoning.available` and `message.complete`.

Recommended order on reconnect: `events.since` first (it fills the gap), then `session.resume` (it re‑attaches).
The official client parks live frames for a session while its replay is in flight and seq‑gates them
afterwards (`json-rpc-gateway.ts`).

### 1.7 Disconnect and orphan reaping  [live]

- When a socket closes, its sessions are **detached**, not killed. A running turn **keeps running**: events go
  to the replay ring, and a turn is interrupted only if it has been idle for 600 s.
- If no socket re‑attaches within **20 s** (`ws_orphan_reap_grace_s`), an idle session is reaped and every
  socket receives:
  `{"type":"session.reclaimed","session_id":"","payload":{"session_id":"febb0330","stored_session_id":"20261013_121946_50289e","reason":"ws_orphan_reap"}}`.
  The stored row stays, so `session.resume(stored_id)` brings it back.
- `session.create {close_on_disconnect:true}` reaps the session immediately on disconnect instead.

---

## 2. Sessions

### 2.1 `session.create`  [live]

Params (`SessionCreateParams`). All are optional.

| param | type | notes |
|---|---|---|
| `profile` | string | Profile name, e.g. `"murmur-test-a"`. Omit it for the default (launch) profile. It is stored on the session; every build and turn rebinds that profile's `HERMES_HOME` (config, auth, DB). |
| `title` | string | Applied when the DB row is created on the first prompt. Auto‑titling does **not** overwrite it [live]. |
| `model` | string | Per‑session model override. |
| `provider` | string | Per‑session provider. If the pair is incoherent you get error `-32602` (below). |
| `reasoning_effort` | string | `none` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultra`. Session‑scoped. |
| `fast` | bool | Omit to inherit. `true` pins `service_tier=priority`, `false` pins normal. |
| `source` | string | Stored as the row's `source`. The default is `"tui"`. `"murmur"` works and still appears in `session.list` [live]. |
| `cwd` | string | Workspace directory. It persists only if it exists. The default is the profile home (`/opt/data`). |
| `messages` | array | Seed transcript `[{role, content}]`. If present, the row is persisted immediately. |
| `parent_session_id` | string | For branches. |
| `close_on_disconnect` | bool | Default `false`. |
| `hidden` | bool | Hides the session from the default `session.list`. |
| `cols` | int | Terminal width for server rendering. Irrelevant for a web UI. |

```json
-> {"jsonrpc":"2.0","id":"c-2","method":"session.create","params":{"model":"gpt-6-luna","provider":"openai-codex","reasoning_effort":"low","title":"murmur model test"}}
<- {"jsonrpc":"2.0","id":"c-2","result":{"session_id":"78776f79","stored_session_id":"20261013_122615_133b4c","message_count":0,"messages":[],
    "info":{"model":"gpt-6-luna","provider":"openai-codex","tools":{},"skills":{},"cwd":"/opt/data","branch":"","project":null,"lazy":true,"desktop_contract":8,"profile_name":"default"}}}
```

An incoherent model and provider pair:

```json
<- {"jsonrpc":"2.0","id":"c-2","error":{"code":-32602,"message":"Model `claude-opus-4.6` is not served by provider `openai-codex` (ChatGPT or Codex Subscription). Closest …","data":{"model":"claude-opus-4.6","provider":"openai-codex","suggestions":["gpt-6-sol","gpt-6-sol-900k","gpt-6-luna","gpt-6-luna-900k","gpt-5.6-sol"]}}}
```

**No DB row exists until the first `prompt.submit`.** Drafts that are never used therefore leave no "Untitled"
rows behind. Until then, `session.list` does not show the session and `session.resume(stored_id)` cannot find it.

The full `info` (`SessionLiveInfo`) arrives later as a `session.info` event, after the agent build and again
after each turn, model switch and similar change. Fields:
- model and reasoning: `model`, `provider`, `reasoning_effort`, `reasoning_effort_wire`, `service_tier`, `fast`;
- approvals: `yolo`, `approval_mode` (`manual` \| `smart` \| `off`);
- capabilities: `tools` (toolset → names), `skills` (category → names), `mcp_servers`;
- workspace: `cwd`, `branch`, `project`;
- session state: `running`, `turn_started_at`, `title`, `stored_session_id`, `usage`, `profile_name`;
- build info: `version` (`"0.21.5"`), `release_date` (`"2026.9.24"`), `system_prompt`;
- `credential_warning`, present when the profile has no usable provider.

**`session.info` can be about 20 KB**, because it lists tools and skills. Keep only what the UI needs.

To list the available models, call `model.options {}`:

```json
{"providers":[{"slug":"openai-codex","name":"ChatGPT or Codex Subscription","is_current":true,"models":["gpt-6.1-sol","gpt-6-astra",…],
  "capabilities":{"gpt-6.1-sol":{"fast":true,"reasoning":true},…},"authenticated":true,…},{"slug":"moa",…}],"model":"gpt-6.1-sol","provider":"openai-codex"}
```

Pass `profile` to get that profile's options [source].

### 2.2 `session.resume`  [live]

Params: `session_id` (**the stored id**, or an exact title), `profile` (**required for a non‑default profile's
session**), and these optional flags:
- `lazy`: defer the agent build;
- `defer_history`: defer loading history;
- `omit_messages`: do not include the transcript in the reply. Use this if you load history over REST;
- `eager_build`: build the agent immediately;
- `close_on_disconnect`.

Result (`LiveSessionSnapshot`): `session_id` (runtime), `session_key`, `resumed`, `message_count`, `messages`
(TranscriptMessage[], see [§2.6](#26-history-for-rendering)), `info`, `running`, `status`
(`idle|starting|waiting|working|streaming|resuming`), `inflight`, `queued`, `pending_approval`,
`open_requests`, `todo_state` and others.

- If the session is live, you get the same runtime id. The socket is attached in addition to any existing
  ones, so events fan out to every attached socket [live].
- If it is not live, a new runtime id is minted and the stored model, provider, reasoning effort and fast flag
  are restored. Observed: a session switched to `gpt-6-sol` + fast came back as `gpt-6-sol`, `fast:true`.
- `session.activate {session_id:<runtime id>}` attaches to a session that is already live without the
  stored‑id lookup [source].

### 2.3 `session.list`  [live]

```json
-> {"method":"session.list","params":{"profile":"murmur-test-a","limit":5}}
<- {"result":{"sessions":[{"id":"20261013_122721_01b712","title":"Count from 1 to 15 in words, comma separated…","preview":"Count from 1 to 15 in words, comma separated. Nothing else.","started_at":1791894441.21,"message_count":4,"source":"tui"},…]}}
```

- Sessions are ordered most recent first. `limit` defaults to 200.
- **Filtering is per profile.** Each call reads that profile's `state.db`, so a single call cannot merge all
  profiles: call it once per profile. Omitting `profile` gives the default profile.
- `{"title":"<exact title>"}` does an exact‑title lookup and adds `resolved_id` (the compression tip).
- `include_hidden:true` includes hidden sessions.
- `session.most_recent {profile}` returns `{session_id,title,started_at,source}`.
- REST alternative [source]: `GET /api/sessions?limit=20&offset=0&order=recent&profile=<p>` supports paging,
  plus `GET /api/sessions/search`.

### 2.4 `session.title`, `session.delete`, `session.close`, `session.active_list`  [live]

- **Read the title:** `session.title {session_id:<runtime>}` returns `{"title":"…","session_key":"20261013_…"}`.
- **Set the title:** `session.title {session_id:<runtime>, title:"Murmur renamed chat"}` returns
  `{"pending":false,"title":"Murmur renamed chat"}`. `pending:true` means no row exists yet; the title is
  applied on the first turn.
- **Delete:** `session.delete {session_id:<STORED id>, profile}` returns `{"deleted":"20261013_122721_01b712"}`.
  - While the session is live: `{"code":4023,"message":"cannot delete an active session"}`. Call
    `session.close` first.
  - Without the right `profile`: `{"code":4007,"message":"session not found"}`.
- **Close:** `session.close {session_id:<runtime>}` returns `{"closed":true}`. It tears down the live session;
  the stored row stays resumable.
- **Active list:** `session.active_list {current_session_id?}` returns the **live sessions in the whole process**:
  `[{id, session_key, title, preview, status, model, message_count, started_at, last_active, current}]`.
  - It is **not filtered by profile**. Passing `profile` still returned sessions from other profiles [live].
  - The items carry no profile field, so track profiles client‑side.
- **Usage:** `session.usage {session_id}` returns the `Usage` object plus `account_lines`:

```json
{"model":"gpt-6.1-sol","input":13242,"output":54,"reasoning":0,"prompt":33594,"completion":54,"total":33648,"calls":2,"context_used":16830,"context_max":500000,"context_percent":3,"context_source":"provider_usage","context_estimated":false,"compressions":0,"cache_hit_pct":61,"avg_latency_s":4.2,"avg_tps":6.4,"active_subagents":0,
 "account_lines":["📈 Account limits","Provider: openai-codex (Pro)","Weekly: 98% remaining (2% used) • resets in 6d 16h (2026-10-20 05:01 UTC)","You have 3 resets banked - use /usage reset to activate"]}
```

### 2.5 Global broadcasts you will see  [live]

These events have `session_id:""` and no `seq`:
- `sessions.changed {}`: refetch the session list. Debounce it; it fires several times per turn.
- `platforms.changed {}`.
- `session.reclaimed {session_id, stored_session_id, reason}`.
- `skin.changed`.
- `cron.changed`.

**They reach every socket, including events about other clients' sessions**, so filter them.

### 2.6 History for rendering

There are two sources.

**A. `session.history {session_id:<runtime>}`, or `messages` in `session.resume`.** This is the display
projection (`TranscriptMessage[]`) [live]:

```json
{"count":4,"messages":[
 {"role":"user","text":"Use your terminal tool to run `echo hello-from-murmur && date -u +%Y` and then tell me …","timestamp":1791893792.945,"row_id":1},
 {"role":"tool","name":"terminal","context":"echo hello-from-murmur + 1 command","tool_call_id":"call_LNgegFwOINK21IiDaUTwqZBJ","timestamp":1791893800.68,"args":{"command":"echo hello-from-murmur && date -u +%Y"}},
 {"role":"assistant","text":"It printed `hello-from-murmur` followed by `2026` on the next line.","timestamp":1791893804.29,"row_id":4,
  "codex_message_items":[{"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"…"}],"id":"msg_…","phase":"final_answer"}]}]}
```

- Assistant rows that only issued tool calls (empty text) are dropped. Tool rows carry `name`, `context` (an
  80‑character preview), `args` and `tool_call_id`.
- **Tool output is omitted.** The exceptions are `write_file`, `patch` and `skill_manage`, which keep
  `content`.
- Assistant rows may carry reasoning sidecars: `reasoning`, `reasoning_content`, `reasoning_details`,
  `codex_reasoning_items` (**can be many KB of `encrypted_content`**; ignore it) and `codex_message_items`.
  Observed on `gpt-5.6-sol`: `"reasoning":"**Calculating XOR result using counts**"`.
- `display_kind` marks special rows:
  - `steer`: a user correction made mid‑turn;
  - `failed_turn`: the assistant row added after an interrupted or failed turn, e.g. "This turn did not
    complete. Some actions may already have run; …";
  - `process_complete`: a synthetic user row when a background process finishes;
  - `skill_invocation`;
  - `hidden`: such rows are never sent.
- `count` counts DB rows, so it can exceed `messages.length`.

**B. REST `GET /api/sessions/{stored_id}/messages?profile=<p>[&limit=&offset=&order=latest|oldest]`** gives
the raw DB rows, paged, with the latest 500 by default [live]. Each row carries the full tool data:
- the assistant row has `tool_calls:[{id,call_id,type:"function",function:{name,arguments:"<json string>"}}]`
  and `finish_reason:"tool_calls"`;
- the tool row has `role:"tool"`, `tool_call_id`, `tool_name` and `content:"{\"output\": \"hello-from-murmur\\n2026\", \"exit_code\": 0, \"error\": null}"`;
- other columns: `reasoning`, `codex_message_items` (a **JSON string** here, but a decoded list over RPC),
  `display_kind` and `api_content`, which is the model‑facing text with the injected Umbrel runtime context.

**Recommendation:** render from REST (B) to get full tool results and paging. Use RPC history only for a quick
first paint.

**User rows with attachments store the expanded text** [live], from both sources:

```
"One word: what colour?\n\n[Image attached at: /opt/data/images/upload_20261013_122855_1.png]\n[screenshot]\nUmbrel Runtime Context:\n…"
"@file:attachments/notes.txt\n\nIn one line each: …\n\n--- Attached Context ---\n\n📄 @file:attachments/notes.txt (8 tokens)\n```\nThe secret word is MANGO-42.\n…"
```

Plain prompts are stored clean. To display the user text:
- cut at the first `\n--- Attached Context ---`, as Desktop's `ATTACHED_CONTEXT_MARKER_RE` does;
- cut at the first `\n\n[Image attached at:`;
- turn `@file:<path>` refs into chips.

---

## 3. A turn

### 3.1 `prompt.submit`  [live]

```json
-> {"jsonrpc":"2.0","id":"c-3","method":"prompt.submit","params":{"session_id":"057c7e14","text":"Use your terminal tool to run `echo hello-from-murmur && date -u +%Y` …"}}
<- {"jsonrpc":"2.0","id":"c-3","result":{"status":"streaming","user_row_id":1}}
```

Params:
- `session_id`, `text`, and `profile`, which is harmless and recommended for non‑default profiles.
- `queued:true`: for a drain from a client‑side queue, see [§4](#4-interrupt-steer-queueing-and-per-session-model-or-effort).
- `display_kind:"hidden"`: a model‑only turn.
- `title_preview`.
- Edit and regenerate: `truncate_before_row_id` + `confirm_truncate:true`.

Result `status`:
- `streaming`: the turn started.
- `queued` / `redirected` / `steered`: the session was busy (see [§4](#4-interrupt-steer-queueing-and-per-session-model-or-effort)).

`user_row_id` is the DB row id of your message. It is absent when the message was queued, steered or redirected.

### 3.2 Event sequence, one turn with a tool call  [live, `scripts/03-turn.mjs`, `gpt-6.1-sol`]

Time in ms since connect. `…` marks trimmed payloads. Session‑less broadcasts are interleaved.

```
  202 <- result {"status":"streaming","user_row_id":1}
  397 <- event sessions.changed  session_id:""  {}
 2537 <- event session.info      seq:1  {model,provider,reasoning_effort:"medium",approval_mode:"smart",tools:{…},…}   (agent build done)
 2542 <- event message.start     seq:2  (no payload)
 2789 <- event session.title     seq:3  {"session_id":"20261013_121632_c3e926","title":"Use your terminal tool to run `echo…"}
 2831 <- event thinking.delta    seq:4  {"text":"(¬_¬) mulling..."}
 3783 <- event status.update     seq:5  {"kind":"warn","text":"⚠ Auxiliary title generation failed: Unsupported value: 'none' …"}
 7651 <- event thinking.delta    seq:6  {"text":""}
 7651 <- event tool.start        seq:7  {"tool_id":"call_LNgegFwOINK21IiDaUTwqZBJ","name":"terminal","context":"echo hello-from-murmur + 1 command","args":{"command":"echo hello-from-murmur && date -u +%Y"}}
 7933 <- event tool.complete     seq:8  {"tool_id":"call_LNge…","name":"terminal","args":{…},"duration_s":0.283,"result":{"output":"hello-from-murmur\n2026","exit_code":0,"error":null}}
 7970 <- event thinking.delta    seq:9  {"text":"ಠ_ಠ pondering..."}
 8586 <- event session.usage     seq:10 {"usage":{"model":"gpt-6.1-sol","input":13052,"output":30,…,"context_used":16764,"context_max":500000,"context_percent":3,…}}
10705 <- event thinking.delta    seq:11 {"text":""}
10706 <- event message.delta     seq:12 {"text":"\n\nIt"}
10706 <- event message.delta     seq:13 {"text":" printed"}
 …       message.delta ×20 total, seq 12‥31
11536 <- event thinking.delta    seq:32 {"text":""}
11536 <- event reasoning.available seq:33 {"text":"It printed `hello-from-murmur` followed by `2026` on the next line."}
11550 <- event message.complete  seq:34 {"text":"It printed `hello-from-murmur` followed by `2026` on the next line.",
                                        "usage":{…"calls":2…},"status":"complete",
                                        "persisted_turn":{"row_ids":[1,2,3,4],"complete":true,"user_row_id":1,"final_assistant_row_id":4}}
11766 <- event sessions.changed  session_id:""
11802 <- event session.info      seq:35 {…post-turn refresh…}
```

Multiple tool calls repeat the `thinking.delta` → `tool.start` → `tool.complete` → `session.usage` cycle, one
cycle per model call.

### 3.3 Event payloads  (contract: `tui_gateway/contracts/events.py`)

| event | payload | notes |
|---|---|---|
| `message.start` | none | A turn (or a queued turn) began. [live] |
| `message.delta` | `{text, rendered?}` | Append `text`. The first delta of a segment often starts with `"\n\n"`. The server coalesces deltas into batches every 33 ms, so you may get several frames in the same tick. [live] |
| `message.complete` | `{text, usage, status:"complete"\|"error"\|"interrupted", reasoning?, persisted_turn?, error?, recoverable?, error_surface?, warning?, partial?, billing?}` | **Authoritative final text, trimmed.** Replace the streamed buffer with it. In 2 of 2 checks it equalled the concatenated deltas, trimmed. [live] |
| `message.interim` | `{text, already_streamed}` | Interim commentary sealed as its own segment, next to tool calls. [source; not observed] |
| `thinking.delta` | `{text}` | **Not model reasoning.** It is the agent's spinner or status line ("(¬_¬) mulling...", "ಠ_ಠ pondering..."). `""` clears it. Show it as a transient "working" indicator only; never put it in the transcript. [live] |
| `reasoning.delta` | `{text, verbose?}` | Streamed reasoning or summary. Seen on `gpt-5.6-sol` (`"**Calculating XOR result using counts**"`). **Never seen on `gpt-6.1-sol`**. [live] |
| `reasoning.available` | `{text, verbose?}` | A completed reasoning block for non‑streaming providers. **Quirk:** on openai‑codex it consistently carried a copy of the **final answer text**, emitted right before `message.complete`. Do not render it as reasoning when it equals `message.complete.text`. [live] |
| `tool.generating` | `{name}` | The model is writing tool arguments. Gated by the tool‑progress setting. [source; not observed] |
| `tool.start` | `{tool_id, name, context?, args?, args_text?, preview?, labels?}` | `tool_id` is the stable id; it equals `tool_call_id` in history. [live] |
| `tool.complete` | `{tool_id, name, args?, duration_s?, result, summary?, result_text?, inline_diff?, todos?, revision?, labels?}` | `result` is parsed JSON when possible. Blocked commands produce `result:{exit_code:-1,error:"BLOCKED: …",status:"blocked",user_summary:"…"}`. Approved ones produce `result.approval:"Command required approval (delete in root path) and was approved by the user."`. [live] |
| `tool.output_risk` | `{tool_id,name,risk,findings[],redacted}` | [source] |
| `todo.updated` | `{todos[], revision}` | [source] |
| `status.update` | `{kind, text}` | Kinds include `status`, `warn`, `lifecycle`, `compacting`, `goal`, `loop` and `process`. Show it as a toast or status line. [live] |
| `session.usage` | `{usage: Usage}` | A mid‑turn tick after each model call. [live] |
| `session.title` | `{session_id:<STORED id>, title}` | Note that `payload.session_id` is the **stored** id, while `params.session_id` is the runtime id. It fires early, right after `message.start`, with a truncated first‑prompt title, and may fire again (see the gotchas). [live] |
| `session.info` | `SessionLiveInfo` | See [§2.1](#21-sessioncreate). [live] |
| `error` | `{message}` | A session‑level failure, e.g. the agent failed to initialise. It is followed by `message.complete{status:"error"}`. [live] |
| `notification.show` / `notification.clear` | `{text,level,kind,ttl_ms,key,id}` / `{key}` | Credits and notices. [source] |
| `request.cancel` | `{id, method, reason}` | Withdraws a server→client request. Tear down its card. [live] |
| `agent.terminal.output` | | Background process output. Seen after an interrupt. [live, payload not inspected] |
| `subagent.*`, `moa.*`, `background.complete`, `btw.complete` | | [source] |

**Error turn** [live, `scripts/13-errors.mjs`, a session on provider `openrouter` with no key]:

```json
{"type":"error","session_id":"9ecd8723","payload":{"message":"Hermes could not start the assistant for this session. Details: No LLM provider configured. …"},"seq":1}
{"type":"message.complete","session_id":"9ecd8723","payload":{"text":"The request failed. Your message was not answered.\nDetails: No LLM provider configured. …\nSend /retry, or switch with /model.","usage":{},"status":"error","error":"No LLM provider configured. …","recoverable":true,"error_surface":{"layer":"runtime","code":"agent_init_failed","retryable":true}},"seq":2}
```

`prompt.submit` still returned `{"status":"streaming"}`. The failure arrives only as events.

**RPC error codes seen:**

| code | meaning |
|---|---|
| `4001` | session not found (unknown runtime id) |
| `4002` | invalid value, e.g. `unknown reasoning value: turbo` |
| `4007` | stored session not found (wrong profile) |
| `4009` | session busy (only for truncating submits) |
| `4023` | cannot delete an active session |
| `5028` | pdf.attach failed (`pdftoppm not installed`) |
| `-32602` | bad params / model and provider conflict |
| `-32601` | unknown method |
| `5035` | backend retiring, reconnect [source] |

---

## 4. Interrupt, steer, queueing, and per‑session model or effort

### 4.1 While a turn is running  [live, `scripts/07-busy.mjs`, `scripts/08-queue.mjs`]

| Call while busy | Result | Effect |
|---|---|---|
| `session.steer {session_id, text}` | `{"status":"queued","text":"…"}` | Injected into the next tool result; does not stop the turn. Shows in history as a `display_kind:"steer"` user row. |
| `prompt.submit {session_id, text}` (no flag) | `{"status":"redirected"}` | Default `display.busy_input_mode = interrupt`: the text **redirects the live turn** (folded in as a correction). It is not a new turn. |
| `prompt.submit {session_id, text, queued:true}` | `{"status":"queued"}` | Server FIFO. It **runs automatically after the current turn**: a new `message.start` … `message.complete(SECOND-OK)` followed. |
| `session.interrupt {session_id}` | `{"status":"interrupted"}` | The turn ends with `message.complete {"text":"","status":"interrupted","persisted_turn":{…,"complete":false}}`, and history gets a `failed_turn` assistant row. |

Observed in one run: a prompt queued with `queued:true` was **dropped** when `session.interrupt` followed it,
while a background‑process follow‑up still triggered a new turn. **Recommendation:** keep Murmur's own
"send next" queue client‑side, as Desktop does. Send each item with `prompt.submit {queued:true}` only after
`message.complete`, or send it during a turn and accept that Stop clears it.

`session.active_list[].preview` shows the queued text while it waits.

### 4.2 Model, reasoning effort and fast mode per session  [live, `scripts/09-model-effort.mjs`]

| Action | Request | Response |
|---|---|---|
| Set effort | `config.set {session_id, key:"reasoning", value:"high"}` | `{"key":"reasoning","value":"high"}` |
| Switch model | `config.set {session_id, key:"model", value:"gpt-6-sol"}` | `{"key":"model","value":"gpt-6-sol","warning":"","confirm_required":false,"confirm_message":"","scope":"session"}` |
| Fast mode | `config.set {session_id, key:"fast", value:"fast"\|"normal"}` | `{"key":"fast","value":"fast"}`; `session.info` then shows `fast:true, service_tier:"priority"` |
| Read effort | `config.get {key:"reasoning", session_id}` | `{"value":"high","display":"show"}` |

Details:
- `value` for `reasoning` is one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`. With a
  `session_id` and no `scope`, the change is **session‑scoped**.
- **`scope:"global"` writes the profile's `config.yaml`. Avoid it.**
- **`value` words `show`/`hide`/`full`/`clamp` do not set effort.** They change the reasoning *display* config,
  and **write config.yaml** for the profile.
- A model switch is session‑scoped. To name a provider, use `"<model> --provider <slug>"`, the `/model`
  syntax [source]. If `confirm_required:true`, re‑send with `confirm_expensive_model:true`. A switch made
  while a turn runs is stashed and applies at the next turn (`deferred:true`).
- `config.set model` **without** `session_id` fails with error `4001` by design.
- **Gotcha: a model switch resets reasoning effort to the profile default.** Observed: `high` → `medium`
  after switching `gpt-6-luna` → `gpt-6-sol`. Set the model first, then the effort.

**Persistence.** The session's runtime overrides (model, provider, effort, fast) are written to the stored
row. After `session.close` + `session.resume` the session came back as `gpt-6-sol`, `medium`, `fast:true`.
The profile's `config.yaml` was not touched: verified by its mtime.

**[source] Approval mode.** `config.set {key:"approvals.mode", value:"manual|smart|off"}` writes the
**profile's config**, not the session's. `config.set {key:"yolo", value:"on|off", session_id}` is
session‑scoped auto‑approve.

---

## 5. Server → client requests

Every one of these arrives as `{"jsonrpc":"2.0","id":"srq-<12hex>","method":<m>,"params":{"session_id":<runtime sid>,…}}`.

- Answer with `{"jsonrpc":"2.0","id":"srq-…","result":{…}}`.
- To decline the request type, answer `{"jsonrpc":"2.0","id":"srq-…","error":{"code":-32601,"message":"…"}}`.
  The server treats that as "no answer" and withdraws the request at once, instead of waiting out the timeout.
- If the request times out, or is cancelled by an interrupt, the server sends the event
  `request.cancel {id, method, reason}` with `reason` `timeout` or `interrupted`. Remove the card.
  A late answer is silently dropped.
- Unanswered requests come back in `open_requests` from `session.resume`, `session.activate` and
  `session.events.since`.

### 5.1 `approval`  [live, `scripts/04-approval.mjs`, `scripts/15-approval-reconnect.mjs`]

```json
<- {"jsonrpc":"2.0","id":"srq-7a9a46c65ad9","method":"approval","params":{"session_id":"febb0330","command":"rm -rf /tmp/murmur-approval-test",
    "pattern_key":"delete in root path","pattern_keys":["delete in root path"],"description":"delete in root path",
    "allow_permanent":true,"allow_session":true,"request_id":"8d0561b34bb246149192a09b20a0790e","choices":["once","session","always","deny"]}}
-> {"jsonrpc":"2.0","id":"srq-7a9a46c65ad9","result":{"choice":"once"}}
```

- `choice` is one of `once`, `session`, `always` or `deny`. Add `"all":true` to resolve every queued approval
  in the session.
- `params.command` is redacted server‑side. Other keys are open, so render `description` and `command`.
- The request arrives *after* `tool.start` for that tool call. `tool.complete` follows once it resolves.

Outcomes, all observed live:

| Answer | `tool.complete.result` |
|---|---|
| `once` | `{"output":"","exit_code":0,"error":null,"approval":"Command required approval (delete in root path) and was approved by the user."}` |
| `deny` | `{"exit_code":-1,"error":"BLOCKED: Command denied by user. …","status":"blocked","user_summary":"You denied this command — it did not run."}` |
| no answer | After `approvals.timeout` (default **300 s**; 25 s in the test profile): event `request.cancel {"id":"srq-0b122c27d989","method":"approval","reason":"timeout"}`, then `tool.complete.result` `{"exit_code":-1,"error":"BLOCKED: Command timed out without user response. …","status":"blocked","user_summary":"No answer within 25 seconds — the command did not run."}` |

The agent then continues the turn and explains the outcome.

**How to trigger an approval in testing.** The default profile here uses `approval_mode:"smart"`. In that
mode an auxiliary LLM **auto‑approved** `rm -rf /tmp/x`, and `tool.complete.result.approval` read
`"Command was flagged (delete in root path) and auto-approved by smart approval."`. You need a profile with:

```yaml
approvals:
  mode: manual
  timeout: 25
```

The test profile `murmur-test-a` was set up this way. Then prompt: *"Run exactly this shell command with your
terminal tool, nothing else: rm -rf /tmp/murmur-approval-test"*.

### 5.2 `clarify`  [live, `scripts/12-clarify.mjs`]

This version sends the **batch form** even for a single question:

```json
<- {"jsonrpc":"2.0","id":"srq-9e224ebdaa9d","method":"clarify","params":{"session_id":"640814df","questions":[{"qid":"q0","question":"Which colour do you prefer?","choices":["red (Recommended)","blue"],"multi_select":false}]}}
-> {"jsonrpc":"2.0","id":"srq-9e224ebdaa9d","result":{"answers":{"q0":"red (Recommended)"}}}
```

- The tool result normalised the answer to `"user_response":"red"`.
- The single‑question form, with `question`, `choices` and `multi_select` at the top level, is answered with
  `{"answer":"…"}`. An empty string `""` means skip [source].
- For batches you may lock answers early with the RPC `clarify.lock {request_id, question_id, answer}`. A
  response with neither `answer` nor `answers` means cancel‑all [source].
- Free text is allowed: `choices` may be null [source].
- Timeout: `clarify.timeout`, default **3600 s** [source].

### 5.3 `sudo` and `secret`  [source, not triggered live]

| Method | Params | Answer | Notes |
|---|---|---|---|
| `sudo` | `{session_id, command}` (redacted) | `{"value":"<password>"}`, or `{"value":""}` to decline | Timeout 120 s. Render a masked input. |
| `secret` | `{session_id, env_var, prompt, metadata?}` | `{"value":"…"}`, or `""` to skip | Used by skill and setup flows. Masked input. |

The other server requests in the capability list (`vault.*`, `terminal.read`, `preview.*`, `window.read`,
`tour`, `display.install.sudo`) are Desktop‑GUI bridges. Answer them with `-32601`.

---

## 6. Attachments  [live, `scripts/11-attachments.mjs`]

You stage attachments on the session **before** `prompt.submit`. Images are consumed by the next submit.

| Method | Request | Response |
|---|---|---|
| Image from bytes | `image.attach_bytes {session_id, content_base64, filename}` (`data` is an alias of `content_base64`; magic bytes decide the type) | `{"attached":true,"path":"/opt/data/images/upload_20261013_122755_1.png","count":1,"remainder":"","text":"[User attached image: upload_20261013_122755_1.png]","bytes":178,"name":"upload_…png","width":64,"height":64,"token_estimate":85}` |
| Remove an image | `image.detach {session_id, path}` | `{"detached":true,"count":1}` |
| Image already on the host | `image.attach {session_id, path}` | [source] |
| File | `file.attach {session_id, name, data_url:"data:text/plain;base64,…"}`, or `{path}` if the file is already on the gateway host | `{"attached":true,"name":"notes.txt","path":"/opt/data/attachments/notes.txt","ref_path":"attachments/notes.txt","ref_text":"@file:attachments/notes.txt","uploaded":true}` |
| PDF | `pdf.attach {session_id, content_base64, filename, first_page?, last_page?}` | **Fails on this image:** `{"code":5028,"message":"pdftoppm not installed (poppler-utils package required)"}` |

Notes:
- `count` from `image.attach_bytes` is the number of images queued.
- **`file.attach` only stages the file.** You must put `ref_text` (`@file:attachments/notes.txt`) into the
  prompt text yourself; the server then inlines the file content. Desktop does the same.
- On success, `pdf.attach` renders the pages to PNGs and queues them as images. Fallback: send the PDF with
  `file.attach` and an `@file:` ref.

Observed: with the image and `@file:` attached, `gpt-6.1-sol` answered "Image colour: red. Secret word:
MANGO-42." The image went natively into the user message. The model also called `vision_analyze`, which
replied `already_in_context:true`.

For history rendering of attachment turns, see [§2.6](#26-history-for-rendering).

---

## 7. Multiple concurrent sessions on one socket  [live, `scripts/10-parallel.mjs`]

**This works.** One socket can drive sessions in **different profiles at the same time**:

```
session.create {profile:"murmur-test-a"} -> session_id fd33dee4 (info.profile_name "murmur-test-a")
session.create {profile:"murmur-test-b"} -> session_id 3ebbc46b (info.profile_name "murmur-test-b")
prompt.submit to both concurrently       -> both complete in 12.2 s total, events interleaved:
A:2:message.start A:3:session.title B:2:message.start A:5:status.update B:3:session.title B:5:status.update … B:39:message.complete A:38:message.complete
```

- Route events strictly by `params.session_id`. Each session has its own `seq` space.
- The streamed text equalled the `message.complete` text in both sessions, with no cross‑talk.
- `session.list {profile}` showed each session only in its own profile.
- **Two sockets on one session** (two tabs): after `session.resume(stored_id)` on socket 2, both sockets
  received every event of the next turn. Either socket can submit [live, `scripts/14-two-sockets.mjs`].
- The replay ring keeps the 64 most recent sessions per process. The live‑session cap is enforced by
  `_schedule_session_cap_enforcement`, which trims detached idle sessions [source].

---

## 8. Gotchas (all observed live unless marked)

1. **Send `client.capabilities {server_requests:true}` on every socket.** Without it, approvals are
   auto‑withdrawn and dangerous commands are blocked.
2. **Runtime id vs stored id.** Events and session RPCs use the runtime id. List, resume, delete, REST and the
   `session.title` payload use the stored id. The runtime id dies about 20 s after the last socket leaves:
   always persist the **stored** id in the UI.
3. **A new socket gets no live events for a session until `session.resume` or `session.activate`.**
   `session.events.since` only replays; it does not attach.
4. **`thinking.delta` is a spinner string (kaomoji + verb), not reasoning.** Real reasoning is
   `reasoning.delta`, and `message.complete.reasoning` / history `reasoning`. Codex `gpt-6.1-sol` emitted
   none; `gpt-5.6-sol` emitted a short summary.
5. **`reasoning.available` on openai‑codex duplicates the final answer.** Suppress it when it equals
   `message.complete.text`.
6. **`message.delta` text begins with `"\n\n"`, while `message.complete.text` is trimmed.** Trim the leading
   whitespace, or replace the streamed text with the final text on complete.
7. **The first title is a truncated first prompt** ("Use your terminal tool to run `echo…"). It arrives as
   `session.title` right after `message.start`. A generated title, such as "Identify colour in image" or
   "Count integers divisible exclusively", replaces it **only when the auxiliary title LLM succeeds**. On this
   instance it usually failed, emitting a `status.update` of kind `warn`: "Auxiliary title generation failed:
   Unsupported value: 'none' is not supported with the 'gpt-6.1-sol' model…". That is a Hermes/Codex config
   issue, not a protocol one.
   - Set `title` in `session.create`, or call `session.title` yourself. Consider hiding `warn` statuses that
     start with "Auxiliary".
   - Duplicate titles in one profile get a ` #2` suffix.
   - `session.title` can fire twice in a turn.
8. **The default `smart` approval mode auto‑approves many "dangerous" commands**, so an approval UI may rarely
   fire on the default profile.
9. **History user rows of attachment turns contain injected text**: the `--- Attached Context ---` block,
   `[Image attached at: …]` and the Umbrel Runtime Context. Strip it before display.
10. **`session.history` omits tool output**, except for edit tools. Use REST `/api/sessions/{id}/messages` for
    full tool results. Assistant rows can carry large `codex_reasoning_items` blobs: prefer
    `session.resume {omit_messages:true}` and paged REST history.
11. **`pdf.attach` is unavailable** in this Umbrel image (no poppler).
12. **A model switch resets reasoning effort.** Re‑apply the effort after `config.set model`.
13. **`config.set reasoning show|hide|full|clamp` and `approvals.mode` write the profile's `config.yaml`.**
    Effort words are session‑scoped only when a `session_id` is given and there is no `scope:"global"`.
14. **Busy semantics.** A plain second `prompt.submit` *redirects* the running turn. Use `queued:true` for
    "send after". `session.interrupt` may drop server‑queued prompts, so keep the queue client‑side.
15. **Broadcasts are process‑wide.** `sessions.changed`, `session.reclaimed` and `session.active_list` include
    other clients' and other profiles' sessions. Here they included group‑chat sessions from other test
    profiles.
16. **`session.delete` needs the stored id, the right `profile`, and a non‑live session.** Call
    `session.close` first; otherwise you get `4023` or `4007`.
17. **No DB row exists until the first prompt.** `session.resume(stored_id)` on a never‑prompted session
    fails. Keep the runtime id until then.
18. **Rejected upgrades are HTTP 403, not close codes.** The token rotates on container restart, so re‑scrape
    it in the proxy.
19. **Responses can arrive out of order** (pool handlers). Correlate by `id`. Server request ids are strings
    `srq-…`; use string ids of your own that cannot collide, e.g. a `"m-<n>"` prefix.
20. **`session.info` payloads are about 20 KB**, and the event is emitted after every turn and every config
    change.

---

## 9. Minimal client algorithm (pseudo‑code)

```ts
ws = new WebSocket(`${proxyBase}/hermes/api/ws`)          // proxy appends ?token=
on gateway.ready: if epoch changed → clear seq marks; send client.capabilities {server_requests:true};
                  start ping every 15s (gateway.ping), drop socket if 45s silence
                  for each open chat: events.since(runtimeId, lastSeq) → apply seq>lastSeq; session.resume(storedId, profile, omit_messages:true)
                  → map runtime id; deliver open_requests
new chat:  session.create {profile, title?, model?, provider?, reasoning_effort?} → keep {runtimeId, storedId, profile}
send:      prompt.submit {session_id: runtimeId, text}   (busy → client queue, drain on message.complete with queued:true)
events:    route by params.session_id; track seq; message.start → new bubble; message.delta → append;
           tool.start/complete → tool card by tool_id; message.complete → finalize (status complete|error|interrupted);
           thinking.delta → spinner text; reasoning.delta → reasoning panel; session.title → rename (payload.session_id = storedId)
requests:  approval → {choice}; clarify → {answers:{qid:…}}; sudo/secret → {value}; others → error -32601;
           request.cancel → remove card
stop:      session.interrupt {session_id}
history:   GET /hermes/api/sessions/{storedId}/messages?profile=…&order=latest&limit=…
```

---

## 10. Test scripts

They live in `docs/hermes/scripts/` and need Node 22+. They use the global `WebSocket`, except
`02-auth-origin.mjs`, which needs the `ws` package: `WS_DIR=<dir containing node_modules/ws>`.

Configuration:
- `HERMES_URL` (default `http://localhost:18789`).
- `HERMES_TOKEN` (default: scraped from the SPA).
- `QUIET=1` silences the frame log.
- `LOG_DELTAS=1` logs every delta instead of collapsing them.

| script | covers |
|---|---|
| `lib.mjs` | Tiny JSON‑RPC client: `rpc`, events, server‑request hook, frame log. |
| `01-connect.mjs` | `gateway.ready`, `client.capabilities`, `gateway.ping`, `gateway.capabilities`. |
| `02-auth-origin.mjs` | Upgrade gate matrix: token, header, Host, Origin, subprotocol. |
| `03-turn.mjs ["prompt"]` | Full turn plus history, usage, title, list. Env: `EFFORT`, `TITLE`, `FRAMES_OUT=file.json`. |
| `04-approval.mjs` | Approval. Env: `CHOICE=once\|session\|always\|deny\|none\|interrupt`, `PROFILE`, `NO_CAPS=1`. |
| `05-profiles-setup.mjs` | Create the `murmur-test-a` and `murmur-test-b` profiles. `DELETE=1` removes them. |
| `06-reconnect.mjs` | Drop mid‑turn, `events.since`, `session.resume`, finish. |
| `07-busy.mjs` | Steer, redirect, `queued:true`, interrupt. |
| `08-queue.mjs` | Server queue drain without an interrupt; `session.active_list`. |
| `09-model-effort.mjs` | `create` model/effort, `config.set` reasoning/model/fast, persistence across resume. |
| `10-parallel.mjs` | Two profiles in parallel on one socket; `list`, `title`, `close`, `delete`. |
| `11-attachments.mjs` | `image.attach_bytes`, `image.detach`, `file.attach`, `pdf.attach`. |
| `12-clarify.mjs` | Clarify request and answer. |
| `13-errors.mjs` | Unknown session, provider failure turn, bad `config.set`. |
| `14-two-sockets.mjs` | Fan‑out to two sockets attached to one session. |
| `15-approval-reconnect.mjs` | Pending approval re‑delivered via `open_requests` after a reconnect. |

`04` (with `PROFILE`) and `15` need a profile with `approvals: {mode: manual, timeout: 25}` in its
`config.yaml`. Create one with `05-profiles-setup.mjs`, then append that block to
`/opt/data/profiles/murmur-test-a/config.yaml`.
