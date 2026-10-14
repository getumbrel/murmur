# Hermes: models, providers and onboarding (Murmur integration spec)

Target: Hermes Agent **v0.21.5** (tag `v2026.9.24`), dashboard at `http://localhost:18789`
(container `hermes-agent_web_1`, `HERMES_HOME=/opt/data`). Live-verified 2026-10-13.

**Legend:** **[LIVE]** means the request and response were captured against the running instance.
**[CODE]** means the shape was read from source at the matching tag and not exercised live,
usually because exercising it would disturb the user's real account.

Every REST call goes through the Murmur proxy: `/hermes/*` → `http://hermes:18789/*`. The proxy adds
`X-Hermes-Session-Token: <token>`. A missing or bad token gets `401 {"detail":"Unauthorized"}` [LIVE].
JSON-RPC calls go over `ws://…/api/ws?token=<token>`, using newline-delimited JSON-RPC 2.0. The first
frame is `{"method":"event","params":{"type":"gateway.ready",…}}`. In gated (non-loopback) mode,
`?token=` is rejected and a ticket is required instead (see the transport doc). This spec only uses
the RPCs it needs.

Scripts that reproduce every [LIVE] capture are in `docs/hermes/scripts/models-*.mjs`. They need
Node 22 and have no dependencies; `models-lib.mjs` is the shared helper. Section 9 lists them.

---

## 0. Mental model (read first)

| Concept | Where it lives | Scope |
|---|---|---|
| Main model `{provider, default(model), base_url, api_mode}` | `config.yaml` → `model:` | **per profile** (= per agent) |
| API keys (`OPENROUTER_API_KEY`, …) | profile's `.env` | **per profile** |
| OAuth grants (Codex, Nous, xAI-OAuth, MiniMax) | `auth.json` | stored per profile, **but a profile with no grant of its own falls back read-only to the default root's `auth.json`**, so a ChatGPT login on `default` also makes Codex usable on every profile [LIVE] |
| Custom/local endpoints | `config.yaml` → `providers.<id>` (+ key in `.env` as `HERMES_CUSTOM_<ID>_API_KEY`) | per profile |
| Default reasoning effort | `config.yaml` → `agent.reasoning_effort` (default `medium`) | per profile |
| Per-chat model / effort | live session state (`session.create` params, `config.set … session_id`) | per session, never written to config |

New profiles (`POST /api/profiles` without clone) are seeded with a **copy of the launch profile's
`model:` block**. If that block points at a custom `providers:` entry, the entry is copied too. So a
new agent works immediately when the default profile uses OAuth or a custom endpoint [LIVE]. API keys
are **not** copied: a default profile running on `OPENROUTER_API_KEY` yields a new profile whose
`runtime_check` fails until a key is added to it. The new profile's `.env` contains only comments.

`POST /api/model/set` and the other config writes apply to **new sessions**. Live sessions keep
their model until it is switched with `config.set model … session_id`.

---

## 1. "Is a usable model configured?"

### 1.1 What Hermes Desktop does (`apps/desktop/src/lib/runtime-readiness.ts`)

Desktop calls two JSON-RPCs in parallel and **`setup.runtime_check.ok` is authoritative**.
`setup.status.provider_configured` is used only when runtime_check does not answer. If the two
disagree, Desktop shows "unavailable" instead of onboarding.

```jsonc
// -> {"jsonrpc":"2.0","id":1,"method":"setup.status","params":{"profile":"<optional>"}}
// <- unconfigured, launch profile [LIVE]
{"provider_configured":false,"ready":true,"free_tier":false,"other_providers":false,"inference_provider":""}
// <- after ChatGPT sign-in [LIVE]
{"provider_configured":true,"ready":true,"free_tier":false,"other_providers":true,"inference_provider":"openai-codex"}
// <- named profile [LIVE]  (no other_providers / inference_provider for named profiles)
{"provider_configured":true,"ready":true,"free_tier":false,"profile":"murmur-test-models"}

// -> {"method":"setup.runtime_check","params":{"profile":"<optional>","provider":"<optional strict check>"}}
// <- unconfigured [LIVE]
{"ok":false,"error":"Hermes is not connected to any AI provider yet. Run `hermes model` to pick one (the free Nous tier needs no API key), type `/login` in chat, or add a key with `hermes auth add <provider>`. (Advanced: put an API key such as OPENROUTER_API_KEY in ~/./.env.)"}
// <- configured [LIVE]
{"ok":true,"provider":"openai-codex","model":"gpt-6.1-sol","source":"device_code","free_tier":false}
// <- model pinned to a provider whose key was removed [LIVE]
{"ok":false,"provider":"openrouter","model":"anthropic/claude-opus-4.6","source":"env/config","error":"No usable credentials found for openrouter.","profile":"murmur-test-models"}
// <- {provider:"openrouter"} strict single-provider check (no fallback chain) [LIVE]
{"ok":false,"provider":"openrouter","model":"gpt-6.1-sol","source":"env/config","error":"No usable credentials found for openrouter."}
// <- unknown profile [LIVE]  (never a JSON-RPC error)
{"ok":false,"profile":"no-such-profile","error":"Profile 'no-such-profile' does not exist on this backend."}
```

Other `source` values seen [LIVE]: `env:OPENROUTER_API_KEY`, `custom_provider:<Endpoint Name>`
(with `provider:"custom"`), `device_code`.

### 1.2 Murmur rule

`ready = (await rpc('setup.runtime_check', {profile})).ok === true`. If the call fails at the
transport level, fall back to `setup.status.provider_configured`. Show `error` as the reason.
Re-run the check after any credential or model change. Do **not** use the following REST signals
for readiness:

* `GET /api/model/info` reports the configured model even when no credential exists. Unconfigured,
  it returned `{"model":"anthropic/claude-opus-4.6","provider":"auto",…,"capabilities":{}}` [LIVE].
* `GET /api/status` has no model/provider readiness field. Its `auth_required` and `auth_providers`
  fields are about **dashboard login**, not LLM providers.
* `GET /api/model/options` lists only authenticated providers by default. When it is empty except
  for the virtual `moa` row, no provider is connected. This is a usable cheap REST hint
  (`providers.filter(p => p.slug !== 'moa').length === 0`), but `runtime_check` still wins.

The `setup.ready` event (`tui_gateway/contracts/events.py`) is pushed when the boot record flips.
Desktop re-checks when it arrives.

---

## 2. OAuth device flows (ChatGPT/Codex, Nous Portal, xAI-OAuth, MiniMax)

### 2.1 List / status: `GET /api/providers/oauth[?profile=]` [LIVE]

```jsonc
{"providers":[
  {"id":"nous","name":"Nous Portal","flow":"device_code","cli_command":"hermes auth add nous",
   "docs_url":"https://portal.nousresearch.com","disconnect_hint":null,"disconnect_command":null,"disconnectable":true,
   "status":{"logged_in":false,"source":"nous_portal","source_label":"Nous Portal","token_preview":"","expires_at":null,
             "has_refresh_token":false,"free_tier":false,"account_tier":null}},
  {"id":"openai-codex","name":"ChatGPT or Codex Subscription","flow":"device_code","cli_command":"hermes auth add openai-codex",
   "docs_url":"https://platform.openai.com/docs","disconnect_hint":null,"disconnect_command":null,"disconnectable":true,
   // before sign-in:
   "status":{"logged_in":false,"source":"openai_codex","source_label":"OpenAI Codex","token_preview":"","expires_at":null,"has_refresh_token":false,"last_refresh":null}
   // after sign-in [LIVE]:
   // "status":{"logged_in":true,"source":"pool:device_code","source_label":"chatgpt","token_preview":"…l4_EYA","expires_at":null,"has_refresh_token":false,"last_refresh":"2026-10-13T12:15:22.796377Z"}
  },
  {"id":"qwen-oauth","flow":"external", "disconnectable":false, "disconnect_hint":"Managed by that provider's CLI; remove it there.", …},
  {"id":"minimax-oauth","name":"MiniMax (OAuth)","flow":"device_code", …},
  {"id":"xai-oauth","name":"xAI Grok OAuth (SuperGrok / Premium+)","flow":"device_code", …},
  {"id":"copilot-acp","flow":"external", …,"status":{…,"configured":false}},
  {"id":"anthropic","name":"Anthropic API Key","flow":"external","disconnectable":true,"status":{"logged_in":false,"source":null}},
  {"id":"claude-code","flow":"external","disconnect_command":"rm -f ~/.claude/.credentials.json","disconnectable":false, …}
]}
```

Only `flow:"device_code"` rows can be started from the UI: `nous`, `openai-codex`, `minimax-oauth`,
`xai-oauth`. `anthropic` and `claude-code` are deliberately `external`, because Anthropic forbids
minting subscription tokens outside its client. Treat Anthropic as **API key only**. Hide
`qwen-oauth`, `copilot-acp` and `claude-code` in Murmur, since their CLIs are not in the container.
`?profile=<unknown>` → `404 {"detail":"Profile 'no-such-profile' does not exist."}` [LIVE].

### 2.2 Start: `POST /api/providers/oauth/{id}/start[?profile=]` (token required) [CODE]

```jsonc
// 200 (Codex: the server blocks up to 10 s until OpenAI returns the user code)
{"session_id":"aMhy74v3WpRdmdgr14PFuA","flow":"device_code","user_code":"ABCD-EFGH",
 "verification_url":"https://auth.openai.com/codex/device","expires_in":900,"poll_interval":5}
// Nous returns verification_uri_complete as verification_url; xAI likewise; MiniMax: poll_interval >= 2.
```

Errors:

| Case | Response |
|---|---|
| unknown id | `400 {"detail":"Unknown provider not-a-provider"}` [LIVE] |
| external provider | `400 {"detail":"anthropic uses an external CLI; run \`hermes auth add anthropic\` manually"}` [LIVE] |
| no token | `401 {"detail":"Unauthorized"}` [LIVE] |
| unknown `?profile=` | `404` [CODE] |
| **Codex: device-code login not enabled on the OpenAI account** | `500 {"detail":"OpenAI rejected the device-code login request. Your OpenAI account may need device-code authorization enabled before Hermes can start this dashboard login. Enable device-code authorization in OpenAI, then return here and click Login again. (HTTP 4xx: <openai detail>)"}` [CODE: `_codex_device_code_start_error`, chosen when the OpenAI error text contains "device" plus "authori"/"enable"] |
| Codex: any other OpenAI rejection | `500 {"detail":"OpenAI rejected the device-code login request. Please try Login again from the dashboard after checking your OpenAI account settings. (HTTP 4xx: …)"}` [CODE] |
| Codex: no user code within 10 s | `504 {"detail":"device-auth timed out before returning a user code"}` [CODE] |
| Nous over a free-tier identity that is already signed in | `400 {"detail":"<copy_terminal sentence>"}` [CODE] |
| other exception | `500 {"detail":"<str(e)>"}` [CODE] |

UX: show `user_code` large with a copy button, plus an "Open" button for `verification_url`
(`window.open`). On mobile, deep-linking to the URL works well.

### 2.3 Poll: `GET /api/providers/oauth/{id}/poll/{session_id}[?profile=]` (no token needed, read-only)

Polling every `poll_interval` seconds is safe; it does not consume anything. [CODE]

```jsonc
{"session_id":"…","status":"pending",   // pending | approved | denied | expired | error | cancelled (Nous)
 "error_message":null,"expires_at":1760360000.0,
 "reason":null,"account_email":null,"model":null,      // Nous free-tier extras
 "retryable":null,"retry_after":null}
// Codex expiry:  {"status":"expired","error_message":"Device code expired before approval",…}
// Codex failure: {"status":"error","error_message":"token exchange returned 400",…}
```

| Case | Response |
|---|---|
| unknown/GC'd session | `404 {"detail":"Session not found or expired"}` [LIVE] |
| wrong provider in path | `400 {"detail":"Provider mismatch for session"}` [CODE] |
| `?profile=` differs from the one used at start | `400 {"detail":"OAuth session profile mismatch"}` [CODE] |

**Pass the same `profile` query value to start, poll and cancel.** Omitting it means "launch
profile". Sessions are in-memory, expire after 15 minutes, and are lost on a dashboard restart, so
treat a 404 as "expired, start again". On `approved` the server has **already saved the tokens**.
Also stop polling locally once `expires_in` has elapsed.

### 2.4 Cancel: `DELETE /api/providers/oauth/sessions/{session_id}[?profile=]` (token required)

* `200 {"ok":true,"session_id":"…"}` [CODE]
* unknown session: `200 {"ok":false,"message":"session not found"}` [LIVE]
* profile mismatch: `400` [CODE]

The Codex worker re-checks for cancellation under a lock before saving tokens, so no tokens are
persisted after a successful cancel.

### 2.5 After `approved` (what Desktop does, `store/onboarding.ts::completeWithModelConfirm`)

1. Launch profile only: call the JSON-RPC `reload.env`. Skip it for named profiles.
2. `GET /api/model/options?include_unconfigured=true&profile=…` and find the row whose `slug` is the
   provider. **Slug mapping: OAuth id `openai-codex` = options slug `openai-codex`; `nous` = `nous`;
   `xai-oauth` = `xai-oauth`.**
3. If the current `model`/`provider` already belong to that row (a re-login), keep them. Otherwise
   call `GET /api/model/recommended-default?provider=<slug>&profile=…`. Live examples:
   `{"provider":"openai-codex","model":"gpt-6.1-sol","free_tier":null}`, and for Nous
   `{"provider":"nous","model":"z-ai/glm-5.2","free_tier":false}`. Fall back to `models[0]` when
   `model` is `""`.
4. `POST /api/model/set {"scope":"main","provider":"openai-codex","model":"gpt-6.1-sol","profile":"…"}`.
   The lead did this live; it returned `ok`.
5. `setup.runtime_check {profile, provider:"openai-codex"}` must return `ok:true`. Then show a
   "You're on GPT-6.1 Sol: change?" confirm card.

Live post-sign-in state on `default` [LIVE]: `model/options` → `openai-codex` row, 13 models,
`is_current:true`. `runtime_check` → `{"ok":true,"provider":"openai-codex","model":"gpt-6.1-sol","source":"device_code"}`.
`custom-endpoints.current.base_url` = `https://chatgpt.com/backend-api/codex`.

### 2.6 Disconnect: `DELETE /api/providers/oauth/{id}[?profile=]` (token required) [CODE + LIVE errors]

* success: `200 {"ok":true,"provider":"openai-codex"}`. `ok:false` means nothing was stored.
* `400 {"detail":"Unknown provider: x. Available: anthropic, claude-code, copilot-acp, minimax-oauth, nous, openai-codex, qwen-oauth, xai-oauth"}` [LIVE]
* `400 {"detail":"<Name> cannot be disconnected automatically. <hint>"}` for external providers, and for
  Anthropic when its key comes from `.env`, in which case delete the env key instead [LIVE].

Not exercised live, to avoid logging out the user's ChatGPT. **Caveat:** profiles inherit the
default root's grant read-only, so disconnecting Codex on a named profile does not remove the
default's grant. Disconnect on the launch profile instead (omit `profile`).

---

## 3. API keys (OpenRouter, OpenAI, Anthropic, Gemini, xAI, …)

### 3.1 Which env var

From `PROVIDER_REGISTRY` [LIVE] and `/api/model/options?include_unconfigured=true` `key_env`:

| UI provider | options `slug` (for `/api/model/set`) | env var to PUT | live probe in `/api/providers/validate` |
|---|---|---|---|
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | yes (`openrouter.ai/api/v1/key`) |
| OpenAI | `openai-api` | `OPENAI_API_KEY` | yes (`/v1/models`) |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` (also accepted: `ANTHROPIC_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`) | **no**: always `{"ok":true,"reachable":false}` |
| Google Gemini | `gemini` | `GEMINI_API_KEY` (registry also accepts `GOOGLE_API_KEY`, which options show as `key_env`). **Use `GEMINI_API_KEY`**, the only one with a validate probe, and what Desktop uses | yes |
| xAI | `xai` | `XAI_API_KEY` | yes |
| Fireworks / DeepSeek / Ollama Cloud / LM Studio | `fireworks` / `deepseek` / `ollama-cloud` / `lmstudio` | `FIREWORKS_API_KEY` / `DEEPSEEK_API_KEY` / `OLLAMA_API_KEY` / `LM_API_KEY` | no |

`openrouter` is not in `PROVIDER_REGISTRY`; it is handled specially, and its options row has
`key_env:""`. Hard-code `OPENROUTER_API_KEY`. The generic rule for the long tail: rows with
`auth_type:"api_key"` and a non-empty `key_env`.

### 3.2 Validate: `POST /api/providers/validate` (token required; no profile; pure probe)

Request: `{"key":"OPENROUTER_API_KEY","value":"sk-or-v1-…"}`. Responses [LIVE]:

```jsonc
{"ok":false,"reachable":true,"message":"That API key was rejected. Double-check it and try again."}  // OpenRouter/OpenAI 401
{"ok":false,"reachable":true,"message":"Provider returned HTTP 400 for this key."}                   // Gemini/xAI bogus key
{"ok":true,"reachable":false,"message":""}                                                          // no probe (Anthropic etc.)
{"ok":false,"reachable":true,"message":"Enter a value first."}                                      // empty value
{"ok":false,"reachable":false,"message":"Could not reach the provider to verify the key."}          // network [CODE]
{"ok":true,"reachable":true,"message":""}                                                           // valid, or 429 [CODE]
```

Rule: block when `!ok && reachable`. When `!reachable`, save with a soft warning.

### 3.3 Save: `PUT /api/env` (writes the profile's `.env` and rotates config mirrors)

Request: `{"key":"OPENROUTER_API_KEY","value":"sk-or-v1-…","profile":"murmur-test-models"}`.
`profile` can go in the body or as `?profile=`, and the body wins.

* → `200 {"ok":true,"key":"OPENROUTER_API_KEY","config_updates":[]}` [LIVE]
* Sending back a redacted preview → `400 {"detail":"Refusing to save a redacted credential preview; re-enter the full secret to replace it."}` [LIVE]

Once saved, `GET /api/model/options?profile=…` immediately lists the provider as authenticated, for
example an `openrouter` row with 63 models and `source:"built-in"` [LIVE]. No restart is needed.

### 3.4 Then pick the model

* `GET /api/model/recommended-default?provider=openrouter&profile=…` → `{"provider":"openrouter","model":"z-ai/glm-5.2","free_tier":null}` [LIVE].
  On profiles without that provider's key it returns `model:""`.
* `POST /api/model/set {"scope":"main","provider":"openrouter","model":"z-ai/glm-5.2","profile":"…"}` [LIVE]:

```jsonc
{"ok":true,"scope":"main","provider":"openrouter","model":"z-ai/glm-5.2","base_url":"https://openrouter.ai/api/v1","gateway_tools":[],"stale_aux":[]}
```

Errors [LIVE]:

* `400 {"detail":"Model `no-such/model-xyz` was not found in this provider's model listing."}`
* `400 {"detail":"scope must be 'main' or 'auxiliary'"}`
* missing provider/model → `400 "provider and model required for main"` [CODE]

**Expensive-model guard** [CODE; it did not trigger live with a fake key]. This is a `200` response:

```json
{"ok":false,"scope":"main","provider":"…","model":"…","confirm_required":true,"confirm_message":"…"}
```

Show the message, then resend with `"confirm_expensive_model":true`. Always check `ok` and not just
the HTTP status.

Desktop's API-key path: validate → `PUT /api/env` → `reload.env` (launch profile only) → the
§2.5 steps 2–5. Desktop ignores a failing runtime gate on this path.

### 3.5 Remove a key: `DELETE /api/env` (JSON body)

Request: `{"key":"OPENROUTER_API_KEY","profile":"…"}`.

* → `200 {"ok":true,"key":"OPENROUTER_API_KEY","removed":true,"pool_pruned":["openrouter"],"providers":["openrouter"],"config_scrubbed":[],"found":true}` [LIVE]
* Again → `404 {"detail":"OPENROUTER_API_KEY not found in .env"}` [LIVE]

**Gotcha:** removing the key does **not** move `model.provider`. `runtime_check` then fails with
"No usable credentials found for openrouter." [LIVE]. After disconnecting the active provider,
re-pick a model from a remaining provider, or send the user back to onboarding.

### 3.6 JSON-RPC twins (avoid for now)

`model.save_key {slug, api_key}` and `model.disconnect {slug}` exist, but in this build their
param schema **rejects `profile`**:

```
4000 "invalid params for model.save_key: profile: Extra inputs are not permitted …"
```

[LIVE]. That makes them launch-profile-only. Use REST.

---

## 4. Local / custom OpenAI-compatible endpoints (Ollama, LocalAI, LM Studio, vLLM)

### 4.1 Validate

**Quick connectivity, which also lists models:**

`POST /api/providers/validate {"key":"OPENAI_BASE_URL","value":"<url>","api_key":"<optional>"}` [LIVE, against a fake server]

```jsonc
{"ok":true,"reachable":true,"message":"","models":["murmur-fake-small","murmur-fake-large"],
 "model_details":[{"id":"murmur-fake-small"},{"id":"murmur-fake-large"}],"resolved_base_url":"http://host.docker.internal:18990/v1"}
{"ok":false,"reachable":true,"message":"http://host.docker.internal:18990/v1/models answered HTTP 401.","models":[]}   // auth-gated, no key
{"ok":false,"reachable":false,"message":"Could not reach http://host.docker.internal:1/v1/models."}
```

A bare host root (no `/v1`) is auto-resolved: the server tries `{url}/models`, then `{url}/v1/models`.
**Persist `resolved_base_url`, not what the user typed.**

**Full check, which also probes the chat route:**

`POST /api/providers/custom-endpoints/validate {"name":"x","base_url":"…","model":"","api_key":"…","api_mode":""}` [LIVE]

```jsonc
{"ok":true,"reachable":true,"message":"","models":[…],"model_details":[…],"transport_checked":"chat_completions","resolved_base_url":"http://host.docker.internal:18990/v1"}
{"ok":false,"reachable":true,"message":"The endpoint rejected the API key.","models":[]}
{"ok":false,"reachable":false,"message":"Could not reach http://host.docker.internal:1/v1/models.","models":[]}
// [CODE] /models OK but chat route 404/405/501:
{"ok":false,…,"message":"<url>/models answered, but POST /chat/completions returned HTTP 404: this host does not serve the Chat Completions API. Pick the API mode it does serve."}
```

### 4.2 Create / update: `POST /api/providers/custom-endpoints?profile=…` [LIVE]

```jsonc
// request
{"name":"Murmur Fake Local","base_url":"http://host.docker.internal:18990/v1","model":"murmur-fake-small",
 "api_key":"sk-…",               // optional; stored in .env as HERMES_CUSTOM_<ID>_API_KEY; "" clears it; omit to keep
 "api_mode":"",                   // "" auto | chat_completions | codex_responses | anthropic_messages
 "models":["murmur-fake-small","murmur-fake-large"], // from validate; else only `model` is saved
 "discover_models":true, "make_default":false, "context_length":null, "id":""}  // id = existing id to edit
// response
{"endpoints":[{"id":"murmur-fake-local","name":"Murmur Fake Local","base_url":"http://host.docker.internal:18990/v1",
   "model":"murmur-fake-small","models":["murmur-fake-small","murmur-fake-large"],"api_mode":"","context_length":null,
   "discover_models":true,"has_api_key":true,"api_key_preview":"${HERMES_CUSTOM_MURMUR_FAKE_LOCAL_API_KEY}",
   "is_current":false,"source":"providers"}],
 "current":{"provider":"openai-codex","model":"gpt-6.1-sol","base_url":"https://chatgpt.com/backend-api/codex"},
 "ok":true,"id":"murmur-fake-local"}
```

The id is the slugged name. Errors: `400 "name required" | "base_url required" | "base_url must include scheme and host" | "model required"` [LIVE for model].

### 4.3 Other operations

**List.** `GET /api/providers/custom-endpoints?profile=…` returns the same `{endpoints, current}` shape [LIVE].

**Activate**, which sets the endpoint as the profile's main model:

* `POST /api/providers/custom-endpoints/{id}/activate?profile=…` → `{"ok":true,"provider":"murmur-fake-local","model":"murmur-fake-small"}` [LIVE]
* unknown → `404 {"detail":"custom endpoint not found"}` [LIVE]
* Alternatively, pass `make_default:true` on create.

**Switch model within the endpoint.**

```
POST /api/model/set {"scope":"main","provider":"murmur-fake-local","model":"murmur-fake-large","profile":"…"}
→ {"ok":true,"scope":"main","provider":"murmur-fake-local","model":"murmur-fake-large","base_url":"http://host.docker.internal:18990/v1","gateway_tools":[],"stale_aux":[]}
```

[LIVE]. `recommended-default?provider=murmur-fake-local` → `{"provider":"murmur-fake-local","model":"murmur-fake-small","free_tier":null}` [LIVE].

**In `/api/model/options`** the endpoint appears as [LIVE]:

```json
{"slug":"murmur-fake-local","name":"Murmur Fake Local","is_current":true,"is_user_defined":true,"models":[…],"total_models":2,
 "source":"user-config","api_url":"http://host.docker.internal:18990/v1","native_catalog_empty":false,"authenticated":true,
 "capabilities":{"murmur-fake-small":{"fast":false,"reasoning":true},…},"featured_models":[],
 "aliases":["custom:murmur-fake-local","murmur fake local","murmur-fake-local"]}
```

`session.info.provider` reports it as `custom:murmur-fake-local`. **Match rows by `aliases`
membership, not by `slug` equality.** `runtime_check` → `{"ok":true,"provider":"custom","model":"murmur-fake-large","source":"custom_provider:Murmur Fake Local"}` [LIVE].

**End to end.** A real chat turn streamed `"pong from murmur-fake-large"` through the fake server [LIVE] (see §6.4).

**Delete.**

* `DELETE /api/providers/custom-endpoints/{id}?profile=…` → `{"endpoints":[],"current":{"provider":"","model":"murmur-fake-large","base_url":""},"ok":true}` [LIVE]
* again → `404 {"detail":"custom endpoint not found"}` [LIVE]

Deleting the **active** endpoint clears `model.provider`, `base_url` and the key. The profile is then
left with `provider:""` (auto), so re-pick a model afterwards. The `.env` key is removed [LIVE].

### 4.4 Umbrel presets

| App | base_url to save | key |
|---|---|---|
| Ollama | `http://ollama_ollama_1:11434/v1` (OpenAI-compatible API) | none; send nothing |
| LocalAI | `http://localai_api_1:8080/v1` | none unless the user configured one |

* Hermes classifies unqualified container hostnames (`ollama_ollama_1`) as **local endpoints**. That
  means no HTTP proxy, longer timeouts, and `/api/local-models` stays irrelevant.
* Behind any custom endpoint, Hermes probes `GET /api/tags` to detect Ollama and then calls
  `POST /api/show` for context length and vision [LIVE: both seen in the fake server log].
* **Unverified:** whether the Hermes container can resolve `ollama_ollama_1` and `localai_api_1` on
  umbrelOS. That requires the Hermes app to join those apps' Docker network. The Hermes-side
  validate call answers the question for us: `reachable:false` means not resolvable or not running.

**Probing Ollama ourselves** (Murmur proxy, server-side, for a nicer "pick a model" UI before saving):

```
GET http://ollama_ollama_1:11434/api/tags
→ {"models":[{"name":"llama3.2:3b","model":"llama3.2:3b","modified_at":"…","size":2019393189,"digest":"…",
             "details":{"family":"llama","parameter_size":"3.2B","quantization_level":"Q4_K_M"}}]}
```

Use `name` as the model id, and `details.parameter_size` / `size` for display. An empty `models`
means the app is installed but no model has been pulled; deep-link to the Ollama app. LocalAI:
`GET http://localai_api_1:8080/v1/models` (OpenAI shape `{data:[{id}]}`). In practice, the simplest
correct path is `POST /api/providers/validate {key:"OPENAI_BASE_URL", value:"http://ollama_ollama_1:11434/v1"}`,
since Hermes then probes from its own network namespace.

Recommended flow: validate (`OPENAI_BASE_URL`) → user picks from `models` →
`POST custom-endpoints {name:"Ollama", base_url: resolved_base_url, model, models, make_default:true}` →
`runtime_check`.

---

## 5. Model picker, per-agent vs per-chat, connected providers

### 5.1 `GET /api/model/options?profile=&include_unconfigured=&refresh=&explicit_only=` [LIVE]

```jsonc
{"model":"gpt-6.1-sol","provider":"openai-codex",          // profile's current main model
 "providers":[
  {"slug":"openai-codex","name":"ChatGPT or Codex Subscription","is_current":true,"is_user_defined":false,
   "models":["gpt-6.1-sol","gpt-6-astra",…],"total_models":13,"source":"hermes","authenticated":true,
   "capabilities":{"gpt-6.1-sol":{"fast":true,"reasoning":true},…},
   "featured_models":[]},                                   // non-empty only for multi-lab aggregators (OpenRouter: newest 5 per lab)
  {"slug":"openrouter",…,"source":"built-in","capabilities":{"anthropic/claude-opus-5":{"fast":true,"reasoning":true,"can_disable_reasoning":true},…},
   "featured_models":["anthropic/claude-fable-5.1",…,"openai/gpt-6-sol",…]},
  {"slug":"moa","name":"Mixture of Agents","source":"virtual","auth_type":"virtual","models":["default"],…}  // hide in Murmur
 ]}
```

* `include_unconfigured=true` adds about 50 catalog rows with `authenticated:false`, `models:[]`,
  `auth_type` (`api_key | oauth_device_code | oauth_external | oauth_minimax | external_process | aws_sdk | vertex | virtual`),
  `key_env` and `warning` (for example `"paste ANTHROPIC_API_KEY to activate"`). Use these rows for
  an "Add provider" list.
* `refresh=true` busts the 1-hour model-id cache. Lists can differ per profile because the cache is
  per profile: default showed 13 Codex models including `gpt-6-astra`, while a fresh profile showed
  16 without it [LIVE].
* It can return `503 {"detail":"Restart required: …"}` after a code update.
* Model search: Desktop uses `apps/shared/src/model-search-text.ts`. A plain substring match on
  id + provider name is fine for us.

### 5.2 `GET /api/model/info?profile=` [LIVE]

```json
{"model":"gpt-6.1-sol","provider":"openai-codex","auto_context_length":1050000,"config_context_length":0,
 "effective_context_length":1050000,"capabilities":{"supports_tools":true,"supports_vision":true,"supports_reasoning":true,
 "context_window":1050000,"max_output_tokens":128000,"model_family":"gpt-sol"}}
```

`capabilities` comes from models.dev and is `{}` for unknown or custom models [LIVE]. An unknown
profile gives `404`.

### 5.3 Per agent (profile) default model

Either form works [LIVE]; both validate the pick:

* `POST /api/model/set {"scope":"main","provider","model","profile":"<agent>"}`, also accepted as `?profile=`
* `PUT /api/profiles/{name}/model {"provider","model"}` → `{"ok":true,"provider":"openai-codex","model":"gpt-6.1-sol"}`. Missing fields → `400 {"detail":"provider and model are required"}`.
* At creation: `POST /api/profiles {"name","provider","model",…}` → response `model_set`, `model_error`.

### 5.4 Per chat (session)

* **New chat:** `session.create {"profile":P,"model":"murmur-fake-small","provider":"murmur-fake-local","reasoning_effort":"low"}`.
  The overrides are session-only, and `session.info` confirms them [LIVE]. Always send model **and**
  provider as a pair.
* **Live chat:** `config.set {"session_id":S,"profile":P,"key":"model","value":"gpt-5.5 --provider openai-codex --session"}` →
  `{"key":"model","value":"gpt-5.5","warning":"Note: `gpt-5.5` was not found in the OpenAI Codex model listing…","confirm_required":false,"confirm_message":"","scope":"session"}` [LIVE].
  * Always append ` --session`. Without it, the primary profile may persist the pick
    (`model.persist_switch_by_default`, or a first-ever pick).
  * On `confirm_required:true`, resend with `confirm_expensive_model:true`.
  * Mid-turn switches come back `deferred` and apply at the next turn.
  * Without `session_id`: `4001 "config.set model requires a live session; …"` [LIVE].
  * **Unverified:** on a lazy session (agent not yet built), the next `session.info` still showed the
    old model. Rely on the `session.info` event after the first turn.

### 5.5 Connected providers (Settings screen) and disconnect

Build the list from four sources:

1. `GET /api/model/options?profile=P`: rows with `authenticated:true`, excluding `moa`. This is the
   truth for "usable".
2. `GET /api/providers/oauth?profile=P`: `status.logged_in`, `source_label` and `token_preview` for
   OAuth rows.
3. `GET /api/env?profile=P`: keys with `is_set:true` and `category:"provider"` (fields `provider`,
   `provider_label`, `redacted_value`), for API-key rows.
4. `GET /api/providers/custom-endpoints?profile=P`: local endpoints.

Disconnect by row type:

| Row type | Request |
|---|---|
| OAuth | `DELETE /api/providers/oauth/{id}` (§2.6) |
| API key | `DELETE /api/env {key, profile}` (§3.5) |
| Endpoint | `DELETE /api/providers/custom-endpoints/{id}` (§4.3) |

If the disconnected provider was current, re-pick a model with `/api/model/set`.

---

## 6. Reasoning effort ("thinking")

### 6.1 Vocabulary

* Hermes levels: `minimal, low, medium, high, xhigh, max, ultra`, plus `none` (thinking off).
* Default when unset: `medium`.
* `ultra` is Hermes-internal and every route clamps it, usually to `max`.

Ladder: `none < minimal < low < medium < high < xhigh < max < ultra`. The server clamps unsupported
levels **down** to the nearest supported one, or up to the provider's floor if nothing lower exists.
It never escalates cost. Clamping happens server-side at the wire; the client never needs to clamp.

Per-route sets, from `agent/reasoning_effort.py` and computed live:

| Route | Accepted | Clamp results |
|---|---|---|
| OpenAI-compatible (OpenRouter, Nous, custom) | `none minimal low medium high xhigh max` | `ultra→max` |
| Codex `gpt-6-sol*`, `gpt-6-luna*`, `gpt-5.6-*` | `none low medium high xhigh max` | `minimal→low`, `ultra→max` |
| Codex `gpt-6-astra*` | `low medium high xhigh max` | no disable |
| Codex legacy, **including `gpt-6.1-sol`** | `none low medium high xhigh` | `max→xhigh`, `ultra→xhigh` [LIVE: `reasoning_effort:"max"`, `reasoning_effort_wire:"xhigh"`] |

The `gpt-6.1-sol` behaviour looks like a Hermes table gap (the prefix list only has `gpt-6-sol`).
Display it honestly using `reasoning_effort_wire`.

Downstream narrower sets also apply, for example Kimi K3 `low/high/max`, GLM-5.2 `high/max`,
DeepSeek V4 `low/medium/high/max`, xAI `low…xhigh`.

### 6.2 Does the current model support reasoning?

* Primary: `model/options` → `providers[i].capabilities[model].reasoning`. It defaults to `true` when
  the catalog is silent; custom endpoints showed `true` [LIVE].
* `capabilities[model].can_disable_reasoning`, when present (OpenRouter and Nous rows only):
  `false` means hide "Off".
* Secondary: `/api/model/info.capabilities.supports_reasoning`, from models.dev; `{}` for custom.
* The exact supported levels per model are **not exposed** by the API. `supported_efforts` is
  deliberately stripped. After a pick, `session.info.reasoning_effort_wire` tells you what is
  actually sent.

### 6.3 Setting it

| Scope | How | Verified |
|---|---|---|
| Per agent (profile default) | RPC `config.set {"profile":P,"key":"reasoning","value":"high","scope":"global"}` → `{"key":"reasoning","value":"high"}`; writes `agent.reasoning_effort` in P's config.yaml | [LIVE] |
| Read | `config.get {"profile":P,"key":"reasoning"[, "session_id":S]}` → `{"value":"high","display":"show"}` (session pin wins when `session_id` is given) | [LIVE] |
| Per agent (REST alternative) | `PUT /api/config?profile=P` with `agent.reasoning_effort` | **unverified**: neither read nor tested; prefer the RPC |
| New chat | `session.create {…,"reasoning_effort":"low"}`; omit to inherit the profile default | [LIVE: wire `reasoning_effort:"low"`] |
| Live chat | `config.set {"session_id":S,"profile":P,"key":"reasoning","value":"max"}`. Session-only: profile default unchanged; emits `session.info` with `reasoning_effort` / `reasoning_effort_wire` | [LIVE] |
| Thinking off | value `"none"` → wire `reasoning_effort:"none"` | [LIVE] |
| Auxiliary tasks | `POST /api/model/set {"scope":"auxiliary","task":"…","reasoning_effort":"low"}` (`null` clears) | [CODE] |

Errors [LIVE]:

* `4002 "unknown reasoning value: hgih"`
* stale `session_id` → `4001 "session not found"`

`value` of `show`, `hide`, `full` or `clamp` changes **display** of thinking, not effort. With no
session and no `scope`, `config.set reasoning` writes the profile default. There is no "unset"
for a live session: to go back to Auto, set the profile's current default value.

### 6.4 End-to-end wire proof (fake endpoint, test profile) [LIVE]

| Step | Wire `reasoning_effort` |
|---|---|
| profile default `high`, `session.create` with `reasoning_effort:"low"` | `"low"` |
| `config.set reasoning max` (session) | `"max"` |
| `ultra` | `"max"` (`session.info`: `reasoning_effort:"ultra"`, `reasoning_effort_wire:"max"`) |
| `none` | `"none"` |
| new session with no override | `"high"` (profile default) |

Hermes' background title generation sends `reasoning_effort:"none"` with `response_format` json_schema.

### 6.5 Proposed Murmur mapping

| Murmur | Hermes value | Notes |
|---|---|---|
| **Auto** | *omit* (`session.create` without `reasoning_effort`; profile default, normally `medium`) | For a live chat that was changed, set it back to `config.get reasoning {profile}` → `value`. |
| **Quick** | `low` | Not `minimal`, which Codex clamps to `low` anyway. Not `none`, because many models cannot disable thinking. Optionally expose **Off** = `none` when `can_disable_reasoning !== false` and the model is not Astra. |
| **Deep** | `high` | Accepted verbatim on every route. |
| **Max** | `max` | Clamps to `xhigh` on legacy Codex, including today's `gpt-6.1-sol`. Show "Max (sends xhigh)" from `reasoning_effort_wire`. Avoid `ultra`: it is just `max` plus a label. |

Hide the control when `capabilities[model].reasoning === false`.

---

## 7. Recommended Murmur onboarding sequence

1. On boot: `setup.runtime_check {profile}`. If `ok`, go to chat. Otherwise show onboarding, with
   `GET /api/providers/oauth` for the ChatGPT and Nous states.
2. **ChatGPT:** `POST /api/providers/oauth/openai-codex/start` → show code and link → poll every
   `poll_interval` → `approved` → §2.5. On `500` containing "device-code authorization", show a
   help card: "Enable device code login in ChatGPT settings → Security".
3. **Local model:** server-side probe of Ollama (`/api/tags`) and LocalAI (`/v1/models`) → §4.4 flow.
4. **API key:** pick a provider → validate → `PUT /api/env` → recommended-default → `/api/model/set`
   (handle `confirm_required`) → runtime_check.
5. Confirm card: model name plus "Change" (picker from `/api/model/options`) plus a thinking
   selector. Write the default to the profile with `config.set reasoning scope=global`.

## 8. Blockers / open questions

* **Unverified:** Umbrel network reachability from the Hermes container to `ollama_ollama_1` and
  `localai_api_1`.
* **Unverified live:** OAuth start/poll/cancel success shapes, the Codex "device-code not enabled"
  error, OAuth disconnect, and the expensive-model confirm. All come from source at the tag.
* `model.save_key` and `model.disconnect` RPCs reject `profile` in this build; use REST.
* `gpt-6.1-sol` (the Codex recommended default) clamps `max→xhigh` according to Hermes' own table.
* Profiles inherit the default's OAuth grants but not its API keys. Decide whether Murmur copies keys
  into new agents (`PUT /api/env` per profile) or tells the user.

## 9. Scripts (`docs/hermes/scripts/`)

| Script | What it does | Writes? |
|---|---|---|
| `models-lib.mjs` | REST + `/api/ws` JSON-RPC helpers | none |
| `models-readiness.mjs [profile]` | `setup.status`, `runtime_check`, `model/info`, options summary | read-only |
| `models-options.mjs [profile]` | full options, recommended-defaults, oauth, endpoints, env | read-only |
| `models-oauth-shapes.mjs` | OAuth error shapes without starting a real flow | read-only |
| `models-profile-setup.mjs` | creates `murmur-test-models` and prints its readiness | creates profile |
| `models-apikey-flow.mjs` | fake-key validate → env → set → remove → restore | test profile only |
| `models-fake-openai-server.mjs` | fake OpenAI/Ollama server, logs wire bodies (`PORT=18990 REQUIRE_KEY=sk-murmur-test`) | — |
| `models-custom-endpoint-flow.mjs [--keep]` | validate → create → activate → set → delete | test profile only |
| `models-reasoning-flow.mjs` | global vs session effort, wire capture (`FAKE_LOG=…`) | test profile only |
| `models-session-model-switch.mjs` | per-session model switch, clamp display | test profile only |

Cleanup done:

* `murmur-test-models` deleted.
* Its sessions deleted.
* The fake server stopped.
* The `default` profile was never written; it is still `openai-codex / gpt-6.1-sol` as the lead set it.
