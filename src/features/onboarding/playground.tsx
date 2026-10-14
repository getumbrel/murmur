import { useEffect, useRef, useState } from 'react'
import { MotionConfig } from 'motion/react'
import { Button } from '@/ui/button'
import { AgentEditorSheet } from '@/features/agents/agent-editor'
import { NewGroupSheet } from '@/features/agents/new-group'
import type { DeviceModel, DeviceSetup } from '@/state/local-jobs'
import { ConnectModel, type ChatGPTFlow, type ConnectOption, type ConnectState, type FindState } from './connect'
import { Done } from './done'
import { FirstAgent } from './first-agent'
import { Welcome } from './welcome'
import { SetupPlayground } from './setup-playground'

// Dev playground for onboarding and agent screens, at /onboarding.html.
// Everything is fake. Query params pick a starting point so screenshots can
// land on any state: ?screen=connect&flow=waiting&open=chatgpt&chrome=0,
// ?screen=done&name=Juniper&hue=28. Where your agents live, Getting ready and
// "Your agents are here": ?screen=where|ready|here (see setup-playground.tsx).
// A model on this Umbrel: ?screen=connect&open=device&device=idle|tight|one|
// preparing|downloading|paused|starting|ready|error|none (&umbrel=0 for "this
// computer"); a model typed in by name there: &custom=resolved|tight|toobig|
// finding|error (type "nope/…" to see an error, anything else finds one); an
// Ollama with no models yet: &local=empty&open=local.

const params = new URLSearchParams(location.search)
const param = (k: string) => params.get(k) ?? undefined

type Screen = 'welcome' | 'where' | 'ready' | 'here' | 'connect' | 'first-agent' | 'done' | 'agents'
type FlowKey = 'idle' | 'starting' | 'code' | 'waiting' | 'success' | 'disabled' | 'expired' | 'other'

const FLOWS: FlowKey[] = ['idle', 'starting', 'code', 'waiting', 'success', 'disabled', 'expired', 'other']

const flowFor = (k: FlowKey): ChatGPTFlow => {
  const code = { userCode: 'K7QF-M2XD', verificationUrl: 'https://auth.openai.com/codex/device', expiresAt: Date.now() + 14 * 60_000 + 32_000 }
  switch (k) {
    case 'code':
    case 'waiting':
      return { status: k, ...code }
    case 'disabled':
      return { status: 'error', kind: 'device_login_disabled', message: 'Device code login is disabled for this account.' }
    case 'expired':
      return { status: 'error', kind: 'expired', message: 'The code expired.' }
    case 'other':
      return { status: 'error', kind: 'other', message: 'ChatGPT didn’t respond. Check your connection, then try again.' }
    default:
      return { status: k }
  }
}

const SERVERS = [
  {
    name: 'Ollama',
    baseUrl: 'http://ollama_ollama_1:11434',
    models: [
      { id: 'llama3.2:3b', size: 2_019_393_189, parameters: '3.2B' },
      { id: 'qwen2.5:7b', size: 4_683_087_332, parameters: '7.6B' },
      { id: 'gemma3:12b', size: 8_149_190_253, parameters: '12.2B' },
    ],
  },
]

const EMPTY_OLLAMA = [{ name: 'Ollama', baseUrl: 'http://ollama_ollama_1:11434/v1', models: [] }]

// What Hermes's hardware answer turns into on a 16 GB Umbrel with about 12 GB free (local-tiers.ts).
const DEVICE_MODELS: DeviceModel[] = [
  { id: 'qwen3.5-9b-q6', name: 'Qwen3.5 9B', bytes: 7_458_301_152, speed: 'Steady', smarts: 'Smart', hue: 222, recommended: true, fits: true, downloaded: false },
  { id: 'qwen3.5-4b', name: 'Qwen3.5 4B', bytes: 2_740_937_888, speed: 'Fast', smarts: 'Good', hue: 278, recommended: false, fits: true, downloaded: false },
]

// Models typed in by name, as Hermes's file list and the same machine turn them into cards (local-hf.ts).
const FOUND = {
  fits: { id: 'hf:Qwen3.5-0.8B-Q4_K_M', name: 'Qwen3.5 0.8B', bytes: 532_517_120, speed: '', smarts: '', hue: 314, recommended: false, fits: true, downloaded: false, hf: { repo: 'unsloth/Qwen3.5-0.8B-GGUF', quant: 'Q4_K_M', fit: 'fits', least: 2_143_129_856, room: 6_400_000_000 } },
  tight: { id: 'hf:Meta-Llama-3.1-8B-Instruct-Q3_K_M', name: 'Meta Llama 3.1 8B Instruct', bytes: 4_018_918_656, speed: '', smarts: '', hue: 236, recommended: false, fits: true, downloaded: false, hf: { repo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', quant: 'Q3_K_M', fit: 'tight', least: 5_629_531_392, room: 6_400_000_000 } },
  toobig: { id: 'hf:Qwen3.8-27B-Q8_0', name: 'Qwen3.8 27B', bytes: 29_047_086_048, speed: '', smarts: '', hue: 192, recommended: false, fits: false, downloaded: false, hf: { repo: 'unsloth/Qwen3.8-27B-GGUF', quant: 'Q8_0', fit: 'too-big', least: 30_657_698_784, room: 6_400_000_000 } },
} satisfies Record<string, DeviceModel>

type CustomKey = 'none' | 'resolved' | 'tight' | 'toobig' | 'finding' | 'error'

const findFor = (k: CustomKey): FindState | null => {
  switch (k) {
    case 'resolved':
      return { query: 'unsloth/Qwen3.5-0.8B-GGUF', finding: false, model: FOUND.fits, error: null }
    case 'tight':
      return { query: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q3_K_M', finding: false, model: FOUND.tight, error: null }
    case 'toobig':
      return { query: 'unsloth/Qwen3.8-27B-GGUF:Q8_0', finding: false, model: FOUND.toobig, error: null }
    case 'finding':
      return { query: 'unsloth/Qwen3.5-0.8B-GGUF', finding: true, model: null, error: null }
    case 'error':
      return { query: 'meta-llama/Llama-3.1-8B-Instruct', finding: false, model: null, error: 'That repo has no models Hermes can run.' }
    default:
      return null
  }
}

/** A pretend lookup: a beat, then a model, or an error for "nope/…". */
function useFakeFind(key: CustomKey) {
  const [state, setState] = useState(() => findFor(key))
  const [shown, setShown] = useState(key)
  if (shown !== key) {
    setShown(key)
    setState(findFor(key))
  }
  const find = (query: string) => {
    setState((s) => ({ query, finding: true, model: s?.model ?? null, error: null }))
    setTimeout(() => {
      const nope = /^nope\//i.test(query)
      setState((s) => ({ query, finding: false, model: nope ? (s?.model ?? null) : FOUND.fits, error: nope ? 'No public model by that name.' : null }))
    }, 900)
  }
  return { state, find }
}

type DeviceKey = 'idle' | 'tight' | 'one' | 'none' | 'loading' | DeviceSetup['stage']
const DEVICE_KEYS: DeviceKey[] = ['idle', 'tight', 'one', 'preparing', 'downloading', 'paused', 'starting', 'ready', 'error', 'loading', 'none']

const setupFor = (k: DeviceKey): DeviceSetup | null => {
  const base = { id: 'qwen3.5-4b', done: 1_160_000_000, total: 2_740_937_888, eta: 142, canPause: true }
  switch (k) {
    case 'preparing':
      return { ...base, stage: k, done: 0, eta: null, canPause: false }
    case 'downloading':
    case 'paused':
      return { ...base, stage: k }
    case 'starting':
    case 'ready':
      return { ...base, stage: k, done: base.total, eta: null, canPause: false }
    case 'error':
      return { ...base, stage: k, eta: null, canPause: false, error: 'Couldn’t reach the download. Check the internet connection.' }
    default:
      return null
  }
}

/** A pretend setup: getting ready, a quick download, starting up, ready. */
function useFakeSetup(key: DeviceKey, onReady: () => void) {
  const [setup, setSetup] = useState(() => setupFor(key))
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)
  const stop = () => clearInterval(timer.current)
  // Picking another state in the chrome starts it over.
  const [shown, setShown] = useState(key)
  if (shown !== key) {
    setShown(key)
    setSetup(setupFor(key))
  }
  useEffect(() => stop, [key])
  const tick = (from: DeviceSetup) => {
    stop()
    let s = from
    timer.current = setInterval(() => {
      if (s.stage === 'preparing') s = { ...s, stage: 'downloading', canPause: true }
      else if (s.stage === 'downloading') {
        const done = Math.min(s.total!, s.done + s.total! / 14)
        s = done >= s.total! ? { ...s, done, stage: 'starting', eta: null, canPause: false } : { ...s, done, eta: Math.round(((s.total! - done) / s.total!) * 300) }
      } else if (s.stage === 'starting') s = { ...s, stage: 'ready' }
      else if (s.stage === 'ready') {
        stop()
        return onReady()
      }
      setSetup(s)
    }, 600)
  }
  return {
    setup,
    start: (id: string) => {
      const all = [...DEVICE_MODELS, ...Object.values(FOUND)]
      const s: DeviceSetup = { id, stage: 'preparing', done: 0, total: all.find((m) => m.id === id)?.bytes ?? 0, eta: null, canPause: false }
      setSetup(s)
      tick(s)
    },
    pause: () => {
      stop()
      setSetup((s) => s && { ...s, stage: 'paused', eta: null })
    },
    resume: () => setup && tick({ ...setup, stage: 'downloading' }),
    cancel: () => {
      stop()
      setSetup(null)
    },
  }
}

const AGENTS = [
  { id: 'a1', name: 'Juniper', hue: 278 },
  { id: 'a2', name: 'Atlas', hue: 222 },
  { id: 'a3', name: 'Pip', hue: 52 },
  { id: 'a4', name: 'Nova', hue: 338 },
  { id: 'a5', name: 'Sage', hue: 160 },
  { id: 'a6', name: 'Wren', hue: 28 },
  { id: 'a7', name: 'Milo', hue: 192 },
]

export function Playground() {
  const [screen, setScreen] = useState<Screen>((param('screen') as Screen) ?? 'welcome')
  const [welcomeKey, setWelcomeKey] = useState(0)
  const [flow, setFlow] = useState<FlowKey>((param('flow') as FlowKey) ?? 'idle')
  const local = param('local') ?? 'found'
  const [deviceKey, setDeviceKey] = useState<DeviceKey>((param('device') as DeviceKey) ?? 'idle')
  const umbrel = param('umbrel') !== '0'
  const [customKey, setCustomKey] = useState<CustomKey>((param('custom') as CustomKey) ?? 'none')
  const found = useFakeFind(customKey)
  const [keyState, setKeyState] = useState<ConnectState['apiKey']>({
    validating: param('key') === 'validating',
    error: param('key') === 'error' ? 'That key didn’t work. Check it and try again.' : null,
  })
  const [sheet, setSheet] = useState<string | undefined>(param('sheet'))
  const [busy, setBusy] = useState(false)

  const fake = useFakeSetup(deviceKey, () => setScreen('first-agent'))
  const state: ConnectState = {
    chatgpt: flowFor(flow),
    local: {
      loading: local === 'loading',
      servers: local === 'found' ? SERVERS : local === 'empty' ? EMPTY_OLLAMA : [],
      connecting: null,
    },
    apiKey: keyState,
    device: {
      supported: deviceKey !== 'none',
      loading: deviceKey === 'loading',
      place: umbrel ? 'this Umbrel' : 'this computer',
      models: deviceKey === 'one' || deviceKey === 'tight' ? DEVICE_MODELS.slice(deviceKey === 'tight' ? 1 : 0).slice(0, 1).map((m) => ({ ...m, recommended: true, fits: deviceKey !== 'tight' })) : DEVICE_MODELS,
      tight: deviceKey === 'tight' ? { free: 3_100_000_000 } : null,
      setup: fake.setup,
      custom: found.state,
    },
  }

  const fakeSubmit = () => {
    setBusy(true)
    setTimeout(() => {
      setBusy(false)
      setSheet(undefined)
    }, 1200)
  }

  return (
    <MotionConfig reducedMotion="user">
      {screen === 'welcome' && <Welcome key={welcomeKey} onContinue={() => setScreen('where')} />}
      {(screen === 'where' || screen === 'ready' || screen === 'here') && <SetupPlayground key={screen} screen={screen} />}
      {screen === 'connect' && (
        <ConnectModel
          key={`${deviceKey}-${customKey}`}
          state={state}
          umbrel={umbrel}
          onAddServer={() => {}}
          onRunDevice={fake.start}
          onPauseDevice={fake.pause}
          onResumeDevice={fake.resume}
          onCancelDevice={fake.cancel}
          onFindDevice={found.find}
          defaultOpen={param('open') as ConnectOption | undefined}
          onChooseChatGPT={() => {
            setFlow('starting')
            setTimeout(() => setFlow('code'), 900)
            setTimeout(() => setFlow('waiting'), 2400)
          }}
          onChooseLocal={() => setScreen('first-agent')}
          onSubmitKey={() => {
            setKeyState({ validating: true })
            setTimeout(() => setKeyState({ validating: false, error: 'That key didn’t work. Check it and try again.' }), 1200)
          }}
          onSkip={() => setScreen('first-agent')}
          onDone={() => setScreen('first-agent')}
        />
      )}
      {screen === 'first-agent' && <FirstAgent onSubmit={() => setScreen('done')} onSkip={() => setScreen('agents')} />}
      {screen === 'done' && (
        <Done name={param('name') ?? 'Juniper'} hue={Number(param('hue') ?? 278)} seed="a1" onStart={() => setScreen('agents')} />
      )}
      {screen === 'agents' && (
        <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-5">
          <Button size="lg" variant="secondary" onClick={() => setSheet('new')}>New agent</Button>
          <Button size="lg" variant="secondary" onClick={() => setSheet('edit')}>Edit agent</Button>
          <Button size="lg" variant="secondary" onClick={() => setSheet('group')}>New group</Button>
        </main>
      )}

      <AgentEditorSheet open={sheet === 'new'} onOpenChange={() => setSheet(undefined)} onSubmit={fakeSubmit} submitting={busy} />
      <AgentEditorSheet
        open={sheet === 'edit'}
        onOpenChange={() => setSheet(undefined)}
        initial={{ name: 'Atlas', hue: 222, role: 'Research and reading lists', personality: 'thoughtful' }}
        onSubmit={fakeSubmit}
        onDelete={() => setSheet(undefined)}
        submitting={busy}
      />
      <NewGroupSheet open={sheet === 'group'} onOpenChange={() => setSheet(undefined)} agents={AGENTS} onCreate={fakeSubmit} submitting={busy} />

      {param('chrome') !== '0' && (
        <div className="fixed top-[max(8px,env(safe-area-inset-top))] right-2 z-[60] flex max-w-[calc(100vw-16px)] flex-wrap justify-end gap-1 rounded-2xl bg-glass p-1 text-caption shadow-float ring-1 ring-line glass">
          <select className="h-7 rounded-lg bg-fill-2 px-2" value={screen} onChange={(e) => setScreen(e.target.value as Screen)}>
            {(['welcome', 'where', 'ready', 'here', 'connect', 'first-agent', 'done', 'agents'] as const).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {screen === 'welcome' && (
            <button className="h-7 rounded-lg bg-fill-2 px-2" onClick={() => setWelcomeKey((k) => k + 1)}>
              Replay
            </button>
          )}
          {screen === 'connect' && (
            <select className="h-7 rounded-lg bg-fill-2 px-2" value={flow} onChange={(e) => setFlow(e.target.value as FlowKey)} aria-label="ChatGPT state">
              {FLOWS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          )}
          {screen === 'connect' && (
            <select className="h-7 rounded-lg bg-fill-2 px-2" value={deviceKey} onChange={(e) => setDeviceKey(e.target.value as DeviceKey)} aria-label="Model on this Umbrel">
              {DEVICE_KEYS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          )}
          {screen === 'connect' && (
            <select className="h-7 rounded-lg bg-fill-2 px-2" value={customKey} onChange={(e) => setCustomKey(e.target.value as CustomKey)} aria-label="Model typed in by name">
              {(['none', 'resolved', 'tight', 'toobig', 'finding', 'error'] as const).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          )}
        </div>
      )}
    </MotionConfig>
  )
}
