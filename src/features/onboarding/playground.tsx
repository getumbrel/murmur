import { useState } from 'react'
import { MotionConfig } from 'motion/react'
import { Button } from '@/ui/button'
import { AgentEditorSheet } from '@/features/agents/agent-editor'
import { NewGroupSheet } from '@/features/agents/new-group'
import { ConnectModel, type ChatGPTFlow, type ConnectOption, type ConnectState } from './connect'
import { Done } from './done'
import { FirstAgent } from './first-agent'
import { Welcome } from './welcome'
import { SetupPlayground } from './setup-playground'

// Dev playground for onboarding and agent screens, at /onboarding.html.
// Everything is fake. Query params pick a starting point so screenshots can
// land on any state: ?screen=connect&flow=waiting&open=chatgpt&chrome=0,
// ?screen=done&name=Juniper&hue=28. Where your agents live, Getting ready and
// "Your agents are here": ?screen=where|ready|here (see setup-playground.tsx).

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
  const [keyState, setKeyState] = useState<ConnectState['apiKey']>({
    validating: param('key') === 'validating',
    error: param('key') === 'error' ? 'That key didn’t work. Check it and try again.' : null,
  })
  const [sheet, setSheet] = useState<string | undefined>(param('sheet'))
  const [busy, setBusy] = useState(false)

  const state: ConnectState = {
    chatgpt: flowFor(flow),
    local: { loading: local === 'loading', servers: local === 'found' ? SERVERS : [], connecting: null },
    apiKey: keyState,
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
          state={state}
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
        </div>
      )}
    </MotionConfig>
  )
}
