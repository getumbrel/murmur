import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/ui/button'
import { Label } from '@/ui/field'
import { ListGroup, ListRow } from '@/ui/list'
import { ByUmbrel } from '@/ui/brand'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import { ask } from '@/features/settings/ask'
import { useQuery } from '@tanstack/react-query'
import { useHermesConnection, type ConnectionRequest, type HermesConnection } from '@/state/connection'
import { BUILTIN_ID, fetchSetup, setupKey } from '@/state/setup'
import { BackPill, STEP_COLUMN, StepHeader } from '@/features/onboarding/step'
import { BrandHeader } from './brand-header'
import { Field, Note, PasswordField, StatusDot } from './fields'
import { NearbyList, placeOf, useNearbyHermes, type NearbyHermes } from './nearby'

// "Connect to Hermes": where a standalone Murmur learns which Hermes to use.
// Type an address, Murmur checks it as you leave the field (and opens the
// password fields if that Hermes has one), then Connect tests and saves.
// A Hermes set by the environment, or built into Murmur, shows a read-only
// card instead. In onboarding (`step`) it wears the steps' chrome, and what
// Murmur's server found on its own is offered first.

const UMBREL_HOST = 'hermes-agent_web_1'
const HUE = 278

type Phase = 'idle' | 'connecting' | 'connected'

export type HermesConnectionFormProps = {
  /** What Murmur is connected to now: prefills the form and shows its status. */
  current?: HermesConnection
  onTest: (req: ConnectionRequest) => Promise<HermesConnection>
  onSave: (req: ConnectionRequest) => Promise<HermesConnection>
  /** Offered when the address was saved from here ("Forget this server"). Asks first; throw (after saying why) to stay. */
  onReset?: () => unknown
  /** Called a beat after a successful connect, once the success state has shown. */
  onConnected?: (connection: HermesConnection) => void
  /** Inside Settings: no hero, and the button sits in the flow instead of pinned to the bottom. */
  embedded?: boolean
  /** Look for Hermes on this computer and the network, and offer what answers above the address. */
  suggest?: boolean
  /** Addresses not to offer: the Hermes already added. */
  added?: string[]
  /** An onboarding step: the steps' header (Murmur's mark has just been shown), not the lockup. */
  step?: boolean
  /** With `step`: a Back pill top-left, and Escape goes back too. */
  onBack?: () => void
  /** With `step`: under the button, e.g. "Don't have Hermes yet?". */
  below?: ReactNode
  /** What Murmur's server found on its own, listed before what this page finds. */
  found?: NearbyHermes[]
  /** Use one of `found` by its id (never by its address, which may be a container's name). */
  onChooseFound?: (id: string) => Promise<HermesConnection>
  /** Look around again (after "Don't have Hermes yet?" closes). */
  round?: number
  /** Playground only: start from a given result. */
  initial?: { url?: string; username?: string; password?: string; showAuth?: boolean; result?: HermesConnection; phase?: Phase }
}

/** Wired to the Murmur server. Shows the managed card when the address is set by the environment. */
export function HermesConnectionForm(props: Pick<HermesConnectionFormProps, 'onConnected' | 'embedded'>) {
  const { connection, isLoading, test, save, reset } = useHermesConnection()
  if (isLoading || !connection) {
    return (
      <div className="grid min-h-40 place-items-center text-ink-3">
        <Spinner />
      </div>
    )
  }
  if (connection.managed) return <ManagedHermes connection={connection} />
  return (
    <HermesConnectionFormView
      {...props}
      current={connection}
      // Never set up: offer the Hermes that are likely already there.
      suggest={connection.source === 'default'}
      onTest={test.mutateAsync}
      onSave={save.mutateAsync}
      onReset={
        connection.source === 'saved'
          ? async () => {
              try {
                await reset.mutateAsync()
              } catch (e) {
                toast.error(e instanceof Error && e.message ? e.message : 'Couldn’t forget this server. Try again.')
                throw e
              }
            }
          : undefined
      }
    />
  )
}

export function HermesConnectionFormView({
  current,
  onTest,
  onSave,
  onReset,
  onConnected,
  embedded,
  suggest,
  added,
  step,
  onBack,
  below,
  found: serverFound = [],
  onChooseFound,
  round,
  initial,
}: HermesConnectionFormProps) {
  const known = current && current.source !== 'default' ? current : undefined
  const [url, setUrl] = useState(initial?.url ?? known?.url ?? '')
  const [username, setUsername] = useState(initial?.username ?? known?.username ?? '')
  const [password, setPassword] = useState(initial?.password ?? '')
  const [showAuth, setShowAuth] = useState(initial?.showAuth ?? (known?.mode === 'password' || !!known?.username))
  const [phase, setPhase] = useState<Phase>(initial?.phase ?? 'idle')
  // The answer for the address as typed: from leaving the field, or from Connect.
  const [result, setResult] = useState<HermesConnection | undefined>(initial?.result)
  const [probing, setProbing] = useState(false)
  const probed = useRef<string | undefined>(initial?.result?.url)
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const looked = useNearbyHermes(!!suggest, added, round)
  // The server's finds first; a Hermes it found isn't listed twice.
  const nearby = [...serverFound, ...looked.filter((n) => !serverFound.some((f) => placeOf(f.url) === placeOf(n.url)))]
  // The one picked from that list, while it connects.
  const [picked, setPicked] = useState<string>()

  // Has the person changed anything since the last answer?
  const unchanged = !!known && known.status === 'connected' && sameUrl(url, known.url) && username === (known.username ?? '') && !password
  const status = result?.status
  const savedPassword = !!known?.username && sameUrl(url, known.url) && username === known.username

  const reveal = (focus: 'username' | 'password') => {
    setShowAuth(true)
    // After the disclosure has opened.
    setTimeout(() => (focus === 'username' ? usernameRef : passwordRef).current?.focus(), 320)
  }

  const probe = async () => {
    const address = url.trim()
    if (!address || probed.current === address || phase !== 'idle') return
    probed.current = address
    setProbing(true)
    try {
      const answer = await onTest({ url: address })
      if (probed.current !== address) return
      // Leaving the field only opens doors; problems wait until Connect.
      if (answer.status === 'needs-login') {
        setResult(answer)
        if (!showAuth) reveal('username')
      } else setResult(answer.status === 'connected' ? answer : undefined)
    } catch {
      // Quiet: Connect will say what's wrong.
    } finally {
      setProbing(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim() || phase !== 'idle') return
    setPicked(undefined)
    void connect({ url: url.trim(), ...(showAuth && username.trim() ? { username: username.trim(), password } : {}) })
  }

  /** Something found nearby: straight in, or to the sign-in fields when it has a password. */
  const pick = (n: NearbyHermes) => {
    if (n.outdated || phase !== 'idle') return
    if (n.foundId && onChooseFound && n.connection.status === 'connected') {
      // Chosen by id: its address (perhaps a container's name) never lands in the field.
      setPicked(n.url)
      void connect({ url: n.url }, () => onChooseFound(n.foundId!))
      return
    }
    setUrl(n.url)
    probed.current = n.url
    if (n.connection.status === 'connected') {
      setPicked(n.url)
      void connect({ url: n.url })
      return
    }
    setPicked(undefined)
    setResult(n.connection)
    reveal('username')
  }

  const connect = async (req: ConnectionRequest, via?: () => Promise<HermesConnection>) => {
    setPhase('connecting')
    probed.current = req.url
    let answer: HermesConnection
    try {
      answer = await (via ? via() : onSave(req))
    } catch (error) {
      answer = { url: req.url, managed: false, source: 'saved', mode: 'unknown', status: 'unreachable', error: (error as Error).message }
    }
    // A Hermes chosen by id keeps its address out of the field, whatever the answer.
    if (via) answer = { ...answer, url: url }
    setResult(answer)
    if (answer.status === 'connected') {
      setPhase('connected')
      setPassword('')
      if (!via) setUrl(answer.url)
      setTimeout(() => onConnected?.(answer), 900)
      setTimeout(() => setPhase('idle'), 2400)
      return
    }
    setPhase('idle')
    setPicked(undefined)
    if (answer.status === 'needs-login') reveal(username.trim() ? 'password' : 'username')
    if (answer.status === 'bad-login') passwordRef.current?.select()
  }

  // Escape is Back, as the pill is (not while connecting).
  useEffect(() => {
    if (!onBack || phase !== 'idle') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[data-sheet]')) onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, phase])

  const edit = (set: (v: string) => void, field: 'url' | 'auth') => (v: string) => {
    set(v)
    if (field === 'url') probed.current = undefined
    // A fresh edit clears the complaint about the old value.
    if (result && result.status !== 'connected' && (field === 'url' ? result.status === 'unreachable' : result.status === 'bad-login')) {
      setResult(undefined)
    }
    if (field === 'url' && result?.status === 'connected') setResult(undefined)
  }

  const urlError = status === 'unreachable' ? result?.error : undefined
  const authError = status === 'bad-login' ? result?.error : undefined
  // needs-login normally just opens the fields; anything else it says is worth showing.
  const unsupported = status === 'needs-login' && result?.mode === 'password' && result.error && !/username and password\.$/.test(result.error) ? result.error : undefined

  // Baseline-aligned, so the words (not the dot's box) sit on the label's baseline.
  const hint = probing ? (
    <span className="inline-flex items-baseline gap-1.5">
      <Spinner size={11} className="self-center" />
      Checking…
    </span>
  ) : result?.hermesVersion && status !== 'unreachable' ? (
    <span className="inline-flex items-baseline gap-1.5 text-ink-2 tabular-nums">
      <span className="flex self-center">
        <StatusDot tone={status === 'connected' ? 'success' : 'warning'} />
      </span>
      Hermes {result.hermesVersion}
    </span>
  ) : undefined

  const button = (
    <Button type="submit" size="lg" variant="accent" loading={phase === 'connecting'} disabled={!url.trim() || (unchanged && phase === 'idle')} className={cn(phase === 'connected' && 'bg-success! text-accent-ink! opacity-100!')}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={phase === 'connected' ? 'done' : 'connect'}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          className="inline-flex items-center gap-2"
        >
          {phase === 'connected' ? (
            <>
              <Check size={18} strokeWidth={2.5} /> Connected
            </>
          ) : (
            'Connect'
          )}
        </motion.span>
      </AnimatePresence>
    </Button>
  )

  const fields = (
    <>
      {(suggest || serverFound.length > 0) && <NearbyList found={nearby} picked={picked} phase={phase} onPick={pick} />}
      <div>
        <Label hint={hint}>Address</Label>
        <Field
          value={url}
          onChange={(e) => edit(setUrl, 'url')(e.target.value)}
          onBlur={probe}
          placeholder="http://192.168.1.20:9119"
          inputMode="url"
          type="url"
          autoComplete="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Hermes address"
          invalid={!!urlError}
        />
        <Note tone="danger">{urlError}</Note>
      </div>

      <div className="mt-5">
        <button
          type="button"
          onClick={() => (showAuth ? setShowAuth(false) : reveal('username'))}
          aria-expanded={showAuth}
          // px-4: the words start on the Label line above, like every label.
          className="pressable flex min-h-11 items-center gap-1.5 rounded-md px-4 text-subhead text-ink-2 select-none hover:text-ink active:text-ink"
        >
          This Hermes needs a password
          <ChevronDown size={16} className={cn('transition-transform duration-300 ease-[var(--ease-out)]', showAuth && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {showAuth && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.26, ease: [0.32, 0.72, 0, 1] } }}
              transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
              className="-mx-1 overflow-hidden px-1"
            >
              <div className="space-y-3 pt-2 pb-1">
                <Field
                  ref={usernameRef}
                  value={username}
                  onChange={(e) => edit(setUsername, 'auth')(e.target.value)}
                  placeholder="Username"
                  aria-label="Username"
                  autoComplete="username"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  invalid={!!authError}
                />
                <PasswordField
                  ref={passwordRef}
                  value={password}
                  onChange={(e) => edit(setPassword, 'auth')(e.target.value)}
                  placeholder={savedPassword ? 'Saved' : 'Password'}
                  aria-label="Password"
                  autoComplete="current-password"
                  invalid={!!authError}
                />
              </div>
              <Note tone={authError || unsupported ? 'danger' : 'quiet'}>{authError ?? unsupported ?? 'Murmur keeps this password on its server, never in your browser.'}</Note>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )

  if (embedded) {
    return (
      <form onSubmit={submit} noValidate>
        {known && <CurrentStatus connection={known} onForget={onReset} />}
        <div className={cn(known && 'mt-6')}>{fields}</div>
        <AnimatePresence initial={false}>
          {(!unchanged || phase !== 'idle') && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] } }}
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
              className="overflow-hidden"
            >
              <div className="pt-6">{button}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </form>
    )
  }

  if (step) {
    return (
      <form
        onSubmit={submit}
        noValidate
        className={`relative flex min-h-dvh flex-col safe-top md:justify-center md:py-12 ${STEP_COLUMN}`}
        style={{ '--hue': HUE } as React.CSSProperties}
      >
        <StepHeader
          animate
          focus
          title="Connect to Hermes"
          body="Murmur works with any Hermes. Pick one it found, or enter its address."
          before={onBack && <BackPill onClick={onBack} disabled={phase !== 'idle'} />}
          className="pb-8 md:pt-0"
        />
        <div className="flex-1 animate-rise [animation-delay:120ms] md:flex-none">{fields}</div>
        {/* Phones: pinned under the thumb. Wide: right under the fields. */}
        <div className="sticky bottom-0 -mx-5 bg-bg px-5 pt-3 pb-[max(24px,env(safe-area-inset-bottom))] md:static md:pt-9 md:pb-0">
          {button}
          {below && <div className="mt-3 flex justify-center">{below}</div>}
          <div className={cn('flex justify-center md:mt-8', below ? 'mt-2' : 'mt-5')}>
            <ByUmbrel />
          </div>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-dvh flex-col bg-bg safe-top md:justify-center md:py-12" style={{ '--hue': HUE } as React.CSSProperties}>
      {/* The pre-app column: the app's 20px gutter, as wide as the onboarding steps that follow. */}
      <div className="mx-auto w-full max-w-[30rem] flex-1 px-5 pt-14 md:flex-none md:pt-0">
        {/* Connected: the two of them hop, then the app takes over. */}
        <BrandHeader
          hop={phase === 'connected'}
          title="Connect to Hermes"
          body="Murmur works with any Hermes. Pick one it found, or enter its address."
        />
        <div className="mt-9">{fields}</div>
      </div>
      {/* Phones: pinned under the thumb. Wide: right under the fields, not a screen away. Signed like Welcome, in the same spot. */}
      <div className="sticky bottom-0 mx-auto w-full max-w-[30rem] bg-bg px-5 pt-3 pb-[max(24px,env(safe-area-inset-bottom))] md:static md:pt-9 md:pb-0">
        {button}
        <div className="mt-5 flex justify-center md:mt-8">
          <ByUmbrel />
        </div>
      </div>
    </form>
  )
}

/**
 * How Murmur is doing with a Hermes, one list row: a dot, a word, then where
 * and which version. Every Hermes card says it the same way, saved or set by
 * the environment. With `onForget`, the way out sits in the same group, as
 * iOS puts "Forget This Network": well away from any button that goes on.
 */
export function CurrentStatus({
  connection: c,
  onForget,
  forgetAsk,
  footer,
  starting,
}: {
  connection: HermesConnection
  onForget?: () => unknown
  /** What "Forget this server" asks first, when this one deserves its own words. */
  forgetAsk?: { title: string; body: string }
  footer?: string
  /** The built-in, on its first start. */
  starting?: boolean
}) {
  const [forgetting, setForgetting] = useState(false)
  const umbrel = isUmbrelHermes(c)
  const builtin = isBuiltinHermes(c)
  const ok = c.status === 'connected'
  const tone = ok ? 'success' : starting || c.status === 'needs-login' || c.status === 'bad-login' ? 'warning' : 'danger'
  const title = ok
    ? 'Connected'
    : builtin && starting
      ? 'Starting up'
      : c.status === 'unreachable'
        ? builtin
          ? 'Not responding'
          : 'Can’t reach Hermes'
        : 'Needs signing in'
  const where = builtin ? 'Comes with Murmur' : umbrel ? 'On this Umbrel' : hostOf(c.url)
  const subtitle =
    builtin && !ok && !starting
      ? 'Try restarting Murmur.'
      : umbrel && c.status === 'unreachable'
        ? 'Check that the Hermes Agent app is running.'
        : [where, ok && c.hermesVersion && `Hermes\u00a0${c.hermesVersion}`].filter(Boolean).join(' · ')

  const forget = async () => {
    if (!onForget || forgetting) return
    const yes = await ask({
      title: forgetAsk?.title ?? 'Forget this server?',
      body: forgetAsk?.body ?? 'Murmur will stop using this address. Your agents and chats stay in Hermes.',
      action: 'Forget',
      destructive: true,
    })
    if (!yes) return
    setForgetting(true)
    try {
      await onForget()
    } catch {
      // The caller has said what went wrong.
    } finally {
      setForgetting(false)
    }
  }

  return (
    <ListGroup footer={footer}>
      <ListRow icon={<StatusDot tone={tone} />} title={title} subtitle={subtitle} />
      {onForget && (
        <ListRow
          title="Forget this server"
          destructive
          onClick={forgetting ? undefined : () => void forget()}
          trailing={forgetting ? <Spinner size={16} className="flex-none text-ink-3" /> : undefined}
        />
      )}
    </ListGroup>
  )
}

/** Whether this is the Hermes Agent app on this Umbrel (at its fixed address), saved or set by umbrelOS. */
export function isUmbrelHermes(c: Pick<HermesConnection, 'url'> | undefined) {
  return !!c && hostOf(c.url).startsWith(UMBREL_HOST)
}

/** Whether this is the Hermes that comes with Murmur. */
export function isBuiltinHermes(c: Pick<HermesConnection, 'id' | 'source'> | undefined) {
  return !!c && (c.id === BUILTIN_ID || c.source === 'builtin')
}

/**
 * Whether this Murmur runs on umbrelOS, for copy that names it ("Use a model
 * on this Umbrel"). The Hermes Agent app says so by its address; with the
 * built-in in use, Murmur's server says so.
 */
export function useOnUmbrel() {
  const c = useHermesConnection().connection
  const viaServer = !!c && !isUmbrelHermes(c) && isBuiltinHermes(c)
  const setup = useQuery({ queryKey: setupKey, queryFn: fetchSetup, enabled: viaServer, staleTime: 5 * 60_000, retry: false })
  return isUmbrelHermes(c) || (viaServer && !!setup.data?.umbrel)
}

/** Read-only: the built-in, or an address from Murmur's environment. */
export function ManagedHermes({ connection: c, starting }: { connection: HermesConnection; starting?: boolean }) {
  return (
    <CurrentStatus
      connection={c}
      starting={starting}
      footer={
        isBuiltinHermes(c)
          ? 'Comes with Murmur, and only Murmur can reach it. Its agents and chats are kept with Murmur’s data.'
          : isUmbrelHermes(c)
            ? 'Your Umbrel connects Murmur to Hermes for you.'
            : 'This address is set in Murmur’s server configuration.'
      }
    />
  )
}

function hostOf(url: string) {
  try {
    const u = new URL(url)
    return u.host + u.pathname.replace(/\/$/, '')
  } catch {
    return url
  }
}

function sameUrl(a: string, b: string) {
  const clean = (s: string) => s.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()
  return clean(a) === clean(b)
}

