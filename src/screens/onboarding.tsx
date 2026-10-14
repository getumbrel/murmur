import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { toast } from 'sonner'
import { Welcome } from '@/features/onboarding/welcome'
import { Done } from '@/features/onboarding/done'
import { Arrived, clearArrived, readArrived } from '@/features/onboarding/arrived'
import { FirstAgent } from '@/features/onboarding/first-agent'
import { STEP_COLUMN } from '@/features/onboarding/step'
import { ConnectFlow } from '@/features/settings/connect-flow'
import { AskHost } from '@/features/settings/ask'
import { HermesSwitcher, useCurrentHermes } from '@/features/connection/switcher'
import type { AgentDraft } from '@/features/agents/agent-editor'
import { markWelcomed, useReadiness, useWelcomed } from '@/state/readiness'
import { composeSoul, updateAgent, useAgentChats, useAgents, useInvalidateAgents, type Agent } from '@/state/agents'
import { useCheckReady } from '@/state/models'
import { usePrefersReducedMotion } from '@/lib/use-media'
import { WindowControlsGap } from '@/ui/titlebar'

// First run: welcome → connect a model → shape the first agent → done.
// People who already use Hermes see the welcome once and go straight in.
// Having just chosen a Hermes that already has agents (the setup flow in
// front of the app, features/onboarding/setup-flow.tsx), they're greeted
// instead: "Your agents are here".
// With more than one Hermes, the switcher sits top-left on every step, so a
// Hermes that has no model yet is never a dead end.

type Step = 'welcome' | 'connect' | 'agent' | 'done' | 'here'

export function OnboardingScreen({ step: param }: { step?: string }) {
  const step: Step = param === 'connect' || param === 'agent' || param === 'done' || param === 'here' ? param : 'welcome'
  const [, navigate] = useLocation()
  const readiness = useReadiness()
  const welcomed = useWelcomed()
  const fresh = useIsFresh()
  const checkReady = useCheckReady()
  const reduced = usePrefersReducedMotion()
  const switching = useSwitcherShown()

  // Just chose a Hermes with agents in it: they're greeted once.
  const [arrived] = useState(readArrived)

  const ready = readiness === 'ready' || readiness === 'needs-welcome'
  // A brand-new Hermes shapes its first agent; one with agents already greets them.
  const afterReady = () => navigate(fresh ? '/welcome/agent' : arrived ? '/welcome/here' : '/', { replace: true })

  // Past the welcome, the steps are for a new Hermes (or one with no model yet).
  // Anywhere else they'd overwrite someone's main agent, so they lead home.
  const [cleared, setCleared] = useState(false)
  const allowed =
    (step === 'welcome' && !welcomed) ||
    cleared ||
    (step === 'here' ? !!arrived : step === 'connect' ? readiness === 'needs-setup' || fresh : step !== 'welcome' && fresh)
  useEffect(() => {
    if (step === 'welcome' || cleared) return
    if (allowed) setCleared(true)
    else if (readiness !== 'loading' && fresh !== undefined) navigate('/', { replace: true })
  }, [step, cleared, allowed, readiness, fresh, navigate])

  // Someone who has seen the welcome before only needs what's missing.
  useEffect(() => {
    if (step !== 'welcome' || !welcomed) return
    if (ready && fresh !== undefined) afterReady()
    else if (readiness === 'needs-setup') navigate('/welcome/connect', { replace: true })
    else if (readiness === 'unknown') navigate('/', { replace: true })
  }, [step, welcomed, ready, readiness, fresh, navigate])

  const screen = {
    welcome: (
      <Welcome
        onContinue={() => {
          markWelcomed()
          if (ready) afterReady()
          else navigate('/welcome/connect')
        }}
      />
    ),
    connect: (
      <ConnectFlow
        onConnected={async () => {
          const check = await checkReady().catch(() => null)
          if (check?.ok) return afterReady()
          toast.error(
            check?.error
              ? 'That service is connected, but Hermes can’t use it yet.'
              : 'Can’t reach Hermes. Check that it’s running, then try again.',
          )
        }}
      />
    ),
    agent: (
      <AgentStep
        onDone={(name) => navigate(`/welcome/done?name=${encodeURIComponent(name)}`, { replace: true })}
        onSkip={() => navigate('/', { replace: true })}
      />
    ),
    done: <DoneStep onStart={() => navigate('/chat/default', { replace: true })} />,
    here: <HereStep chats={arrived?.chats} onStart={() => navigate('/', { replace: true })} />,
  }[step]

  return (
    <>
      <Switcher delay={step === 'welcome' && !welcomed && !reduced ? 2.2 : 0.3} />
      <div data-switcher={switching || undefined}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={allowed ? step : 'held'}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          >
            {allowed && screen}
          </motion.div>
        </AnimatePresence>
      </div>
      <AskHost />
    </>
  )
}

/** Only the main agent, and nobody has talked to it yet: a brand-new Hermes. Undefined while checking. */
function useIsFresh() {
  const agents = useAgents()
  const chats = useAgentChats('default')
  if (agents.isError || chats.isError) return false
  if (!agents.data || !chats.data) return undefined
  return agents.data.length === 1 && chats.data.length === 0
}

// ── Which Hermes ────────────────────────────────────────────────────────────

/**
 * Top-left, opposite Skip and on its line, in the step's own column. Nothing
 * until there are two Hermes. It arrives after the step's title, and after the
 * murmuration on the welcome.
 */
function Switcher({ delay }: { delay: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
      <div className={`flex h-11 items-center mt-[max(8px,env(safe-area-inset-top))] desktop:mt-0 desktop:h-(--titlebar-h) ${STEP_COLUMN}`}>
        <WindowControlsGap side="start" column={480} />
        <motion.div
          className="pointer-events-auto min-w-0"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay }}
        >
          {/* Its pill's left edge meets the column's text, like the title under it. */}
          <HermesSwitcher />
        </motion.div>
      </div>
    </div>
  )
}

/** Whether HermesSwitcher draws anything: two Hermes or more, one of them this tab's. */
function useSwitcherShown() {
  const { list, current } = useCurrentHermes()
  return !!current && (list?.connections.length ?? 0) >= 2
}

// ── Shape the main agent ────────────────────────────────────────────────────

function AgentStep({ onDone, onSkip }: { onDone: (name: string) => void; onSkip: () => void }) {
  const [saving, setSaving] = useState(false)
  const invalidate = useInvalidateAgents()
  const agents = useAgents().data ?? []
  const main = agents.find((a) => a.isDefault)
  const others = agents.filter((a) => !a.isDefault)

  const save = async (draft: AgentDraft) => {
    setSaving(true)
    try {
      await personalize(main, draft)
      await invalidate()
      onDone(draft.name)
    } catch {
      toast.error('Couldn’t save your agent. Try again.')
      setSaving(false)
    }
  }

  return (
    <FirstAgent
      onSubmit={save}
      submitting={saving}
      onSkip={onSkip}
      seed={main?.id ?? 'default'}
      takenNames={others.map((a) => a.name)}
      takenIds={agents.map((a) => a.id)}
    />
  )
}

/**
 * The main agent becomes the one shaped here, the same way an edit saves any
 * agent: name and colour in its look, the template it came from (so its first
 * chat offers that template's starters), what it's for, and its SOUL. The
 * profile keeps its id, "default"; Hermes isn't asked to rename it.
 */
async function personalize(main: Agent | undefined, d: AgentDraft) {
  const agent: Agent = main ?? { id: 'default', name: 'Hermes', hue: 278, role: '', isDefault: true }
  // Starting from scratch leaves no template behind.
  const { template: _, ...murmurMeta } = agent.murmurMeta ?? {}
  await updateAgent(
    { ...agent, murmurMeta },
    {
      name: d.name,
      hue: d.hue,
      role: d.role,
      soul: composeSoul(d.name, d.role, d.personality, d.custom),
      template: d.template,
    },
  )
}

// ── Your agents are here ────────────────────────────────────────────────────

function HereStep({ chats, onStart }: { chats?: number; onStart: () => void }) {
  // Plays once.
  useEffect(clearArrived, [])
  const agents = useAgents().data ?? []
  if (!agents.length) return null
  return (
    <Arrived
      agents={agents.map((a) => ({ id: a.id, name: a.name, hue: a.hue, isDefault: a.isDefault, at: a.lastChat?.at ?? a.mainChatAt }))}
      chats={chats}
      onStart={onStart}
    />
  )
}

// ── Done ────────────────────────────────────────────────────────────────────

function DoneStep({ onStart }: { onStart: () => void }) {
  const main = useAgents().data?.find((a) => a.isDefault)
  const name = main?.name ?? new URLSearchParams(location.search).get('name') ?? 'Your agent'
  return <Done name={name} hue={main?.hue ?? 278} seed={main?.id ?? 'default'} onStart={onStart} />
}
