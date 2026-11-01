# Hermes voice: what calls rely on

Target: **Hermes 0.22.5** (`ghcr.io/getumbrel/hermes-agent-umbrel:v0.22.5-2`, the first with local voice models; the speech engines and the `murmur-voice` plugin's ChatGPT routes came in `v0.22.0-5`). `test/contract/voice.contract.ts` and `test/contract/local-voice.contract.ts` check the parts below against that image. Calls (`src/features/talk/`) use Hermes's own voice API through the usual `/hermes` proxy (and, on a ChatGPT plan, the image's plugin), and keep nothing of their own except the call in progress.

## A spoken turn

1. **Listening is in the browser.** One microphone stream per call (`getUserMedia` with echo cancellation) is read as raw samples by an AudioWorklet (`mic.ts`). A level detector that learns the room's noise floor decides when you start and stop. A turn is cut with 400ms of lead-in and sent as a 16 kHz mono WAV once 750ms of quiet ends it. While the agent speaks, the bar for an interruption is higher (5× the floor, 320ms sustained), so its own voice doesn't cut it off.
2. **`POST /api/audio/transcribe?profile=`** with `{data_url, mime_type: 'audio/wav'}` returns `{ok, transcript, provider}`. An empty transcript (a cough, the TV) is a normal answer: keep listening. With no engine, it's a 400 whose `detail` says "No STT provider available…".
3. **`prompt.submit`** with `voice_turn: true`, `surface: 'voice-live'`, `voice_context` (the last few exchanges, model input only) and `interrupted` (you cut the last answer off). `voice_turn` runs the turn on `auxiliary.voice_chat`, which by default is the agent's own model with reasoning off. The voice-live surface adds Hermes's own note asking for short, speakable prose. The saved user row is exactly what you said, so the chat afterwards is an ordinary chat.
4. **The reply streams as usual** (`message.delta`, `tool.start`, `message.complete`). Murmur cuts finished sentences off the front as they arrive (`Sentences` in `voice.ts`, which skips `MEDIA:` lines, `::preview` widgets, code and tables). Each sentence is sent to **`POST /api/audio/speak?profile=`** `{text}` → `{data_url}` while the one before it plays. Captions light up on the audio element's own clock.
   - **On the Umbrel's own voices** (below) a sentence goes to **`WS /api/audio/speak-stream?profile=`** instead (`stream-voice.ts`): `{text, done: true}` out; `{type: 'start', sample_rate}`, raw 16-bit mono PCM and `{type: 'end'}` back. Pocket TTS starts in about 0.15 s, where a whole clip took 2–3 s before anything played. Sentences play back to back on the call's one AudioContext, each once the one before has all arrived. `{type: 'fallback'}`, or a socket that closes with no audio, fetches that sentence whole. Captions start on an estimate of the sentence's length and are re-timed once all its audio is in, which is early, since it's made faster than it's said.
5. **The stage** takes the images from `tool.complete` media, what the agent's Umbrel tools turned up (photos, files, apps, its health: see apps-messaging-insights.md §7), and the `MEDIA:` and `::preview` segments of the reply. It renders them with the thread's own cards (`MediaBlock`, `PreviewFrame`, `features/umbrel/cards.tsx`), except photos: `stage-photos.tsx` measures each picture and lays them out whole at their own shapes (`photo-layout.ts`), filling the room down to the call's buttons and easing up when there are captions to read. The first line of `voice_context` tells the agent the call has a screen, since Hermes's live-voice note alone asks for spoken sentences only.
6. **Interrupting** stops playback and calls `session.interrupt` if the reply is still being written. The next `prompt.submit` carries `interrupted: true`.

**`POST /api/audio/stt-lease` and `/tts-lease`** `{lease, active}` warm the engines when a call starts and release them when it ends. A warm-up failure comes back in the body, never as an HTTP error.

## Voice settings (`voice-setup.ts`)

These are per agent (`?profile=`) and live in Hermes. Murmur doesn't copy them.

- **`GET /api/tools/toolsets/{stt|tts}/config`** lists every engine as `{name, status: ready | needs_keys | needs_auth, is_active, tts_provider?, env_vars: [{key, is_set}]}` plus `active_provider`. Murmur calls a voice ready when both active engines are `ready`. The TTS engine must also not be Edge, the stock default. On our image Edge is reported `ready` but has to install itself on first use, which only takes effect after a restart, and then Microsoft's endpoint answered 403. OpenAI voices also count as ready when `OPENAI_API_KEY` (the models key) is set, which the matrix doesn't consider.
- **`PUT /api/tools/toolsets/{stt|tts}/provider`** `{provider: <name>}` switches. Murmur's three pairs:

  | Choice | STT | TTS | Key |
  |---|---|---|---|
  | On your Umbrel | `Local Whisper` | `Piper` | none |
  | Your ChatGPT plan | (OpenAI's live voice, below) | | a ChatGPT sign-in |
  | OpenAI | (OpenAI's live voice, below), with `OpenAI` and `OpenAI TTS` for dictation and Read aloud | | `VOICE_TOOLS_OPENAI_KEY` (or `OPENAI_API_KEY`) |
  | ElevenLabs | `ElevenLabs Scribe` | `ElevenLabs` | `ELEVENLABS_API_KEY` |

- **`PUT /api/env?profile=`** `{key, value}` saves a key.
- **`PUT /api/config?profile=`** deep-merges. Murmur sets `stt.language`, `stt.local.model` (`base.en` for English, `base` otherwise) and `tts.piper.voice` (a voice name from `rhasspy/piper-voices`, which Hermes downloads the first time it speaks). Saving drops values equal to the defaults, so read the effective config, not `include_defaults=false`.

- **Which voice a call uses** is `voice.murmur.engine` in the agent's config: `chatgpt`, `openai`, or `hermes` for its own voice settings. Hermes keeps the key and ignores it. `voice.murmur.auto: true` means Murmur picked it (below), not the person.

## No setup: the voice Murmur picks by itself (`pickVoice`)

An agent nobody has chosen a voice for (`voice.murmur.engine` unset), or one Murmur chose for (`auto`), starts a call on the first tap, with the best this Hermes can already talk with:

1. a voice someone set up in Hermes itself, left exactly as it is (an unset agent whose own settings already work);
2. its ChatGPT plan (`GET /api/plugins/murmur-voice/chatgpt` says `available`), or its OpenAI key (`VOICE_TOOLS_OPENAI_KEY` or `OPENAI_API_KEY`). With both, the one the agent's own model runs on (`openai-codex` or `openai`);
3. its own machine, if that can talk: through the plugin, or Hermes's own Whisper and Piper when the matrix says both are `ready` (a stock Hermes reports `needs_setup`). If it can't, an ElevenLabs key.

The call opens on the tap, because the tap is what lets it make sound, even if Hermes hasn't said yet how the agent talks (`/api/env` takes about 3 s just after Hermes starts). The choice is saved (with `auto: true`) while the call connects, and the call warms its engines once it's saved. If a live voice doesn't pick up (an expired sign-in, a key OpenAI turns away), the call carries on with the next one in the list, and that's saved instead. Murmur never picks something that isn't set up: with nothing that can talk, it opens the voice sheet and changes nothing. The sheet is for changing the voice later: in Settings › Voice, and from the call.

## On the Umbrel (`local-voice.ts`, the image's `murmur-voice` plugin)

Hermes downloads and runs the models. The plugin (`umbrel-context/plugins/murmur-voice` in getumbrel/hermes-agent-umbrel) adds a `murmur` text-to-speech and a `murmur` speech-to-text provider through Hermes's plugin API, with no patches. Each language has one pair of models, the same on every box. The providers use it once it's downloaded, and Hermes's own Piper and Whisper (in the image) until then, so an agent talks from the first moment and moves over by itself, mid-call, when a download finishes.

| Language | Speaks | Hears | Download (x86_64) |
|---|---|---|---|
| English | Pocket TTS 18M (Kyutai) | X-ASR zh-en | about 550 MB |
| Chinese | Matcha zh-en | X-ASR zh-en | about 325 MB |
| Everything else | Piper | Whisper | nothing |

Each sentence picks its voice by what's written: anything with Chinese in it goes to Matcha and the rest to Pocket TTS, whichever language the agent is set to. The second voice downloads the first time a sentence needs it, and Piper says those sentences until it's here. Everything streams at 24 kHz, because Hermes asks for the rate before it knows the sentence.

- **`GET /api/plugins/murmur-voice/local?profile=&language=`** → `{language, pair: {speak, listen}, size, on, active, download}`. Each side of `pair` is `{id, name, builtin}`. `size` is bytes still to download, with the models' Python packages. `active` is what runs right now, and `credit` the models whose licences ask for it. A 404 means the plugin isn't there: On your Umbrel then uses Local Whisper and Piper, as before, if this Hermes has them.
- **`POST /api/plugins/murmur-voice/local/install?profile=`** `{language?}` fetches that language's pair, alongside anything already wanted. `download` is `{state: downloading | unpacking | installing | done | failed, received, total, eta, error: {kind: space | network | checksum | unknown}}`; Murmur polls it every second while it moves.
- **Choosing** writes Hermes's own keys: `tts.provider: murmur`, `stt.provider: murmur`, `stt.language` for both sides, and Piper's voice and Whisper's model for the language (`tts.piper.voice`, `stt.local.model`). STT plugins don't show in the dashboard's `stt` toolset list, so Murmur reads `stt.provider` from the config.
- **The TTS lease** (`/api/audio/tts-lease`) loads both sides for a call, Whisper and Piper included while they stand in; Hermes's STT lease only warms its own Whisper. A model that finishes downloading during a call is loaded at once.

Models live in `/opt/data/murmur-voice` (`HERMES_HOME`), shared by every agent, so an app update keeps them. Every file is pinned to an exact revision and sha256 (`pins.json`). sherpa-onnx stays on 1.13: from 2.0 it silently drops English words its lexicons don't have from Chinese sentences.

## Calls on iOS (`ios.ts`)

On an iPhone, any AudioContext running beside a mic with echo cancelling makes speech crackle, whatever it's doing and wherever the speech comes out. Mic off, echo cancelling off, or no AudioContext at all, and it's clean. Longer buffers, matching sample rates and opening the context after the mic didn't help, and calls need echo cancelling. So calls on iOS use no Web Audio once they've picked up, and sounds stop then too, because iOS ignores an audio element's volume.

The other rule on iOS: during a call, never pause, mute or let go of the element that's playing. The moment nothing audible is playing iOS shuts the audio session down, the page stalls for over a second, and the mic stops for good, with its track still saying `live` and unmuted. A reply running out of audio is fine, so being talked over skips to the end of what's in hand instead. Safari's SourceBuffer forgets its place on `abort()`, even in `sequence` mode, so `timestampOffset` has to be set again or the next sentence lands at zero. If the mic stops anyway, `totalSamplesDuration` in the stats stops growing, and a new `getUserMedia` replaces it.

- **Live voices** play through their audio element, and read levels from `getStats` (`media-source`, `inbound-rtp`).
- **Local voices** come from **`POST /api/plugins/murmur-voice/say?profile=`** `{text}`, the agent's voice as MP4 fragments (`core/encode.py`), fed to one audio element through Managed Media Source (`piece-voice.ts`). Without it, a sentence is said a clause at a time as separate clips.
- **The mic** is a MediaRecorder, and a call to itself for the level (`recorder-mic.ts`). That level is a peak, and echo cancelling moves it around: all but silent while the agent talks, 0.02 for a quiet room against 0.35 for speech. It's good enough to notice being talked over, which stops the agent at once, and not to tell when you've finished.
- **Turns** are decided on the agent's machine where the image's plugin is there. **`WS /api/plugins/murmur-voice/hear?profile=`** takes the recording as it's made (Safari hands over one whole MP4 fragment about once a second, whatever `timeslice` asks for), `{mode}`, `{interrupted}` and `{finish}`, and sends `{type: "speech"}`, `{type: "nothing"}` and each finished turn as a WAV for `/api/audio/transcribe`. Silero's voice activity model comes with Hermes's Whisper, so this needs no download, in any language. Without the plugin, turns come from the level, a MediaRecorder per turn, sent as `audio/mp4`.
- **Tapping the words** while it's listening ends the turn, in case it hasn't noticed you've finished.
- **A call never sits there silently.** If the audio stops arriving during a turn, the server sends what it has after 2 seconds; a turn ends at 15 seconds whatever it sounds like; and when an interruption comes to nothing the agent says so out loud.

## Where voice keys live

An OpenAI or ElevenLabs key is a line in the agent's `.env`, written by Hermes's `PUT /api/env`, and a ChatGPT sign-in is in `auth.json`: Hermes's own stores, plain text, mode 600, in the app's data folder. The browser never gets a key or a token for a call. Hermes or the plugin makes the session and it gets only the SDP answer; audio then goes straight to OpenAI, and ElevenLabs is only ever reached by Hermes. `GET /api/env` masks values. `/api/env/reveal` returns them, so Murmur's proxy only lets a browser use it for `MCP_*_API_KEY` (`mayReadKey`). An agent's terminal runs as the same user in the same container, so it can read these files: Hermes's file tools refuse to, and redacts keys in logs and output, but that isn't a boundary.

The `⋯` on a row in the Voice sheet takes them back. A key goes with `DELETE /api/env`, which clears the line and anything Hermes mirrored from it: only `VOICE_TOOLS_OPENAI_KEY`, never the `OPENAI_API_KEY` the agent's models use, so OpenAI can stay usable afterwards. A ChatGPT sign-in is one for the whole Hermes: agents share the main agent's `auth.json`, and `DELETE /api/providers/oauth/openai-codex?profile=` clears only that agent's own store (409 when it has none), so `signOutChatGPT` clears both, and moves a main agent thinking on ChatGPT to another service the way Settings does. Taking away the voice in use moves the agent to its own machine (`afterRemoving`), and a call along with it.

Replace never loses a key that works. Hermes can only use a key it has saved, and one saved over another is gone, so a new key is tried first: `POST /murmur/voice/check-key` (`server/voice-keys.ts`) says a word on OpenAI or ElevenLabs, and for ElevenLabs listens to it too, the way a voice's setup does through Hermes. Only then does it go in `.env`. If it doesn't pass, nothing changes and the row says why. A first key is still saved and tried through Hermes, as there's nothing to lose.

## ElevenLabs

Hermes speaks through ElevenLabs' SDK, the optional `tts-premium` extra, which `getumbrel/hermes-agent-umbrel` bakes in; a Hermes without it answers `/api/audio/speak` with "package not installed" before ElevenLabs is ever reached. Listening needs no SDK. So setting the voice up has it say hello and then transcribe its own hello, which proves a key can do both of what a call needs, and `voiceSetupError` says which it can't: restricted keys get `missing_permissions`, named by `text_to_speech` or `speech_to_text`. Rejected keys come back as HTTP 400 `invalid_api_key`, not 401, and are worded differently on each side.

## OpenAI's live voice (`live.ts`)

GPT-Live listens and speaks over WebRTC straight between the browser and OpenAI, and hands every real request to the agent ("client delegation"). One client, two ways in.

### On an OpenAI key

Hermes's own route, the one Hermes Desktop uses. No plugin.

- **`GET /api/audio/voice-live/status?profile=`** → `{available, model, voice}`: whether the agent has a key (`voice.gpt_live.api_key`, else `VOICE_TOOLS_OPENAI_KEY`, `OPENAI_API_KEY`).
- **`POST /api/audio/voice-live/session?profile=`** `{sdp, history}` → `{session: {id}, transport: {sdp}}`. `history` is the chat so far (see below). Hermes posts the offer to OpenAI's `/v1/live/sessions` with `gpt-live-1`, the voice `marin` and its own persona ("You are Hermes…") plus `voice.gpt_live.instructions`, which Murmur sets to the agent's name and the screen just before the call. 503 without a key, 502 when OpenAI says no (its status in the detail). Billed at 5¢ a minute.
- **Events come over the call's own `oai-events` data channel**, in the public API's words: `session.input_transcript.delta` and `session.output_transcript.delta` (`delta`), `session.delegation.created` (`delegation.id` only: Murmur keeps what you said since the last request as the message), `error` (`context_injection_incomplete` after a call ends is expected) and `session.closed`. There's no turn-done event, so Murmur takes the voice's audio going quiet for half a second as the end of its answer.
- **Out**, on the same channel: `session.commentary.append` `{delegation_id, content}` for each finished sentence (in pieces of at most 1,400 characters), `session.thinking.append` for what the agent is doing, `session.input_audio.mute|unmute` and `session.close`.

### On a ChatGPT plan

OpenAI's live voice (`gpt-live-1-codex`) listens and speaks, and hands every real request to the agent ("client delegation"). It's the route OpenAI's Codex CLI uses for voice with a ChatGPT sign-in. It isn't part of OpenAI's published API and may change.

- **Hermes holds the sign-in.** The Hermes image Murmur ships has a small dashboard plugin, `murmur-voice` (`umbrel-context/plugins/murmur-voice` in getumbrel/hermes-agent-umbrel). Its routes, under `/api/plugins/murmur-voice/`:
  - `GET chatgpt?profile=` → `{available}`: whether the agent has a ChatGPT sign-in (Hermes's own `resolve_codex_runtime_credentials`, read only). A 404 means this Hermes has no plugin.
  - `POST chatgpt/call?profile=` `{sdp, instructions, voice?, history?}` → `{call, sdp}`. It posts the browser's WebRTC offer to `chatgpt.com/backend-api/codex/realtime/calls`, with the refreshed token, Hermes's own identity headers and `OpenAI-Alpha: quicksilver=v2`, and opens the call's control channel (`wss://api.openai.com/v1/live/{id}`). 409 when the agent isn't signed in.
  - `WS chatgpt/call/{call}`: the control channel's events in (audio deltas dropped, error text reduced to its code); `{type: say|note, delegation, text}` and `{type: close}` out, sent on as `delegation.context.append` on the `speakable` or `commentary` channel, in 500-byte pieces.
- **Audio goes straight** between the browser and OpenAI. Murmur creates the `oai-events` data channel only because the offer needs one.
- **A request** (`delegation.created`) becomes an ordinary voice turn, with what you said (`turn.done`) as the message when it's just in, else the voice's own wording. Each finished sentence of the reply goes back as `say`; what the agent is doing meanwhile goes as `note`. A new request while the last one is still going stops it first. Captions come from `output_transcript.added`.
- **Your words come as you say them**: `input_transcript.added` brings a word or two (`item.text`) about half a second after each, between `turn.created` and `turn.done` for your turn (`role: user`). Murmur shows them as they arrive, so you see you're heard. While your turn is open the voice sometimes says "mm-hmm"; that isn't an answer, so it isn't shown. `turn.done` for your turn can come after the voice has started its "sure, one moment".
- **Between "one moment" and the answer** the voice is quiet while the agent works (often 10 s or more, with deferred tools). The call shows it working, and says what it's doing ("Searching your Umbrel", "Looking at a photo"), the same words it sends the voice as a `note`. Hermes's own setup steps (tool search, skills, the plan) don't count, and commands it runs to work something out read as "Working it out".
- **Signing in** is the usual ChatGPT device code (`useChatGPTSignIn`). It only lends the plan to the voice: the agent keeps its own model.

### Changing the voice during a call

Choosing a voice in the sheet during a call moves the call there (`switchVoice`): the same chat, clock and captions, no greeting and no chimes. It happens at the next quiet moment, so an answer finishes in the voice that started it and a turn being heard isn't cut off, with "Switching to ChatGPT" in the status until it's done. A session or mic left over from an earlier choice closes itself. A voice that needs a key or a sign-in only moves the call once it has one, and a voice that doesn't pick up leaves the call on the one it had. Between two of Hermes's own voices only the mouth changes, so the mic isn't touched. The call's words so far go into the chat first, so the new voice knows them. The chat's model is separate: `setChatModel` applies to the chat's Hermes session, so the next turn uses it on any voice.

### What the live voice knows of the chat

The voice starts with nothing of its own. What it hands to the agent is fine either way, because that's an ordinary turn in the chat's Hermes session, but small talk and "what were we saying?" never reach Hermes. So a call started in a chat opens with that chat's recent words (`live-history.ts`): a `developer` line saying what they are, then text messages, `input_text` for you and `output_text` for the agent, at most 128 and 8,192 tokens by OpenAI's limits. Murmur sends the last 20 turns or about 4,000 tokens, keeping the newest, with no tools, thinking, notices, code or files. Local voices need none of this: every turn is the chat's own Hermes session.

The two ways in take this differently, found on real calls:

- **On an OpenAI key** it's `session.input`, the public API's field, through Hermes's `history`.
- **On a ChatGPT plan** it's `session.initial_items`, as Codex sends it. `session.input` ends the call about 6 seconds in, with no error.
- **On a ChatGPT plan `session.instructions` doesn't reach the voice.** Told to go by another name and start every reply with a set word, it did neither. `initial_items` is what it hears, so the voice's rules (`liveInstructions`) go there too, as a `developer` message, in every call. They go last, nearest the conversation, and say outright that it isn't ChatGPT: ahead of the chat, "You are Calltest" lost to its built-in identity. They're still sent as `instructions`, and on an OpenAI key that's the only place they go, because that one works.

### What the live voice answers by itself

On either way in, small talk never reaches Hermes: the voice answers it. Murmur has both sides' words, so it files each such exchange in the chat, and a blank chat is made on your first words rather than on the first request.

- **`POST /api/plugins/murmur-voice/spoken?profile=`** `{chat, you, voice}` → `{rows}` (the image's plugin) writes the two rows the way Hermes writes its own model-switch note: into the live session and `state.db` together, marked as persisted, so the next turn sees them and doesn't save them again. 404 when the chat isn't open, 409 while a turn runs, because Hermes treats any change to the history under a turn as a desync. A Hermes without the plugin keeps only what's handed to the agent.
- **An exchange waits 1.5 s** after the voice finishes, in case it hands the same words to the agent after all ("let me check", then a request). Your next words, or hanging up, end the wait. What it says for the agent, its fillers and its greeting aren't kept.
- **Titles.** Hermes's titler reads the note it adds for the model, so voice turns also send your words as `title_preview` on `prompt.submit` (it adds to what the titler sees, it doesn't replace it). When Hermes can't reach the model it names the chat after the note itself ("[Note: this message is a delegation…"), so `readable` treats that as no title. A chat with no title, such as one with only small talk, goes by what you first said.

## Gotchas on 0.22.0

- **Local models download on demand** (from `v0.22.5-2`): nothing big is in the image. The first time the Umbrel's voice is used, the plugin fetches the language's pair in the background, with progress in the voice sheet.
- **Speech engines come with the image** (from `v0.22.0-5`): Hermes's own `voice` and `piper` extras, at the versions its `uv.lock` pins, about +150 MB to download. The models don't: the first time, the stt and tts leases download the Whisper model (`base.en` or `base`, 148 MB, in `/opt/data/.cache/huggingface`) and the Piper voice (63 MB, in each agent's `cache/piper-voices`), which took 5 to 9 s on a fast connection; after that a lease loads them in about a second. The voice sheet says the first time takes about a minute; through the plugin, the TTS lease fetches them while the call connects.
- **The stock voice is still Edge.** STT defaults to Local Whisper, TTS to Edge, which can't speak here. On your Umbrel switches TTS to Piper.
- **Older images ship no speech engines.** The dashboard's installer (`POST /api/tools/toolsets/{tts,stt}/post-setup`) fails there with "no dependency environment is committed for this install", and On your Umbrel says "This Hermes doesn't have the speech engines yet".
- **`voice.record` / `voice.tts` RPCs** use the Hermes host's own microphone and speakers. They're no use to a browser. Murmur doesn't use them.
- **Browsers only lend the microphone to secure pages.** umbrelOS serves every app over HTTPS on the same port, so Murmur offers to reopen over HTTPS (`#talk` resumes at a "Start talking" sheet, since sound and the microphone need a tap).
