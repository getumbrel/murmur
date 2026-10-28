import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowUp, ArrowUpRight, Check, ChevronDown } from 'lucide-react'
import { Button } from '@/ui/button'
import { ConfirmCard } from '@/ui/confirm-card'
import { Grow } from '@/ui/grow'
import { Segmented } from '@/ui/segmented'
import { SecretField, TextField, Label } from '@/ui/field'
import { ListGroup, ListRow } from '@/ui/list'
import { Toggle } from '@/ui/toggle'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import type { Agent } from '@/state/agents'
import {
  changeMailPassword,
  connectMail,
  disconnectMail,
  looksLikeAddress,
  mailWebUrl,
  MAIL_PROVIDER_ORDER,
  MAIL_PROVIDERS,
  MailError,
  providerFor,
  setMailEnabled,
  type MailHealth,
  type MailProof,
  type MailProviderId,
  type MailSecurity,
  type MailStatus,
} from '@/state/mail'
import { relativeDay } from '@/features/chat-screen/relative-day'
import { AppIcon } from './app-icon'
import { CodeField } from './code-field'
import {
  ADDRESS_HINT,
  codeState,
  codeValue,
  CODE_SHAPES,
  fieldFor,
  guessServers,
  mailIcon,
  MAKER,
  OPEN_LABEL,
  providerNote,
  serverOf,
  withSecurity,
  type MailField,
  type ServerDraft,
} from './email-form'
import { AppHeader, Heading, Pair, RowStatus, ease } from './parts'

// An agent's own email: one account, connected with an app password (or,
// for another account, its password and servers). The agent can search, read
// and draft; sending always asks the person first, in the chat. Mail goes
// straight between the provider and this Hermes (state/mail.ts).

export const INBOX_QUESTION = 'What needs me in my inbox today?'

/** A field a failed sign-in points at. */
const DANGER = 'ring-danger!'

const fail = () => toast.error('Couldn’t reach Hermes. Check that it’s running, then try again.')

/** The agent's email is on: the plugin, and its tools for this agent. */
export const mailOn = (status: Pick<MailStatus, 'enabled' | 'off'>) => status.enabled && !status.off

/** What an account is called in a list: its provider ("Gmail"), or plain "Email". */
export const accountTitle = (provider: MailProviderId) => (provider === 'other' ? 'Email' : MAIL_PROVIDERS[provider].name)

// ── In the list ─────────────────────────────────────────────────────────────

/** The agent's email among its connected apps: the account, how it's doing, and its switch. */
export function EmailRow({
  agent,
  status,
  health,
  onOpen,
}: {
  agent: Agent
  status: MailStatus
  health: MailHealth | undefined
  onOpen: () => void
}) {
  const qc = useQueryClient()
  const account = status.account!
  const title = accountTitle(account.provider)
  const on = mailOn(status)
  const line: ReactNode = !on ? (
    'Off'
  ) : health === 'signin' ? (
    <span className="text-accent">Needs a new app password</span>
  ) : health === 'down' ? (
    'Can’t reach it right now'
  ) : (
    account.address
  )
  return (
    <div data-has-icon="" className="flex min-h-15 items-center gap-3 pr-4">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-2.5 pl-4 text-left transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2"
      >
        <AppIcon
          name={mailIcon(account.provider)}
          size={30}
          className={cn('transition-opacity duration-200', !on && 'opacity-45')}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">{title}</span>
          <RowStatus id={typeof line === 'string' ? line : 'signin'}>{line}</RowStatus>
        </span>
      </button>
      <Toggle
        checked={on}
        onChange={(next) => void setMailEnabled(qc, agent.id, next).catch(fail)}
        label={`Email for ${agent.name}`}
      />
    </div>
  )
}

// ── Choosing ────────────────────────────────────────────────────────────────

export function EmailStart({ agent, onPick }: { agent: Agent; onPick: (provider: MailProviderId) => void }) {
  return (
    <div className="pb-1">
      <Pair agent={agent} icon={mailIcon('other')} state="linking" />
      <Heading title={`Give ${agent.name} your email`}>It can search, read and draft. Sending always asks you first.</Heading>
      <div className="mt-7">
        <ListGroup>
          {MAIL_PROVIDER_ORDER.map((id) => (
            <ListRow
              key={id}
              icon={<AppIcon name={mailIcon(id)} size={30} />}
              title={MAIL_PROVIDERS[id].name}
              subtitle={id === 'other' ? 'Work, school or your own domain' : undefined}
              chevron
              onClick={() => onPick(id)}
            />
          ))}
        </ListGroup>
      </div>
    </div>
  )
}

// ── Connecting ──────────────────────────────────────────────────────────────

export type MailDraft = {
  address: string
  incoming: ServerDraft
  outgoing: ServerDraft
  username: string
  /** The person changed a server themselves: stop guessing them from the address. */
  touched: boolean
}

export const emptyDraft = (): MailDraft => ({ address: '', ...guessServers(''), username: '', touched: false })

export type Connected = { provider: MailProviderId; newest: MailProof[] }

type Failure = { field: MailField | null; message: string; note?: string }

/**
 * Connecting one account, or (`change`) giving the connected one a new app
 * password. Nothing is saved until the account signs in; a failure says
 * what's wrong under the field to fix.
 */
export function EmailForm({
  agent,
  provider,
  draft,
  onDraft,
  onSwitch,
  onConnected,
  change,
}: {
  agent: Agent
  provider: MailProviderId
  draft: MailDraft
  onDraft: (next: MailDraft) => void
  onSwitch: (provider: MailProviderId) => void
  onConnected: (result: Connected) => void
  /** The connected account's address: just a new password for it. */
  change?: string
}) {
  const qc = useQueryClient()
  const id = useId()
  const p = MAIL_PROVIDERS[provider]
  const known = provider !== 'other'
  const [password, setPassword] = useState('')
  const [opened, setOpened] = useState(false)
  const [checking, setChecking] = useState(false)
  const [slow, setSlow] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const refs = {
    address: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    incoming: useRef<HTMLInputElement>(null),
    outgoing: useRef<HTMLInputElement>(null),
  }

  const address = change ?? draft.address
  const code = known ? codeState(provider, password) : password ? 'ready' : 'empty'
  // Another account's servers, when connecting one (a new password keeps the saved ones).
  const servers = known || change ? null : { incoming: serverOf(draft.incoming), outgoing: serverOf(draft.outgoing) }
  const ready =
    looksLikeAddress(address) && code === 'ready' && (!servers || (!!servers.incoming && !!servers.outgoing))
  // An address another provider looks after: offer to go there instead.
  const elsewhere = !change && looksLikeAddress(address) ? providerFor(address) : provider
  const misfiled = elsewhere !== provider && elsewhere !== 'other'

  // Saying so when signing in takes a while (a server that doesn't answer takes up to 20s to give up).
  useEffect(() => {
    if (!checking) return setSlow(false)
    const t = setTimeout(() => setSlow(true), 1400)
    return () => clearTimeout(t)
  }, [checking])

  // The field a failure points at gets the focus, with the words under it.
  useEffect(() => {
    if (failure?.field) refs[failure.field].current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failure])

  const edit = (field: MailField) => {
    if (failure?.field === field || failure?.field === null) setFailure(null)
  }
  const setAddress = (value: string) => {
    edit('address')
    onDraft(draft.touched ? { ...draft, address: value } : { ...draft, address: value, ...guessServers(value) })
  }
  const setServer = (kind: 'incoming' | 'outgoing', next: ServerDraft) => {
    edit(kind)
    onDraft({ ...draft, [kind]: next, touched: true })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready || checking) return
    setChecking(true)
    setFailure(null)
    const secret = known ? codeValue(provider, password) : password
    try {
      const result = change
        ? await changeMailPassword(qc, agent.id, secret)
        : await connectMail(qc, agent.id, {
            provider,
            address,
            password: secret,
            ...(servers && {
              incoming: servers.incoming!,
              outgoing: servers.outgoing!,
              username: draft.username.trim() || undefined,
            }),
          })
      haptic('success')
      onConnected({ provider: result.account.provider, newest: result.newest })
    } catch (error) {
      if (!(error instanceof MailError)) return void setFailure({ field: null, message: 'Couldn’t reach Hermes. Check that it’s running, then try again.' })
      const field = fieldFor(provider, error.kind, error.where, { address: looksLikeAddress(address), password: !!password })
      if (field === 'incoming' || field === 'outgoing') setAdvanced(true)
      const wrong = error.kind === 'wrong_password' || error.kind === 'app_password'
      setFailure({ field, message: error.message, note: wrong ? providerNote(provider) : undefined })
    } finally {
      setChecking(false)
    }
  }

  const errorId = `${id}-error`
  const said = (field: MailField | null) =>
    failure && failure.field === field ? (
      <motion.div
        id={errorId}
        role="alert"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease }}
        className={cn('mt-2 px-4 text-footnote text-pretty', field === null && 'text-center')}
      >
        <p className="text-danger">{failure.message}</p>
        {failure.note && <p className="mt-1 text-ink-3">{failure.note}</p>}
      </motion.div>
    ) : null
  const marked = (field: MailField) => failure?.field === field
  const invalid = (field: MailField) => (marked(field) ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {})

  return (
    <form className="pb-1" onSubmit={submit} noValidate>
      {known ? (
        <AppHeader icon={provider} title={change ? 'New app password' : p.name}>
          {change ? `For ${change}. Make a new one, then paste it here.` : `${MAKER[provider]} gives ${agent.name} a password of its own, so yours stays yours.`}
        </AppHeader>
      ) : (
        <AppHeader icon={mailIcon('other')} title={change ? 'New password' : 'Another account'}>
          {change ? `For ${change}.` : 'Your address and its password. If your mail service offers app passwords, use one.'}
        </AppHeader>
      )}

      <fieldset disabled={checking} className="contents">
        {!change && (
          <div className="mt-7">
            <TextField
              ref={refs.address}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              placeholder={ADDRESS_HINT[provider]}
              aria-label={known ? `Your ${p.name} address` : 'Email address'}
              value={draft.address}
              onChange={(e) => setAddress(e.target.value)}
              className={cn(marked('address') && DANGER)}
              {...invalid('address')}
            />
            {said('address')}
            <AnimatePresence initial={false}>
              {misfiled && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.24, ease }}
                  className="overflow-hidden px-4 text-footnote text-ink-2"
                >
                  <span className="block pt-2">
                    That’s {/^[aeiou]/i.test(MAIL_PROVIDERS[elsewhere].name) ? 'an' : 'a'} {MAIL_PROVIDERS[elsewhere].name} address.{' '}
                    <button
                      type="button"
                      onClick={() => onSwitch(elsewhere)}
                      className="relative font-medium text-accent after:absolute after:-inset-x-1 after:-inset-y-3 hover:underline"
                    >
                      Use {MAIL_PROVIDERS[elsewhere].name}
                    </button>
                  </span>
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}

        {known ? (
          <ol className={cn('space-y-5', change ? 'mt-7' : 'mt-6')}>
            <li>
              <Step n={1} done={opened || code === 'ready'}>
                Make an app password
              </Step>
              <a
                href={p.appPasswordUrl!}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpened(true)}
                className="pressable mt-2.5 flex h-12 w-full items-center gap-3 rounded-xl bg-fill-1 px-4 text-left text-body text-ink transition-colors hover:bg-fill-2"
              >
                <span className="min-w-0 flex-1 truncate">{OPEN_LABEL[provider]}</span>
                <ArrowUpRight size={18} strokeWidth={2} className="flex-none text-ink-3" aria-hidden />
              </a>
              <p className="mt-2 px-4 text-footnote text-pretty text-ink-3">{p.appPasswordSteps.slice(1).join(' ')}</p>
            </li>
            <li>
              <Step n={2} done={code === 'ready' && !marked('password')}>
                Paste it here
              </Step>
              <div className="mt-2.5">
                <CodeField
                  ref={refs.password}
                  provider={provider}
                  value={password}
                  onChange={(v) => {
                    edit('password')
                    setPassword(v)
                  }}
                  label="App password"
                  invalid={marked('password') || code === 'wrong'}
                  describedBy={marked('password') ? errorId : code === 'wrong' ? `${id}-shape` : undefined}
                  disabled={checking}
                  autoFocus={!!change}
                />
                {code === 'wrong' && !marked('password') && (
                  <p id={`${id}-shape`} className="mt-2 px-4 text-footnote text-danger">
                    {CODE_SHAPES[provider].wrong}
                  </p>
                )}
                {said('password')}
              </div>
            </li>
          </ol>
        ) : (
          <div className={cn(change ? 'mt-7' : 'mt-3')}>
            <SecretField
              ref={refs.password}
              placeholder="Password"
              aria-label="Password"
              enterKeyHint="go"
              value={password}
              autoFocus={!!change}
              onChange={(e) => {
                edit('password')
                setPassword(e.target.value)
              }}
              className={cn(marked('password') && DANGER)}
              {...invalid('password')}
            />
            {said('password')}
            {!change && (
              <ServerSettings
                open={advanced}
                onToggle={() => setAdvanced((o) => !o)}
                draft={draft}
                address={address}
                onServer={setServer}
                onUsername={(username) => onDraft({ ...draft, username })}
                refs={{ incoming: refs.incoming, outgoing: refs.outgoing }}
                invalid={invalid}
                marked={marked}
                said={said}
              />
            )}
          </div>
        )}
      </fieldset>

      <div className="mt-7">
        <Button type="submit" variant="accent" size="lg" disabled={!ready} loading={checking}>
          {change ? 'Save' : 'Connect'}
        </Button>
        {said(null)}
        <AnimatePresence>
          {slow && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.3 }}
              aria-live="polite"
              className="mt-3 text-center text-footnote text-ink-3"
            >
              {known ? `Signing in to ${p.name}…` : 'Signing in…'}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </form>
  )
}

function Step({ n, done, children }: { n: number; done?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span
        className={cn(
          'grid size-6 flex-none place-items-center rounded-full text-caption font-semibold transition-colors duration-200',
          done ? 'bg-success text-white' : 'bg-accent-soft text-accent',
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={done ? 'done' : 'n'}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.3 }}
            className="grid place-items-center"
          >
            {done ? <Check size={13} strokeWidth={3} aria-label="Done" /> : n}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="text-subhead font-medium">{children}</span>
    </div>
  )
}

const SECURITY: { value: MailSecurity; label: string }[] = [
  { value: 'ssl', label: 'SSL/TLS' },
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'none', label: 'None' },
]

/** Another account's servers, folded away: most work as guessed from the address. */
function ServerSettings({
  open,
  onToggle,
  draft,
  address,
  onServer,
  onUsername,
  refs,
  invalid,
  marked,
  said,
}: {
  open: boolean
  onToggle: () => void
  draft: MailDraft
  address: string
  onServer: (kind: 'incoming' | 'outgoing', next: ServerDraft) => void
  onUsername: (username: string) => void
  refs: Record<'incoming' | 'outgoing', React.RefObject<HTMLInputElement | null>>
  invalid: (field: MailField) => object
  marked: (field: MailField) => boolean
  said: (field: MailField | null) => ReactNode
}) {
  const id = useId()
  const server = (kind: 'incoming' | 'outgoing', title: string) => {
    const value = draft[kind]
    return (
      <div>
        <Label>{title}</Label>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              ref={refs[kind]}
              aria-label={`${title} name`}
              placeholder={kind === 'incoming' ? 'imap.example.com' : 'smtp.example.com'}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={value.host}
              onChange={(e) => onServer(kind, { ...value, host: e.target.value })}
              className={cn(marked(kind) && DANGER)}
              {...invalid(kind)}
            />
          </div>
          <div className="w-21 flex-none">
            <TextField
              className="text-center"
              aria-label={`${title} port`}
              inputMode="numeric"
              maxLength={5}
              value={value.port}
              onChange={(e) => onServer(kind, { ...value, port: e.target.value.replace(/\D/g, '') })}
            />
          </div>
        </div>
        <Segmented
          className="mt-2"
          label={`${title} security`}
          value={value.security}
          options={SECURITY}
          onChange={(security) => onServer(kind, withSecurity(kind, value, security))}
        />
        {said(kind)}
      </div>
    )
  }
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="pressable flex h-11 items-center gap-1 rounded-full px-4 text-footnote font-medium text-ink-2 hover:text-ink"
      >
        Server settings
        <ChevronDown
          size={15}
          strokeWidth={2.2}
          aria-hidden
          className={cn('transition-transform duration-300 ease-(--ease-sheet)', open && 'rotate-180')}
        />
      </button>
      <Grow>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.24, ease }}
              className="space-y-5 pt-2 pb-1"
            >
              {server('incoming', 'Incoming mail server')}
              {server('outgoing', 'Outgoing mail server')}
              <div>
                <Label hint="If it isn’t your address">Sign-in name</Label>
                <TextField
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={address || 'you@example.com'}
                  value={draft.username}
                  onChange={(e) => onUsername(e.target.value)}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Grow>
    </div>
  )
}

// ── Connected ───────────────────────────────────────────────────────────────

/** Connected: the proof is the person's own inbox, and the next step is a question. */
export function EmailConnected({
  agent,
  connected,
  again,
  onAsk,
  onDone,
}: {
  agent: Agent
  connected: Connected
  /** A new password for an account it had. */
  again?: boolean
  onAsk: () => void
  onDone: () => void
}) {
  const reduce = useReducedMotion()
  const rise = (i: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
      : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.42, ease, delay: 0.5 + i * 0.09 } }
  const newest = connected.newest.slice(0, 3)
  return (
    <div className="pb-1">
      <Pair agent={agent} icon={mailIcon(connected.provider)} state="linked" />
      <Heading title={again ? `${agent.name} can use your email again` : `${agent.name} can now use your email`} />
      <motion.ul
        aria-label="Newest in your inbox"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0.15 : 0.3, delay: reduce ? 0 : 0.4 }}
        className="mt-6 overflow-hidden rounded-xl bg-fill-1"
      >
        {newest.length ? (
          newest.map((m, i) => (
            <motion.li key={`${m.fromAddress}-${m.subject}-${i}`} {...rise(i)} className={cn('flex items-center gap-3 px-4 py-2.5', i > 0 && 'border-t border-line')}>
              <Initial name={m.fromName || m.fromAddress} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-subhead font-semibold">{m.fromName || m.fromAddress}</span>
                  {m.date && <span className="flex-none text-caption text-ink-3">{relativeDay(m.date.getTime())}</span>}
                </span>
                <span className="block truncate text-footnote text-ink-2">{m.subject || 'No subject'}</span>
              </span>
            </motion.li>
          ))
        ) : (
          <motion.li {...rise(0)} className="px-4 py-3.5 text-center text-subhead text-ink-3">
            Your inbox is empty
          </motion.li>
        )}
      </motion.ul>

      <motion.button
        type="button"
        onClick={onAsk}
        {...rise(newest.length + 1.5)}
        className="pressable mt-6 flex min-h-14 w-full items-center gap-3 rounded-2xl bg-accent-soft py-2 pr-2 pl-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-caption font-medium text-accent">Ask {agent.name}</span>
          <span className="block text-body font-medium text-ink">{INBOX_QUESTION}</span>
        </span>
        <span className="grid size-10 flex-none place-items-center rounded-full bg-accent text-accent-ink">
          <ArrowUp size={19} strokeWidth={2.4} aria-hidden />
        </span>
      </motion.button>
      <div className="mt-2 grid">
        <Button size="lg" variant="ghost" className="text-ink-2" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

/** A sender as an inbox shows one with no picture: their initial, on a colour that's always theirs. */
function Initial({ name }: { name: string }) {
  let h = 0
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360
  const letter = name.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '?'
  return (
    <span
      aria-hidden
      className="grid size-8 flex-none place-items-center rounded-full text-footnote font-semibold text-white"
      style={{ background: `oklch(0.62 0.12 ${h})` }}
    >
      {letter}
    </span>
  )
}

// ── Managing ────────────────────────────────────────────────────────────────

/** The connected account: on or off, a new password, its mail on the web, or taken away. */
export function EmailManage({
  agent,
  status,
  health,
  onChangePassword,
  onRemoved,
}: {
  agent: Agent
  status: MailStatus
  health: MailHealth | undefined
  onChangePassword: () => void
  onRemoved: () => void
}) {
  const qc = useQueryClient()
  const account = status.account!
  const p = MAIL_PROVIDERS[account.provider]
  const web = mailWebUrl(account)
  const known = account.provider !== 'other'

  const remove = () => {
    onRemoved()
    disconnectMail(qc, agent.id).catch(fail)
  }

  return (
    <div className="pb-1">
      <AppHeader icon={mailIcon(account.provider)} title={accountTitle(account.provider)}>
        {account.address}
      </AppHeader>
      <div className="mt-7 space-y-6">
        <ListGroup
          footer={
            health === 'down'
              ? `Can’t reach ${known ? p.name : 'your mail'} right now. ${agent.name} will try again when it needs to.`
              : 'Sending always asks you first, in the chat.'
          }
        >
          <ListRow
            title={`On for ${agent.name}`}
            trailing={
              <Toggle
                checked={mailOn(status)}
                onChange={(on) => void setMailEnabled(qc, agent.id, on).catch(fail)}
                label={`Email for ${agent.name}`}
              />
            }
          />
          <ListRow
            title={known ? 'Change app password' : 'Change password'}
            subtitle={
              health === 'signin' ? (
                <span className="text-accent">{known ? `${p.name} stopped accepting the old one` : 'The old one stopped working'}</span>
              ) : undefined
            }
            onClick={onChangePassword}
            chevron
          />
          {web && (
            <ListRow
              title={`Open ${p.name}`}
              onClick={() => window.open(web, '_blank', 'noopener,noreferrer')}
              trailing={<ArrowUpRight size={18} strokeWidth={2} className="-mr-1 flex-none text-ink-3" aria-hidden />}
            />
          )}
        </ListGroup>
        <ConfirmCard
          label={`Remove from ${agent.name}`}
          title={`Remove your email from ${agent.name}?`}
          body={`${agent.name} won’t be able to search, read or draft your mail. You can connect it again any time.`}
          confirm="Remove"
          onConfirm={remove}
        />
      </div>
    </div>
  )
}

