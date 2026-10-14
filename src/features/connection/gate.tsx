import { useEffect, useState, type ReactNode } from 'react'
import { followSwitches, liftCurtain, needsConnectionSetup, useHermesConnection, useMurmurSession } from '@/state/connection'
import { adoptHermes, browserHermes, tabHermes } from '@/hermes/instance'
import { HermesConnectionForm } from './hermes-connection-form'
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
 * Puts "Connect to Hermes" in front of the app when this Murmur has never been
 * pointed at a Hermes (standalone first run) or its saved password stopped
 * working. A Hermes that is merely down is left to the app's own offline banner.
 * Mount inside the QueryClientProvider.
 */
export function HermesGate({ children }: { children: ReactNode }) {
  const { connection, isLoading, refetch } = useHermesConnection()
  const [done, setDone] = useState(false)
  if (isLoading) return <div className="min-h-dvh bg-bg" />
  if (!done && needsConnectionSetup(connection)) return <SetUp onConnected={() => setDone(true)} />
  // Too old for what Murmur needs: say so, rather than load an app that half works.
  if (connection?.outdated) return <UpdateHermes connection={connection} onCheck={refetch} />
  return (
    <>
      {children}
      <CurtainLift />
    </>
  )
}

function SetUp({ onConnected }: { onConnected: () => void }) {
  // Nothing else will draw, so the curtain (if a switch landed here) lifts onto the form.
  useEffect(liftCurtain, [])
  return <HermesConnectionForm onConnected={onConnected} />
}
