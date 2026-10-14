import { useRef, useState, type FormEvent } from 'react'
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
import { useHermesConnection, type ConnectionRequest, type HermesConnection } from '@/state/connection'
import { BrandHeader } from './brand-header'
import { Field, Note, PasswordField, StatusDot } from './fields'

// "Connect to Hermes": where a standalone Murmur learns which Hermes to use.
// Type an address, Murmur checks it as you leave the field (and opens the
// password fields if that Hermes has one), then Connect tests and saves.
// On umbrelOS the address is fixed, so it shows a read-only card instead.

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

export function HermesConnectionFormView({ current, onTest, onSave, onReset, onConnected, embedded, initial }: HermesConnectionFormProps) {
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

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim() || phase !== 'idle') return
    setPhase('connecting')
    probed.current = url.trim()
    const req: ConnectionRequest = { url: url.trim(), ...(showAuth && username.trim() ? { username: username.trim(), password } : {}) }
    let answer: HermesConnection
    try {
      answer = await onSave(req)
    } catch (error) {
      answer = { url: req.url, managed: false, source: 'saved', mode: 'unknown', status: 'unreachable', error: (error as Error).message }
    }
    setResult(answer)
    if (answer.status === 'connected') {
      setPhase('connected')
      setPassword('')
      setUrl(answer.url)
      setTimeout(() => onConnected?.(answer), 900)
      setTimeout(() => setPhase('idle'), 2400)
      return
    }
    setPhase('idle')
    if (answer.status === 'needs-login') reveal(username.trim() ? 'password' : 'username')
    if (answer.status === 'bad-login') passwordRef.current?.select()
  }

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

  return (
    <form onSubmit={submit} noValidate className="flex min-h-dvh flex-col bg-bg safe-top md:justify-center md:py-12" style={{ '--hue': HUE } as React.CSSProperties}>
      {/* The pre-app column: the app's 20px gutter, as wide as the onboarding steps that follow. */}
      <div className="mx-auto w-full max-w-[30rem] flex-1 px-5 pt-14 md:flex-none md:pt-0">
        {/* Connected: the two of them hop, then the app takes over. */}
        <BrandHeader
          hop={phase === 'connected'}
          title="Connect to Hermes"
          body="Murmur works with any Hermes Agent. Enter the address of its dashboard."
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
function CurrentStatus({ connection: c, onForget, footer }: { connection: HermesConnection; onForget?: () => unknown; footer?: string }) {
  const [forgetting, setForgetting] = useState(false)
  const umbrel = isUmbrelHermes(c)
  const ok = c.status === 'connected'
  const tone = ok ? 'success' : c.status === 'needs-login' || c.status === 'bad-login' ? 'warning' : 'danger'
  const title = ok ? 'Connected' : c.status === 'unreachable' ? 'Can’t reach Hermes' : 'Needs signing in'
  const where = umbrel ? 'On this Umbrel' : hostOf(c.url)
  const subtitle =
    umbrel && c.status === 'unreachable'
      ? 'Check that the Hermes Agent app is running.'
      : [where, c.hermesVersion && `Hermes\u00a0${c.hermesVersion}`].filter(Boolean).join(' · ')

  const forget = async () => {
    if (!onForget || forgetting) return
    const yes = await ask({
      title: 'Forget this server?',
      body: 'Murmur will stop using this address. Your agents and chats stay in Hermes.',
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

/** Whether this is the Hermes app on this Umbrel (set by umbrelOS, at its fixed address). */
export function isUmbrelHermes(c: Pick<HermesConnection, 'managed' | 'url'> | undefined) {
  return !!c?.managed && hostOf(c.url).startsWith(UMBREL_HOST)
}

/** Whether this Murmur runs on umbrelOS (its Hermes is the Umbrel app), for copy that names it. */
export function useOnUmbrel() {
  return isUmbrelHermes(useHermesConnection().connection)
}

/** Read-only: the address comes from Murmur's environment (umbrelOS sets it). */
export function ManagedHermes({ connection: c }: { connection: HermesConnection }) {
  return (
    <CurrentStatus
      connection={c}
      footer={isUmbrelHermes(c) ? 'Your Umbrel connects Murmur to Hermes for you.' : 'This address is set in Murmur’s server configuration.'}
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

