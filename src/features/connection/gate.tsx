import { useEffect, useRef, useState, type ReactNode } from 'react'
import { followSwitches, liftCurtain, needsConnectionSetup, useHermesConnection, useMurmurSession } from '@/state/connection'
import { useSetup } from '@/state/setup'
import { restartBoot } from '@/state/readiness'
import { adoptHermes, browserHermes, tabHermes } from '@/hermes/instance'
import { SetupFlow, takeFlight } from '@/features/onboarding/setup-flow'
import { GettingReady } from '@/features/onboarding/getting-ready'
import { HermesConnectionForm, isBuiltinHermes } from './hermes-connection-form'
import { LoginScreen } from './login'
import { CurtainLift, SwitchCurtain } from './curtain'
import { UpdateHermes } from './update-hermes'

let following = false

/**
 * Murmur's own sign-in. Wrap the whole app *outside* its QueryClientProvider
 * (in main.tsx) so nothing, the Hermes socket included, starts before it.
 * Renders children straight away when the server has no MURMUR_PASSWORD.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  return (
    <>
      <Access>{children}</Access>
      {/* Switching Hermes: over everything, from before the app loads until it's drawn. */}
      <SwitchCurtain />
    </>
  )
}

function Access({ children }: { children: ReactNode }) {
  const { session, error, signIn, clearError } = useMurmurSession()
  // Signed in from this screen: keep it up for its success beat, then hand over.
  const [welcoming, setWelcoming] = useState(false)
  useEffect(() => {
    if (following) return
    following = true
    followSwitches()
  }, [])
  useEffect(() => {
    if (!session) return
    // A first visit can load before the server has named this browser's Hermes
    // (the page came from elsewhere, as in development). It has by now: carry
    // on with it, or start over when its things are kept apart.
    const named = browserHermes()
    if (named && !tabHermes() && !adoptHermes(named)) location.reload()
    // Signed out on the far side of a switch: the sign-in screen is what's drawn.
    if (session.required && !session.signedIn) liftCurtain()
  }, [session])
  if (!session) return <div className="min-h-dvh bg-bg" />
  if ((session.required && !session.signedIn) || welcoming) {
    return (
      <LoginScreen
        onSubmit={async (password) => {
          const ok = await signIn(password)
          if (ok) setWelcoming(true)
          return ok
        }}
        error={error}
        onEdit={clearError}
        onSignedIn={() => setWelcoming(false)}
      />
    )
  }
  return <>{children}</>
}

/**
 * In front of the app until it has a Hermes to talk to:
 * - never chosen: the setup flow (Welcome, then "Where should your agents
 *   live?"), started while the server's look around is still out;
 * - the built-in, on its first start: Getting ready, so a reload mid-start
 *   comes back to it rather than to the offline banner;
 * - a saved password that stopped working: "Connect to Hermes".
 * A Hermes that is merely down is left to the app's own offline banner.
 * Mount inside the QueryClientProvider and the Router.
 */
export function HermesGate({ children }: { children: ReactNode }) {
  const { connection, isLoading, refetch } = useHermesConnection()
  const [done, setDone] = useState(false)
  // Backed out of a slow first start to choose something else.
  const [rechoosing, setRechoosing] = useState(false)
  const undecided = connection?.source === 'default'
  const starting = !!connection && isBuiltinHermes(connection) && connection.status !== 'connected'
  // Asked as soon as the gate mounts, so the server looks around while the welcome plays.
  const setup = useSetup({ enabled: undecided || starting || rechoosing, polling: starting && !rechoosing })
  const builtin = setup.data?.builtin

  // Getting ready, once the built-in has been seen starting; it stays up through "All set".
  const [readying, setReadying] = useState<'no' | 'yes' | 'done'>('no')
  const seenStarting = starting && builtin?.state === 'starting' && readying === 'no'
  useEffect(() => {
    if (seenStarting) setReadying('yes')
  }, [seenStarting])
  // It answered: see whether Murmur is in.
  const lastState = useRef(builtin?.state)
  useEffect(() => {
    if (starting && builtin?.state === 'ready' && lastState.current !== 'ready') void refetch()
    lastState.current = builtin?.state
  }, [starting, builtin?.state, setup.dataUpdatedAt])
  useEffect(() => {
    if (!starting || builtin?.state !== 'ready') return
    const t = setInterval(() => void refetch(), 1500)
    return () => clearInterval(t)
  }, [starting, builtin?.state])

  // An older Murmur server has no setup step: its first run is the connection form, as it was.
  const noSetupStep = setup.error?.message === 'Murmur returned 404'
  const choosing = rechoosing || (undecided && !noSetupStep && setup.data?.decided !== true)
  // Once the flow is up it stays until it hands over: the choice makes the server "decided" a beat before this tab moves.
  const [inFlow, setInFlow] = useState(false)
  useEffect(() => {
    if (choosing) setInFlow(true)
  }, [choosing])

  if (isLoading) return <div className="min-h-dvh bg-bg" />
  if (choosing || inFlow) {
    return (
      <SetupFlow
        again={rechoosing}
        onHandedOver={() => {
          setInFlow(false)
          setRechoosing(false)
        }}
      />
    )
  }
  if (readying === 'yes' || seenStarting) {
    return (
      <Ready
        state={builtin?.state}
        connected={connection?.status === 'connected'}
        onDone={() => {
          restartBoot()
          setReadying('done')
        }}
        onOther={() => setRechoosing(true)}
      />
    )
  }
  // The built-in, still unknown: a moment's blank beats an offline banner that's about to be wrong.
  if (starting && setup.isPending && readying === 'no') return <div className="min-h-dvh bg-bg" />
  if (!done && needsConnectionSetup(connection))
    return (
      <SetUp
        onConnected={() => {
          restartBoot()
          setDone(true)
        }}
      />
    )
  // Too old for what Murmur needs: say so, rather than load an app that half works.
  if (connection?.outdated) return <UpdateHermes connection={connection} onCheck={refetch} />
  return (
    <>
      {children}
      <CurtainLift />
    </>
  )
}

function Ready(props: Parameters<typeof GettingReady>[0]) {
  // Nothing else will draw, so a switch curtain lifts onto this.
  useEffect(liftCurtain, [])
  // Just tapped Start fresh (before this reload): the buddy flies in from there.
  const [from] = useState(takeFlight)
  return <GettingReady {...props} from={from} />
}

function SetUp({ onConnected }: { onConnected: () => void }) {
  // Nothing else will draw, so the curtain (if a switch landed here) lifts onto the form.
  useEffect(liftCurtain, [])
  return <HermesConnectionForm onConnected={onConnected} />
}
