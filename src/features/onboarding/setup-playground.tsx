import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import type { BuiltinState, Choice, ChoiceResult, FoundAgent, FoundHermes, Setup } from '@/state/setup'
import type { HermesConnection, KnownHermes } from '@/state/connection'
import { HermesConnectionFormView } from '@/features/connection/hermes-connection-form'
import { fromFound } from '@/features/connection/nearby'
import { NoHermesSheet } from '@/features/connection/no-hermes'
import { Arrived, type ArrivedAgent } from './arrived'
import { GettingReady } from './getting-ready'
import { WhereStep } from './where'

// The setup flow's screens for the onboarding playground, all fake:
//   ?screen=where&case=looking | found | found-many | found-fresh | found-network | outdated | signin
//                    | signin-error | fresh | fresh-down | down-row | none | other | cant-reach
//                    | connecting | connected
//   ?screen=ready&stage=starting | room | slow | stuck | failed | done
//   ?screen=here&agents=1..9&chats=0|1|240
// Every Where case can be played through: "Use…" lands on "Your agents are
// here", Start fresh goes through Getting ready.

const params = new URLSearchParams(location.search)
const param = (k: string) => params.get(k) ?? undefined
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const PEOPLE: (FoundAgent & { hue: number })[] = [
  { id: 'default', name: 'Juniper', hue: 278, isDefault: true },
  { id: 'sage', name: 'Sage', hue: 160 },
  { id: 'otto', name: 'Otto', hue: 52 },
  { id: 'rowan', name: 'Rowan', hue: 222 },
  { id: 'wren', name: 'Wren', hue: 28 },
  { id: 'pip', name: 'Pip', hue: 338 },
  { id: 'nova', name: 'Nova', hue: 192 },
  { id: 'milo', name: 'Milo', hue: 4 },
  { id: 'atlas', name: 'Atlas', hue: 250 },
]

const agentApp = (over: Partial<FoundHermes> = {}): FoundHermes => ({
  id: 'f-umbrel',
  name: 'Hermes Agent',
  where: 'umbrel',
  url: 'http://hermes-agent_web_1:18789',
  host: 'hermes-agent_web_1:18789',
  version: '0.22.0',
  hasModel: true,
  agents: PEOPLE.slice(0, 4),
  agentCount: 4,
  chats: 120,
  ...over,
})

const studio: FoundHermes = {
  id: 'f-studio',
  name: 'Hermes on studio.local',
  where: 'network',
  url: 'http://studio.local:9119',
  host: 'studio.local:9119',
  version: '0.22.0',
  needsSignIn: true,
}

const laptop: FoundHermes = {
  id: 'f-laptop',
  name: 'Hermes on this computer',
  where: 'computer',
  url: 'http://localhost:9119',
  host: 'localhost:9119',
  version: '0.22.0',
  hasModel: true,
  agents: [PEOPLE[3], PEOPLE[6], PEOPLE[8]].map((a, i) => ({
    ...a,
    isDefault: i === 0,
    id: i === 0 ? 'default' : a.id,
  })),
  agentCount: 3,
  chats: 18,
}

const ready = { state: 'ready' as const, version: '0.22.0', hasModel: false, agents: 1, added: false }

const CASES: Record<string, Setup | undefined> = {
  looking: undefined,
  found: { decided: false, umbrel: true, builtin: ready, found: [agentApp()] },
  'found-many': {
    decided: false,
    umbrel: true,
    builtin: ready,
    found: [agentApp({ agents: PEOPLE.slice(0, 6), agentCount: 9, chats: 240 })],
  },
  'found-fresh': {
    decided: false,
    umbrel: true,
    builtin: ready,
    found: [agentApp({ agents: [PEOPLE[0]], agentCount: 1, chats: 0, hasModel: false })],
  },
  'found-network': { decided: false, umbrel: false, builtin: ready, found: [laptop] },
  outdated: {
    decided: false,
    umbrel: true,
    builtin: ready,
    found: [agentApp({ outdated: true, version: '0.20.1', minVersion: '0.21.4' })],
  },
  signin: { decided: false, umbrel: false, builtin: ready, found: [studio] },
  'signin-error': { decided: false, umbrel: false, builtin: ready, found: [studio] },
  fresh: { decided: false, umbrel: true, builtin: ready, found: [] },
  'fresh-down': { decided: false, umbrel: true, builtin: { ...ready, state: 'unreachable' }, found: [] },
  'down-row': { decided: false, umbrel: true, builtin: { ...ready, state: 'unreachable' }, found: [agentApp()] },
  none: { decided: false, umbrel: false, builtin: null, found: [laptop, studio] },
  other: { decided: false, umbrel: true, builtin: ready, found: [agentApp(), laptop] },
  'cant-reach': undefined,
  connecting: { decided: false, umbrel: true, builtin: ready, found: [agentApp()] },
  connected: { decided: false, umbrel: true, builtin: ready, found: [agentApp()] },
}

const connection = (over: Partial<KnownHermes>): KnownHermes => ({
  id: 'main',
  name: 'Hermes Agent',
  url: 'http://hermes-agent_web_1:18789',
  managed: false,
  source: 'saved',
  mode: 'token',
  status: 'connected',
  hermesVersion: '0.22.0',
  ...over,
})

type View =
  { screen: 'where' } | { screen: 'ready' } | { screen: 'here'; agents: ArrivedAgent[]; chats: number }

const toArrived = (list: FoundAgent[], total: number): ArrivedAgent[] => {
  const all = [...list, ...PEOPLE.filter((p) => !list.some((a) => a.id === p.id))].slice(
    0,
    Math.max(total, list.length),
  )
  return all.map((a, i) => ({ id: a.id, name: a.name, hue: a.hue ?? 278, isDefault: a.isDefault, at: 1000 - i }))
}

export function SetupPlayground({ screen }: { screen: 'where' | 'ready' | 'here' }) {
  const kase = param('case') ?? 'found'
  const [view, setView] = useState<View>(() =>
    screen === 'here'
      ? {
          screen: 'here',
          agents: toArrived(PEOPLE.slice(0, Number(param('agents') ?? 6)), Number(param('agents') ?? 6)),
          chats: Number(param('chats') ?? 240),
        }
      : { screen },
  )
  const [setup, setSetup] = useState<Setup | undefined>(kase === 'looking' ? undefined : CASES[kase])
  // Looking: the answer lands after a moment (unless frozen with &hold=1).
  useEffect(() => {
    if (kase !== 'looking' || param('hold')) return
    const t = setTimeout(() => setSetup(CASES.found), 2400)
    return () => clearTimeout(t)
  }, [kase])

  const choose = async (choice: Choice): Promise<ChoiceResult> => {
    await wait(900)
    if (choice.use === 'builtin') {
      const c = connection({ id: 'builtin', name: 'Built-in', source: 'builtin', managed: true, status: 'unreachable' })
      return { ok: true, connection: c, active: c.id, connections: [c] }
    }
    const f = setup?.found.find((x) => x.id === choice.id)
    if (f?.needsSignIn && (choice.username !== 'murmur' || choice.password !== 'hunter2')) {
      return { ok: false, reason: 'failed', connection: { ...connection({}), status: 'bad-login' } }
    }
    const c = connection({ name: f?.name ?? 'Hermes Agent' })
    return { ok: true, connection: c, active: c.id, connections: [c] }
  }

  // An outdated Hermes that gets updated while the card's up: "Check again" finds it usable the second time.
  const [checks, setChecks] = useState(0)
  const refresh = async () => {
    await wait(800)
    setChecks((n) => n + 1)
    if (kase === 'outdated' && checks >= 1) {
      const next = { ...setup!, found: [agentApp()] }
      setSetup(next)
      return next
    }
    if (kase === 'cant-reach') {
      setSetup(CASES.found)
      return CASES.found
    }
    return setup
  }

  if (view.screen === 'ready') return <ReadyDemo />
  if (view.screen === 'here')
    return (
      <Arrived key={String(view.agents.length)} agents={view.agents} chats={view.chats} onStart={() => alert('Home')} />
    )

  if (kase === 'none' || kase === 'other') return <FormStep other={kase === 'other'} setup={setup!} />

  return (
    <>
      <WhereStep
        key={kase}
        setup={setup}
        failed={kase === 'cant-reach' && !setup}
        umbrel
        choose={choose}
        refresh={refresh}
        onOther={() => alert('Connect a different Hermes…')}
        onDecided={() => {}}
        onChosen={(_, { lead }) => {
          if (lead)
            setView({
              screen: 'here',
              agents: toArrived(lead.agents ?? [], lead.agentCount ?? 1),
              chats: lead.chats ?? 0,
            })
          else setView({ screen: 'ready' })
        }}
        initial={
          kase === 'connecting'
            ? { busy: 'found' }
            : kase === 'connected'
              ? { done: true }
              : kase === 'signin-error'
                ? {
                    signIn: {
                      username: 'murmur',
                      password: 'wrong-password',
                      error: 'That username or password didn’t work.',
                    },
                  }
                : undefined
        }
      />
      <Toaster position="top-center" toastOptions={{ className: 'murmur-toast' }} />
    </>
  )
}

/** Connect to Hermes as an onboarding step: on its own (no built-in), or from Where with Back. */
function FormStep({ other, setup }: { other: boolean; setup: Setup }) {
  const [sheet, setSheet] = useState(param('sheet') === 'none')
  const fake = async (req: { url: string }): Promise<HermesConnection> => {
    await wait(700)
    return connection({ url: req.url, name: 'studio.local' })
  }
  return (
    <>
      <HermesConnectionFormView
        step
        found={setup.found.map(fromFound)}
        onBack={other ? () => alert('Back') : undefined}
        below={
          other ? undefined : (
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="pressable flex h-11 items-center rounded-full px-4 text-subhead font-medium text-accent select-none hover:bg-fill-1 active:bg-fill-2"
            >
              Don’t have Hermes yet?
            </button>
          )
        }
        onTest={fake}
        onSave={fake}
        onChooseFound={async () => {
          await wait(900)
          return connection({})
        }}
        onConnected={() => {}}
      />
      <NoHermesSheet open={sheet} onOpenChange={setSheet} />
    </>
  )
}

/** Getting ready, either frozen at a stage or (with no stage) played through: start, answer, signed in. */
function ReadyDemo() {
  const stage = param('stage')
  const [state, setState] = useState<BuiltinState>(
    stage === 'room' || stage === 'done' ? 'ready' : stage === 'failed' ? 'unreachable' : 'starting',
  )
  const [connected, setConnected] = useState(stage === 'done')
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (stage) return
    const a = setTimeout(() => setState('ready'), 2600)
    const b = setTimeout(() => setConnected(true), 4200)
    return () => {
      clearTimeout(a)
      clearTimeout(b)
    }
  }, [stage, round])
  return (
    <GettingReady
      key={round}
      state={state}
      connected={connected}
      elapsed={stage === 'slow' ? 46_000 : stage === 'stuck' ? 4 * 60_000 + 1000 : 0}
      initialFailed={stage === 'failed'}
      onDone={() => (stage === 'done' ? undefined : alert('All set: on to Connect a model'))}
      onRetry={() => {
        setState('starting')
        setRound((r) => r + 1)
      }}
      onOther={() => alert('Use a different Hermes…')}
    />
  )
}
