import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adoptHermes, HERMES_GONE, HERMES_HEADER, tabHermes } from '@/hermes/instance'
import {
  connectionApi,
  connectionKey,
  connectionsApi,
  connectionsKey,
  liftCurtain,
  type ConnectionRequest,
  type HermesConnection,
} from '@/state/connection'
import {
  addFoundHermes,
  BUILTIN_ID,
  chooseHermes,
  pickLead,
  setupKey,
  useLookAgain,
  useSetup,
  waitingOn,
  type Choice,
  type ChoiceResult,
  type FoundHermes,
  type Setup,
} from '@/state/setup'
import { markWelcomed, restartBoot, useWelcomed } from '@/state/readiness'
import { HermesConnectionFormView } from '@/features/connection/hermes-connection-form'
import { fromFound } from '@/features/connection/nearby'
import { NoHermesSheet } from '@/features/connection/no-hermes'
import { markArrived, readArrived } from './arrived'
import { GettingReady } from './getting-ready'
import { Welcome } from './welcome'
import { WhereStep } from './where'

// The first run of a Murmur that hasn't chosen its Hermes yet, in front of
// the app (HermesGate): Welcome, then "Where should your agents live?", then
// "Connect to Hermes" for a Hermes it didn't find. Routes, so browser and
// Android back work: /welcome → /welcome/where → /welcome/where/other. Once a
// Hermes is chosen the app takes over from /welcome, where onboarding carries
// on (connect a model, the first agent, or "Your agents are here").

type Screen = 'welcome' | 'where' | 'other'

const SCREENS: Record<string, Screen> = {
  '/welcome': 'welcome',
  '/welcome/where': 'where',
  '/welcome/where/other': 'other',
}

export function SetupFlow({ again = false, onHandedOver }: { again?: boolean; onHandedOver?: () => void }) {
  const [location, navigate] = useLocation()
  const welcomed = useWelcomed()
  const qc = useQueryClient()
  const screen = SCREENS[location]
  // A Hermes on Where that's out of date or away: keep looking, so it wakes up by itself once updated.
  const setup = useSetup({ polling: (s) => screen === 'where' && !!s?.found.some(waitingOn) })
  const lookAgain = useLookAgain()
  // Built-in chosen (here, or before a reload) and now choosing something else: add-and-move, not a first choice.
  const [builtinChosen, setBuiltinChosen] = useState(again)
  const [readying, setReadying] = useState(false)
  // Came back to the welcome from Where: it's already landed.
  const [seenWelcome, setSeenWelcome] = useState(false)
  const [noHermes, setNoHermes] = useState(false)
  const [round, setRound] = useState(0)
  // Back from Connect to Hermes is the browser's back when Where led there; otherwise it goes to Where.
  const pushed = useRef(false)

  // Nothing else will draw, so a switch curtain lifts onto this.
  useEffect(liftCurtain, [])

  // Until it hands over, this tab is on the server's stand-in for "no Hermes yet", which goes
  // away the moment a choice is made. Expected here: not a reason to switch (and reload) mid-step.
  useEffect(() => {
    const expected = (e: Event) => e.stopImmediatePropagation()
    window.addEventListener(HERMES_GONE, expected, { capture: true })
    return () => window.removeEventListener(HERMES_GONE, expected, { capture: true })
  }, [])

  // Anywhere else leads to the first step this browser hasn't seen. Someone welcomed before (a
  // reinstall at the same address) starts at Where; going back from there shows the welcome, settled.
  const arriving = useRef(true)
  useEffect(() => {
    const skipWelcome = welcomed || again
    if (!screen || (arriving.current && screen === 'welcome' && skipWelcome)) {
      navigate(skipWelcome ? '/welcome/where' : '/welcome', { replace: true })
    }
    arriving.current = false
    if (screen === 'welcome' && skipWelcome) setSeenWelcome(true)
  }, [screen, welcomed, again, navigate])

  /**
   * Carry on with the chosen Hermes, from /welcome where onboarding picks up.
   * In place when this tab keeps its things where the chosen one does;
   * otherwise the app starts afresh on it (nothing's been kept here yet).
   */
  const handOver = (connection: HermesConnection) => {
    if (connection.id && connection.id !== tabHermes() && !adoptHermes(connection.id)) {
      window.location.replace('/welcome')
      return
    }
    restartBoot()
    navigate('/welcome', { replace: true })
    qc.setQueryData(connectionKey, connection)
    onHandedOver?.()
    void qc.invalidateQueries({ queryKey: connectionsKey })
    void qc.invalidateQueries({ queryKey: setupKey })
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'murmur' })
  }

  const choose = async (choice: Choice): Promise<ChoiceResult> => {
    if (!builtinChosen) return chooseHermes(choice)
    // The built-in was chosen and never came up: add the other one and move to it.
    if (choice.use === 'found')
      return addFoundHermes(choice.id, { username: choice.username, password: choice.password, activate: true })
    return chooseBuiltinAgain()
  }

  /** "Start fresh" again after backing out of a slow start: it's already the choice. */
  const chooseBuiltinAgain = async (): Promise<ChoiceResult> => {
    const list = await connectionsApi.list()
    const builtin = list.connections.find((c) => c.id === BUILTIN_ID)
    if (!builtin) return chooseHermes({ use: 'builtin' })
    return { ok: true, connection: builtin, ...list }
  }

  const arrive = (lead: Pick<FoundHermes, 'name' | 'chats'> | undefined, fallback?: string) => {
    markArrived({ name: lead?.name ?? fallback ?? 'Hermes', chats: lead?.chats })
  }

  // ── Getting ready ──

  if (readying) {
    return (
      <Readying
        setup={setup.data}
        onReady={handOver}
        onOther={() => {
          setReadying(false)
          navigate('/welcome/where', { replace: true })
        }}
      />
    )
  }

  // ── The steps ──

  const lead = setup.data ? pickLead(setup.data.found) : undefined
  const noBuiltin = setup.data && !setup.data.builtin
  const found = (setup.data?.found ?? [])
    // From the Where step, the Hermes already offered as its lead card isn't offered again,
    // and one that's away can't be chosen until it's back.
    .filter((f) => (noBuiltin || f.id !== lead?.id) && !f.away)
    .map(fromFound)

  const form = (other: boolean) => (
    <HermesConnectionFormView
      key={other ? 'other' : 'only'}
      step
      suggest
      round={round}
      found={found}
      onBack={
        other ? () => (pushed.current ? history.back() : navigate('/welcome/where', { replace: true })) : undefined
      }
      below={
        other ? undefined : (
          <button
            type="button"
            onClick={() => setNoHermes(true)}
            className="pressable flex h-11 items-center rounded-full px-4 text-subhead font-medium text-accent select-none hover:bg-fill-1 active:bg-fill-2"
          >
            Don’t have Hermes yet?
          </button>
        )
      }
      onTest={(req: ConnectionRequest) => connectionApi.test(req)}
      onSave={async (req) => {
        if (!builtinChosen) return connectionApi.save(req)
        const added = await connectionsApi.add({ ...req, activate: true })
        return added.connection
      }}
      onChooseFound={async (id) => {
        const result = await choose({ use: 'found', id })
        if (result.ok) {
          arrive(setup.data?.found.find((f) => f.id === id))
          return result.connection
        }
        if (result.reason === 'failed') return result.connection
        if (result.reason === 'decided') {
          const active = result.connections.find((c) => c.id === result.active)
          if (active) handOver(active)
        }
        throw new Error(result.reason === 'gone' ? result.error : 'Something went wrong. Try again.')
      }}
      onConnected={(connection) => {
        // A Hermes chosen by its address: greet whoever's in it (fresh ones go on to shape the first agent).
        if (!readArrived()) arrive(undefined, connection.name)
        handOver(connection)
      }}
    />
  )

  // On the way to Where: draw nothing rather than flash the welcome.
  const redirecting = !screen || (arriving.current && screen === 'welcome' && (welcomed || again))

  const view =
    screen === 'welcome' ? (
      <Welcome
        settled={seenWelcome}
        onContinue={() => {
          markWelcomed()
          setSeenWelcome(true)
          navigate('/welcome/where')
        }}
      />
    ) : screen === 'other' ? (
      form(true)
    ) : noBuiltin ? (
      form(false)
    ) : (
      <WhereStep
        setup={setup.data}
        failed={setup.isError && !setup.data}
        choose={choose}
        refresh={lookAgain}
        onOther={() => {
          pushed.current = true
          navigate('/welcome/where/other')
        }}
        onDecided={(result) => {
          const active = result.connections.find((c) => c.id === result.active)
          if (active) handOver(active)
          else void qc.invalidateQueries({ queryKey: connectionKey })
        }}
        onChosen={(result, { lead: chosen }) => {
          if (chosen) {
            arrive(chosen)
            return handOver(result.connection)
          }
          setBuiltinChosen(true)
          if (result.connection.status === 'connected') return handOver(result.connection)
          // Still on its first start: wait here. When this tab can't carry on in place, it
          // starts afresh on the built-in at once (the gate shows Getting ready there).
          if (result.connection.id === tabHermes() || adoptHermes(result.connection.id)) return setReadying(true)
          window.location.replace('/welcome')
        }}
      />
    )

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={redirecting ? 'none' : screen === 'where' && noBuiltin ? 'only' : screen}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
        >
          {!redirecting && view}
        </motion.div>
      </AnimatePresence>
      <NoHermesSheet
        open={noHermes}
        onOpenChange={(open) => {
          setNoHermes(open)
          // Someone who set Hermes up meanwhile sees it appear.
          if (!open) {
            setRound((r) => r + 1)
            void lookAgain()
          }
        }}
      />
    </>
  )
}

// ── Getting ready ───────────────────────────────────────────────────────────

/**
 * The built-in's first start, wired: asks how it's doing every 1.5s, and once
 * it answers, whether Murmur has signed in to it. Hands over when it has.
 */
function Readying({
  setup,
  onReady,
  onOther,
}: {
  setup?: Setup
  onReady: (connection: HermesConnection) => void
  onOther?: () => void
}) {
  useSetup({ polling: true })
  const up = setup?.builtin?.state === 'ready'
  const builtin = useBuiltinConnection(up)
  return (
    <GettingReady
      state={setup?.builtin?.state}
      connected={builtin?.status === 'connected'}
      onDone={() => builtin && onReady(builtin)}
      onOther={onOther}
    />
  )
}

/** The built-in's connection, asked of it directly (this tab may still be on no Hermes at all). Polled while `enabled`. */
export function useBuiltinConnection(enabled: boolean) {
  const last = useRef<HermesConnection | undefined>(undefined)
  const query = useQuery({
    queryKey: ['murmur', 'connection', BUILTIN_ID],
    queryFn: async () => {
      const res = await fetch('/murmur/connection', { cache: 'no-store', headers: { [HERMES_HEADER]: BUILTIN_ID } })
      const data = (await res.json().catch(() => null)) as HermesConnection | null
      if (!data || !('status' in data)) throw new Error(`Murmur returned ${res.status}`)
      return data
    },
    enabled,
    refetchInterval: (q) => (q.state.data?.status === 'connected' ? false : 1500),
    retry: false,
  })
  if (query.data) last.current = query.data
  return last.current
}
