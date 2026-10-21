import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, ChevronRight, RefreshCw } from 'lucide-react'
import { Button } from '@/ui/button'
import { Buddy, type BuddyState } from '@/ui/buddy'
import { ByUmbrel } from '@/ui/brand'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import { usePrefersReducedMotion } from '@/lib/use-media'
import { Tile } from '@/features/settings/page'
import { Field, Note, PasswordField, StatusDot } from '@/features/connection/fields'
import {
  agentNames,
  countLine,
  orderedAgents,
  pickLead,
  recommended,
  type BuiltinState,
  type Choice,
  type ChoiceResult,
  type FoundHermes,
  type Setup,
} from '@/state/setup'
import { agentHue, problemLine, useLabel, whereBody } from './setup-copy'
import { STEP_COLUMN, StepHeader } from './step'
import { IconChip, LockIcon, ServerIcon } from '@/ui/icons'

// "Where should your agents live?": the one question onboarding can't answer
// for you. If a Hermes is already here (the Hermes Agent app on this Umbrel,
// most often), it leads, showing its agents' own faces, with one button to
// keep using them; starting fresh with the Hermes built into Murmur sits under
// it. With nothing found, starting fresh leads. Everything here is driven by
// props, so the playground can show every state (onboarding.html?screen=where).

const HUE = 278
const ease = [0.16, 1, 0.3, 1] as const
/** Buddies shown on a card before the rest become "+N". */
const FACES = 5

export type Chosen = Extract<ChoiceResult, { ok: true }>

export type WhereProps = {
  /** Undefined while Murmur is still looking. */
  setup?: Setup
  /** Murmur's own server didn't answer. */
  failed?: boolean
  /** Known before the answer (say "on this Umbrel" while looking). */
  umbrel?: boolean
  choose: (choice: Choice) => Promise<ChoiceResult>
  /** Ask again: "Check again", "Try again", or after a Hermes went missing. */
  refresh: () => Promise<Setup | undefined>
  /**
   * Chosen, and its moment has played: carry on. `from` is where the Start
   * fresh buddy stood, so Getting ready can fly it in.
   */
  onChosen: (result: Chosen, how: { lead?: FoundHermes }) => void
  /** Another browser chose first: follow it. */
  onDecided: (result: Extract<ChoiceResult, { reason: 'decided' }>) => void
  /** "Connect a different Hermes…" / "I already have Hermes". */
  onOther: () => void
  /** Playground only. */
  initial?: {
    busy?: 'found' | 'fresh'
    done?: boolean
    signIn?: { username?: string; password?: string; error?: string }
    note?: string
  }
}

type Busy = 'found' | 'fresh' | null

export function WhereStep({
  setup,
  failed,
  umbrel,
  choose,
  refresh,
  onChosen,
  onDecided,
  onOther,
  initial,
}: WhereProps) {
  const reduced = usePrefersReducedMotion()
  // The lead is settled once it's on screen: a Hermes that answers later never reshuffles the options.
  const [leadId, setLeadId] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (setup && leadId === undefined) setLeadId(pickLead(setup.found)?.id ?? null)
  }, [setup, leadId])
  const lead = leadId ? setup?.found.find((f) => f.id === leadId) : undefined
  // What a failed choice taught us before the server says so (it went out of date, or wants a password).
  const [patch, setPatch] = useState<Partial<FoundHermes>>({})
  const shown = lead && { ...lead, ...patch }
  const [busy, setBusy] = useState<Busy>(initial?.busy ?? null)
  const [done, setDone] = useState(!!initial?.done)
  // Why the last try didn't work, under the card's button.
  const [note, setNote] = useState<string | undefined>(initial?.note)

  const builtin = setup?.builtin
  const builtinDown = builtin?.state === 'unreachable' || builtin?.state === 'outdated'
  const onUmbrel = setup?.umbrel ?? umbrel

  const looking = !setup && !failed
  const body = failed ? (
    'Murmur couldn’t look for your Hermes just now.'
  ) : looking ? (
    <span className="text-shimmer">
      {onUmbrel ? 'Looking for Hermes on this Umbrel…' : 'Looking for Hermes nearby…'}
    </span>
  ) : (
    whereBody(shown)
  )

  // ── Choosing ──

  const useFound = async (creds?: {
    username: string
    password: string
  }): Promise<'ok' | 'bad-login' | 'needs-login' | 'error'> => {
    if (!shown || busy) return 'error'
    setBusy('found')
    setNote(undefined)
    let result: ChoiceResult
    try {
      result = await choose({ use: 'found', id: shown.id, ...creds })
    } catch (e) {
      setBusy(null)
      setNote(e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.')
      return 'error'
    }
    if (result.ok) {
      setDone(true)
      haptic('tick')
      // The card's buddies hop for joy; then the step leaves.
      setTimeout(() => onChosen(result, { lead: shown }), reduced ? 400 : 700)
      return 'ok'
    }
    setBusy(null)
    if (result.reason === 'decided') {
      onDecided(result)
      return 'error'
    }
    if (result.reason === 'gone') {
      const next = await refresh().catch(() => undefined)
      if (!next?.found.some((f) => f.id === shown.id)) {
        toast(`${shown.name} isn’t answering anymore.`)
        setLeadId(null)
        setPatch({})
      }
      return 'error'
    }
    const c = result.connection
    if (c.outdated) {
      setPatch({ outdated: true, version: c.hermesVersion ?? shown.version })
      return 'error'
    }
    if (c.status === 'needs-login') {
      setPatch({ needsSignIn: true })
      return 'needs-login'
    }
    if (c.status === 'bad-login') return 'bad-login'
    setNote(
      shown.where === 'umbrel'
        ? 'Couldn’t reach Hermes Agent. Check that the app is running on your Umbrel, then try again.'
        : 'Couldn’t reach this Hermes. Check that it’s running, then try again.',
    )
    return 'error'
  }

  const startFresh = async () => {
    if (busy || builtinDown) return
    setBusy('fresh')
    try {
      const result = await choose({ use: 'builtin' })
      if (result.ok) return onChosen(result, {})
      if (result.reason === 'decided') return onDecided(result)
      throw new Error()
    } catch {
      toast.error('Couldn’t start fresh. Try again.')
    }
    setBusy(null)
  }

  // ── Layout ──

  const settled = !!setup
  const rise = (delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
      : {
          initial: { opacity: 0, y: 8, scale: 0.97 },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: { duration: 0.38, ease, delay },
        }

  let options: ReactNode = null
  let link: ReactNode = null
  if (failed) {
    options = <CantReach onRetry={refresh} />
  } else if (settled && shown) {
    options = (
      <>
        <motion.div key={`lead-${shown.id}`} {...rise(0.12)}>
          <FoundCard
            hermes={shown}
            busy={busy}
            done={done}
            note={note}
            onUse={useFound}
            onCheck={async () => {
              setPatch({})
              return refresh()
            }}
            initialSignIn={initial?.signIn}
            locked={busy === 'fresh'}
          />
        </motion.div>
        <motion.div
          key="fresh-row"
          {...rise(0.19)}
          className={cn(dim(busy === 'found' || done))}
          inert={busy === 'found' || done}
        >
          <ChoiceRow
            leading={
              <span className="grid size-11 place-items-center">
                <Buddy hue={HUE} size={28} seed="default" state={builtinDown ? 'offline' : 'idle'} />
              </span>
            }
            title="Start fresh"
            subtitle={
              builtinDown
                ? 'Not available right now'
                : shown.outdated || shown.away
                  ? `Or start fresh now, and add ${shown.where === 'umbrel' ? 'Hermes Agent' : 'this Hermes'} later in Settings`
                  : 'A new home for your agents, built into Murmur'
            }
            busy={busy === 'fresh'}
            disabled={builtinDown || !builtin}
            onClick={startFresh}
          />
        </motion.div>
      </>
    )
    link = (
      <QuietLink onClick={onOther} hidden={busy !== null || done}>
        Connect a different Hermes…
      </QuietLink>
    )
  } else if (settled) {
    options = (
      <>
        <motion.div key="fresh-card" {...rise(0.12)}>
          <FreshCard
            state={builtin?.state}
            busy={busy === 'fresh'}
            onStart={startFresh}
            onCheck={refresh}
          />
        </motion.div>
        <motion.div key="have-row" {...rise(0.19)} className={dim(busy === 'fresh')} inert={busy === 'fresh'}>
          <ChoiceRow
            leading={
              <span className="grid size-11 place-items-center">
                <IconChip icon={ServerIcon} size={44} radius={12} />
              </span>
            }
            title="I already have Hermes"
            subtitle={onUmbrel ? 'Connect one on your network' : 'Connect one on this computer or your network'}
            onClick={onOther}
          />
        </motion.div>
      </>
    )
  }

  return (
    <main
      className={`relative flex min-h-dvh flex-col safe-top md:justify-center md:py-12 ${STEP_COLUMN}`}
      style={{ '--hue': HUE } as CSSProperties}
    >
      <StepHeader
        animate
        focus
        live
        title="Where should your agents live?"
        body={
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={looking ? 'looking' : failed ? 'failed' : 'answer'}
              className="inline-block"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {body}
            </motion.span>
          </AnimatePresence>
        }
        className="pb-8 md:pt-0"
      />
      <div className="space-y-3">{options}</div>
      <div className="mt-auto flex flex-col items-center pt-6 pb-[max(24px,env(safe-area-inset-bottom))] md:mt-0 md:pt-6 md:pb-0">
        {link && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: reduced ? 0 : 0.26 }}
          >
            {link}
          </motion.div>
        )}
        <motion.div
          className="mt-3 md:mt-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: reduced ? 0 : 0.26 }}
        >
          <ByUmbrel />
        </motion.div>
      </div>
    </main>
  )
}

/** While one choice is in flight, the others step back and can't be pressed. */
const dim = (on: boolean) => cn('transition-opacity duration-200', on && 'pointer-events-none opacity-50')

// ── A Hermes that's already here ────────────────────────────────────────────

function FoundCard({
  hermes: f,
  busy,
  done,
  note,
  locked,
  onUse,
  onCheck,
  initialSignIn,
}: {
  hermes: FoundHermes
  busy: Busy
  done: boolean
  note?: string
  /** Start fresh is in flight. */
  locked: boolean
  onUse: (creds?: { username: string; password: string }) => Promise<'ok' | 'bad-login' | 'needs-login' | 'error'>
  onCheck: () => Promise<unknown>
  initialSignIn?: { username?: string; password?: string; error?: string }
}) {
  const titleId = useId()
  const metaId = useId()
  const agents = orderedAgents(f)
  const total = Math.max(f.agentCount ?? 0, agents.length)
  const badge = recommended(f)
  const state: 'ready' | 'outdated' | 'signin' | 'away' = f.away
    ? 'away'
    : f.outdated
      ? 'outdated'
      : f.needsSignIn
        ? 'signin'
        : 'ready'
  // Away after needing an update: it's updating, and Murmur is waiting for it.
  const updating = state === 'away' && !!f.outdated

  // Out of date or away, then back and usable: the buddies wake with a hop, the badge pops in.
  const [waking, setWaking] = useState(false)
  const was = useRef(state)
  useEffect(() => {
    if ((was.current === 'outdated' || was.current === 'away') && state === 'ready') {
      setWaking(true)
      const t = setTimeout(() => setWaking(false), 1200)
      was.current = state
      return () => clearTimeout(t)
    }
    was.current = state
  }, [state])

  const [checking, setChecking] = useState(false)
  const [stillOld, setStillOld] = useState(false)
  const check = async () => {
    setChecking(true)
    setStillOld(false)
    try {
      await onCheck()
    } finally {
      setChecking(false)
    }
  }
  // "Check again" came back and it's still too old: say so, so the tap visibly did something.
  const checked = useRef(false)
  useEffect(() => {
    if (checking) checked.current = true
    else if (checked.current) {
      checked.current = false
      if (state === 'outdated') setStillOld(true)
    }
  }, [checking, state])

  const face: BuddyState =
    done || waking ? 'done' : state === 'outdated' || state === 'away' ? 'offline' : 'idle'

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={metaId}
      aria-label={badge ? `${f.name}, recommended` : undefined}
      className="rounded-2xl bg-elevated p-5 shadow-float ring-1 ring-line-strong ring-inset"
    >
      <div className={cn('flex min-h-9 items-center justify-between gap-3', dim(locked))}>
        {state === 'signin' && !agents.length ? (
          <Tile>
            <LockIcon size={19} />
          </Tile>
        ) : agents.length ? (
          <Faces agents={agents} total={total} state={face} />
        ) : (
          <Tile>
            <ServerIcon size={19} />
          </Tile>
        )}
        <AnimatePresence mode="popLayout" initial={false}>
          {state === 'ready' && badge ? (
            <motion.span
              key="badge"
              className="inline-flex h-6 flex-none items-center rounded-full bg-accent-soft px-2.5 text-caption font-semibold text-accent"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', duration: 0.38, bounce: 0.3 }}
            >
              Recommended
            </motion.span>
          ) : state !== 'ready' ? (
            <motion.span
              key={state}
              className="inline-flex flex-none items-center gap-1.5 text-caption font-medium text-ink-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {updating ? <Spinner size={12} className="text-ink-3" /> : <StatusDot tone="warning" />}
              {updating
                ? 'Updating'
                : state === 'away'
                  ? 'Not answering'
                  : state === 'outdated'
                    ? 'Needs an update'
                    : 'Needs a password'}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      <div className={dim(locked)}>
        <h2 id={titleId} className="mt-4 text-title font-semibold tracking-[-0.02em] text-balance">
          {f.name}
        </h2>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={state}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {state === 'ready' && agents.length > 0 && (
              <p className="mt-0.5 text-subhead text-pretty">{agentNames(f)}</p>
            )}
            <p id={metaId} className="mt-0.5 text-footnote text-ink-2">
              {state === 'ready' ? countLine(f) || (f.where === 'umbrel' ? 'On this Umbrel' : f.host) : problemLine(f)}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {state === 'away' ? (
        // Nothing to do but wait, where its button will be: Murmur keeps looking, and the card wakes when it's back.
        <motion.p
          className="mt-5 flex h-13 items-center justify-center rounded-full bg-fill-1 px-6 text-center text-subhead"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <span className="text-shimmer">
            {updating
              ? 'Waiting for the update to finish…'
              : `Waiting for ${f.where === 'umbrel' ? 'Hermes Agent' : 'it'} to come back…`}
          </span>
        </motion.p>
      ) : state === 'outdated' ? (
        <div className="mt-5">
          <div className="rounded-xl bg-fill-1 px-4 py-3.5 text-subhead text-pretty text-ink-2">
            {f.where === 'umbrel' ? (
              <>
                Open the <span className="font-medium text-ink">App Store</span> on your Umbrel, find{' '}
                <span className="font-medium text-ink">Hermes Agent</span> and tap{' '}
                <span className="font-medium text-ink">Update</span>.
              </>
            ) : (
              <>
                On the computer running Hermes, run{' '}
                <code className="rounded-sm bg-fill-2 px-1 py-0.5 font-mono text-footnote text-ink">hermes update</code>
                , then restart it.
              </>
            )}
          </div>
          <Button size="lg" variant="secondary" className="mt-4" loading={checking} onClick={check} disabled={locked}>
            <RefreshCw size={17} strokeWidth={2} aria-hidden />
            Check again
          </Button>
          <Note>
            {stillOld
              ? `Still Hermes ${f.version ?? 'the older version'}. Updates can take a few minutes to finish.`
              : undefined}
          </Note>
        </div>
      ) : state === 'signin' ? (
        <SignIn hermes={f} busy={busy === 'found'} done={done} locked={locked} onUse={onUse} initial={initialSignIn} />
      ) : (
        <>
          <SuccessButton
            className="mt-5"
            busy={busy === 'found'}
            done={done}
            disabled={locked}
            onClick={() => void onUse()}
            label={useLabel(f)}
          />
          <Note tone="danger">{note}</Note>
        </>
      )}
    </section>
  )
}

/** The card's top line: up to five faces in their own colours, hopping in one after another, then "+N". */
function Faces({ agents, total, state }: { agents: FoundHermes['agents'] & {}; total: number; state: BuddyState }) {
  const reduced = usePrefersReducedMotion()
  const shown = agents.slice(0, FACES)
  const more = total - shown.length
  const size = 36
  return (
    <span className="flex min-w-0 items-end gap-2" aria-hidden>
      <span className="buddy-row" style={{ height: size }}>
        {shown.map((a, i) => (
          <motion.span
            key={a.id}
            className="buddy-row-slot"
            style={{ width: size * 0.7, height: size }}
            initial={reduced ? false : { opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', duration: 0.5, bounce: 0.25, delay: 0.16 + i * 0.06 }}
          >
            <Buddy hue={agentHue(a)} size={size} seed={a.id} state={state} />
          </motion.span>
        ))}
      </span>
      {more > 0 && (
        <motion.span
          className="mb-1 inline-flex h-6 items-center rounded-full bg-fill-2 px-2 text-caption font-semibold text-ink-2 tabular-nums"
          initial={reduced ? false : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.4, bounce: 0.3, delay: 0.16 + shown.length * 0.06 }}
        >
          +{more}
        </motion.span>
      )}
    </span>
  )
}

/** A password-protected Hermes: the sign-in sits in the card, no extra tap to reveal it. */
function SignIn({
  hermes: f,
  busy,
  done,
  locked,
  onUse,
  initial,
}: {
  hermes: FoundHermes
  busy: boolean
  done: boolean
  locked: boolean
  onUse: (creds: { username: string; password: string }) => Promise<'ok' | 'bad-login' | 'needs-login' | 'error'>
  initial?: { username?: string; password?: string; error?: string }
}) {
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState(initial?.password ?? '')
  const [error, setError] = useState<string | undefined>(initial?.error)
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  // Arriving here because a choice found a password: start where the typing starts.
  useEffect(() => {
    if (!initial) usernameRef.current?.focus({ preventScroll: true })
  }, [initial])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || busy) return
    setError(undefined)
    const answer = await onUse({ username: username.trim(), password })
    if (answer === 'bad-login') {
      setError('That username or password didn’t work.')
      passwordRef.current?.select()
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-5">
      <div className="space-y-3">
        <Field
          ref={usernameRef}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
            setError(undefined)
          }}
          placeholder="Username"
          aria-label="Username"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          invalid={!!error}
          disabled={locked || done}
        />
        <PasswordField
          ref={passwordRef}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(undefined)
          }}
          placeholder="Password"
          aria-label="Password"
          autoComplete="current-password"
          invalid={!!error}
          disabled={locked || done}
        />
      </div>
      <Note tone={error ? 'danger' : 'quiet'}>
        {error ?? 'Murmur keeps this password on its server, never in your browser.'}
      </Note>
      <SuccessButton
        type="submit"
        className="mt-5"
        busy={busy}
        done={done}
        disabled={locked || !username.trim()}
        label="Sign in"
      />
      <span className="sr-only">{f.name}</span>
    </form>
  )
}

/** The card's button: a spinner while it asks, then a green "Connected" before the step moves on. */
function SuccessButton({
  label,
  busy,
  done,
  disabled,
  onClick,
  className,
  type = 'button',
}: {
  label: string
  busy: boolean
  done: boolean
  disabled?: boolean
  onClick?: () => void
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <Button
      type={type}
      size="lg"
      variant="accent"
      loading={busy && !done}
      disabled={disabled && !done}
      onClick={done ? undefined : onClick}
      className={cn(className, done && 'bg-success! text-accent-ink! opacity-100!')}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={done ? 'done' : 'use'}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          className="inline-flex items-center gap-2"
        >
          {done ? (
            <>
              <Check size={18} strokeWidth={2.5} /> Connected
            </>
          ) : (
            label
          )}
        </motion.span>
      </AnimatePresence>
    </Button>
  )
}

// ── Starting fresh ──────────────────────────────────────────────────────────

/** Nothing found: the Hermes built into Murmur leads, the face of the main agent-to-be on top. */
function FreshCard({
  state,
  busy,
  onStart,
  onCheck,
}: {
  state?: BuiltinState
  busy: boolean
  onStart: () => void
  onCheck: () => Promise<unknown>
}) {
  const down = state === 'unreachable' || state === 'outdated'
  const [checking, setChecking] = useState(false)
  return (
    <section className="flex flex-col items-center rounded-2xl bg-elevated p-5 pt-6 text-center shadow-float ring-1 ring-line-strong ring-inset">
      <span className="relative grid size-20 place-items-center">
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute size-40 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)] transition-opacity duration-500',
            down && 'opacity-0',
          )}
        />
        <span className="relative">
          <Buddy hue={HUE} size={64} seed="default" state={down ? 'offline' : busy ? 'working' : 'idle'} />
        </span>
      </span>
      <h2 className="mt-3 text-title font-semibold tracking-[-0.02em]">Built into Murmur</h2>
      <p className="mt-1 max-w-[20rem] text-subhead text-balance text-ink-2">
        {state === 'outdated'
          ? 'It needs an update. Update Murmur, then check again.'
          : down
            ? 'It isn’t responding right now. Try restarting Murmur, then check again.'
            : 'A new home for your agents. Nothing to install or set up.'}
      </p>
      {down ? (
        <Button
          size="lg"
          variant="secondary"
          className="mt-5"
          loading={checking}
          onClick={async () => {
            setChecking(true)
            await onCheck().catch(() => {})
            setChecking(false)
          }}
        >
          <RefreshCw size={17} strokeWidth={2} aria-hidden />
          Check again
        </Button>
      ) : (
        <Button size="lg" variant="accent" className="mt-5" loading={busy} onClick={onStart}>
          Start fresh
        </Button>
      )}
    </section>
  )
}

/** A secondary choice, in the look of a closed Connect a model card: one tap, no confirmation. */
function ChoiceRow({
  leading,
  title,
  subtitle,
  busy,
  disabled,
  onClick,
}: {
  leading: ReactNode
  title: string
  subtitle: string
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const descId = useId()
  return (
    <button
      type="button"
      onClick={busy ? undefined : onClick}
      disabled={disabled}
      aria-describedby={descId}
      aria-busy={busy || undefined}
      className={cn(
        'pressable flex w-full items-center gap-4 rounded-2xl bg-fill-1 p-4 text-left select-none focus-visible:outline-offset-2',
        'transition-colors enabled:hover:bg-fill-2 enabled:active:bg-fill-2 disabled:cursor-default',
      )}
    >
      <span className="flex-none">{leading}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-body font-semibold tracking-[-0.01em]', disabled && 'text-ink-2')}>
          {title}
        </span>
        <span id={descId} className="mt-0.5 block text-footnote text-pretty text-ink-2">
          {subtitle}
        </span>
      </span>
      {busy ? (
        <Spinner size={16} className="flex-none text-ink-3" />
      ) : (
        !disabled && <ChevronRight size={18} className="-mr-1 flex-none text-ink-3" aria-hidden />
      )}
    </button>
  )
}

/** "Connect a different Hermes…": there for those who look for it, quiet for everyone else. */
function QuietLink({ onClick, hidden, children }: { onClick: () => void; hidden?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={hidden}
      className="pressable flex h-11 items-center rounded-full px-4 text-subhead font-medium text-accent transition-opacity select-none hover:bg-fill-1 active:bg-fill-2 disabled:opacity-0"
    >
      {children}
    </button>
  )
}

/** Murmur's own server didn't answer the question. */
function CantReach({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const [trying, setTrying] = useState(false)
  return (
    <motion.div
      className="flex flex-col items-center pt-4 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease }}
    >
      <Buddy hue={HUE} size={64} seed="setup" state="offline" />
      <p className="mt-5 text-body font-semibold">Can’t reach Murmur</p>
      <p className="mt-1 text-subhead text-ink-2">Check your connection, then try again.</p>
      <Button
        size="lg"
        variant="accent"
        className="mt-6"
        loading={trying}
        onClick={async () => {
          setTrying(true)
          await onRetry().catch(() => {})
          setTrying(false)
        }}
      >
        Try again
      </Button>
    </motion.div>
  )
}
