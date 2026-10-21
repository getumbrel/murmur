import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LockKeyhole } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet } from '@/ui/sheet'
import { Button } from '@/ui/button'
import { Buddy } from '@/ui/buddy'
import { Grow } from '@/ui/grow'
import { Skeleton } from '@/ui/skeleton'
import { ConfirmCard } from '@/ui/confirm-card'
import { Label, SecretField, TextField } from '@/ui/field'
import { ListGroup, ListRow } from '@/ui/list'
import { CardIcon, HomeIcon, IconChip, PasswordsIcon, type IconProps } from '@/ui/icons'
import { cn } from '@/lib/cn'
import type { Agent } from '@/state/agents'
import {
  cardBrand,
  cardFromLabel,
  cardNumberOk,
  digitsOf,
  formatCardNumber,
  formatExpiry,
  hostOf,
  identifierType,
  originOf,
  parseExpiry,
  toWire,
  useVault,
  useVaultActions,
  type VaultEntry,
  type VaultInput,
  type VaultKind,
} from '@/state/vault'
import { CardFace } from './card-face'
import { SiteIcon, siteKey } from './site-icon'
import './vault.css'

// An agent's passwords: the logins it signs in with, the cards it pays with
// and the addresses it fills in, each for one site. Hermes keeps them
// encrypted and types them into the page for the agent, which never sees a
// password or card number. Nothing here can show one back either, so a change
// means typing it again.

type Props = { agent: Agent; open: boolean; onOpenChange: (open: boolean) => void }

type View = { name: 'list' } | { name: 'item'; id: string } | { name: 'new'; kind: VaultKind } | { name: 'change'; id: string }

const ease = [0.16, 1, 0.3, 1] as const
const depth = (view: View) => (view.name === 'list' ? 0 : view.name === 'change' ? 2 : 1)

const KINDS: Record<VaultKind, { group: string; noun: string; icon: (p: IconProps) => ReactNode; add: string }> = {
  login: { group: 'Logins', noun: 'login', icon: PasswordsIcon, add: 'Add a login' },
  payment: { group: 'Cards', noun: 'card', icon: CardIcon, add: 'Add a card' },
  address: { group: 'Addresses', noun: 'address', icon: HomeIcon, add: 'Add an address' },
}
const ORDER: VaultKind[] = ['login', 'payment', 'address']

export function VaultSheet({ agent, open, onOpenChange }: Props) {
  const vault = useVault(agent.id, { enabled: open })
  const [view, setView] = useState<View>({ name: 'list' })
  // Which way the views slide: deeper goes left, back comes from the left.
  const [forward, setForward] = useState(true)
  const [fresh, setFresh] = useState<string>()

  const go = (next: View) => {
    setForward(depth(next) >= depth(view))
    setView(next)
  }

  // Closing comes back to the list next time.
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => {
      setView({ name: 'list' })
      setFresh(undefined)
    }, 400)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(() => setFresh(undefined), 1600)
    return () => clearTimeout(t)
  }, [fresh])

  const entries = vault.data ?? []
  const found = view.name === 'item' || view.name === 'change' ? entries.find((e) => e.id === view.id) : undefined
  // Kept while a change lands: the old item leaves the list a moment before the view moves on.
  const kept = useRef<VaultEntry>(undefined)
  if (found) kept.current = found
  const entry = found ?? ('id' in view && kept.current?.id === view.id ? kept.current : undefined)
  // Gone from under it (deleted in another window, say): back to the list. Not
  // mid-change, where the old one goes the moment its replacement is saved.
  const lost = view.name === 'item' && vault.isSuccess && !found
  useEffect(() => {
    if (!lost) return
    setForward(false)
    setView({ name: 'list' })
  }, [lost])

  const saved = (id: string) => {
    setFresh(id)
    go({ name: 'list' })
  }

  const title =
    view.name === 'list'
      ? 'Passwords'
      : view.name === 'new'
        ? `New ${KINDS[view.kind].noun}`
        : entry
          ? view.name === 'change'
            ? `Change ${KINDS[entry.kind].noun}`
            : entry.label
          : 'Passwords'
  const back =
    view.name === 'list'
      ? undefined
      : view.name === 'change'
        ? { label: entry?.kind === 'payment' ? 'Card' : (entry?.label ?? 'Back'), onBack: () => go({ name: 'item', id: view.id }) }
        : { label: 'Passwords', onBack: () => go({ name: 'list' }) }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      back={back}
      className="hue-scope"
      style={{ '--hue': agent.hue } as CSSProperties}
      width={480}
    >
      <Grow>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view.name === 'list' ? 'list' : view.name === 'new' ? `new:${view.kind}` : `${view.name}:${view.id}`}
            initial={{ opacity: 0, x: forward ? 16 : -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: forward ? -16 : 16, transition: { duration: 0.14 } }}
            transition={{ duration: 0.3, ease }}
          >
            {view.name === 'list' ? (
              <Home
                agent={agent}
                entries={entries}
                pending={vault.isPending}
                error={vault.error?.message}
                fresh={fresh}
                onRetry={() => void vault.refetch()}
                onOpen={(e) => go({ name: 'item', id: e.id })}
                onAdd={(kind) => go({ name: 'new', kind })}
              />
            ) : view.name === 'new' ? (
              <ItemForm agent={agent} kind={view.kind} onSaved={saved} />
            ) : entry && view.name === 'change' ? (
              <ItemForm agent={agent} kind={entry.kind} entry={entry} onSaved={saved} />
            ) : entry ? (
              <ItemView
                agent={agent}
                entry={entry}
                onChange={() => go({ name: 'change', id: entry.id })}
                onDeleted={() => go({ name: 'list' })}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </Grow>
    </Sheet>
  )
}

// ── The list ────────────────────────────────────────────────────────────────

function Home({
  agent,
  entries,
  pending,
  error,
  fresh,
  onRetry,
  onOpen,
  onAdd,
}: {
  agent: Agent
  entries: VaultEntry[]
  pending: boolean
  error?: string
  fresh?: string
  onRetry: () => void
  onOpen: (entry: VaultEntry) => void
  onAdd: (kind: VaultKind) => void
}) {
  if (pending) return <Loading />
  if (error)
    return (
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <p className="max-w-80 text-subhead text-balance text-ink-2">{error}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )

  return (
    <div className="space-y-6 pt-1 pb-1">
      {entries.length === 0 && (
        <div className="flex flex-col items-center px-4 pt-3 text-center">
          <Buddy hue={agent.hue} size={64} seed={agent.id} />
          <p className="mt-4 text-body font-medium text-ink">Nothing saved yet</p>
          <p className="mt-1 max-w-76 text-subhead text-balance text-ink-2">
            Save a login and {agent.name} can sign in for you. Save a card and it can check out.
          </p>
        </div>
      )}

      {ORDER.map((kind) => {
        const items = entries.filter((e) => e.kind === kind)
        if (!items.length) return null
        return (
          <ListGroup key={kind} title={KINDS[kind].group}>
            {items.map((entry) => (
              <ListRow
                key={entry.id}
                icon={<EntryIcon entry={entry} />}
                title={entry.label}
                subtitle={subtitleOf(entry)}
                onClick={() => onOpen(entry)}
                chevron
                className={cn(entry.id === fresh && 'vault-fresh')}
              />
            ))}
          </ListGroup>
        )
      })}

      <ListGroup>
        {ORDER.map((kind) => (
          <ListRow
            key={kind}
            icon={<IconChip icon={KINDS[kind].icon} size={28} radius={7} />}
            title={<span className="text-accent">{KINDS[kind].add}</span>}
            onClick={() => onAdd(kind)}
          />
        ))}
      </ListGroup>

      <p className="flex gap-2 px-4 text-footnote text-pretty text-ink-3">
        <LockKeyhole size={13} strokeWidth={2} aria-hidden className="mt-[3px] flex-none" />
        <span>Stored encrypted. {agent.name} fills them in without ever seeing your passwords or card details.</span>
      </p>
    </div>
  )
}

/** A login says who it signs in as; a card or an address, the site it's for. */
function subtitleOf(entry: VaultEntry) {
  if (entry.kind === 'login') return entry.identifier
  return entry.origin ? hostOf(entry.origin) : 'No website yet'
}

function EntryIcon({ entry, size = 28 }: { entry: VaultEntry; size?: number }) {
  if (entry.kind === 'login') return <SiteIcon host={entry.origin && hostOf(entry.origin)} size={size} />
  if (entry.kind === 'payment') return <CardFace size="row" brand={cardFromLabel(entry.label).brand} />
  return <IconChip icon={HomeIcon} size={size} radius={Math.round(size * 0.25)} />
}

/** The shape of the list while it loads: a heading and three rows, sized like the real ones. */
function Loading() {
  return (
    <div className="space-y-2 pt-1" aria-busy aria-label="Loading">
      <div className="flex h-[18px] items-center px-4">
        <Skeleton className="h-2.5 w-16 rounded-full" />
      </div>
      <div className="overflow-hidden rounded-xl bg-fill-1">
        {[0.5, 0.38, 0.44].map((w, i) => (
          <div key={i} className="flex h-13 items-center gap-3 px-4">
            <Skeleton className="size-7 flex-none rounded-[7px]" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-2.5 rounded-full" style={{ width: `${w * 100}%` }} />
              <Skeleton className="h-2 rounded-full" style={{ width: `${w * 70}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── One item ────────────────────────────────────────────────────────────────

function ItemView({
  agent,
  entry,
  onChange,
  onDeleted,
}: {
  agent: Agent
  entry: VaultEntry
  onChange: () => void
  onDeleted: () => void
}) {
  const actions = useVaultActions(agent.id)
  const { noun } = KINDS[entry.kind]
  const host = entry.origin ? hostOf(entry.origin) : undefined
  const card = entry.kind === 'payment' ? cardFromLabel(entry.label) : undefined

  const remove = async () => {
    try {
      await actions.remove(entry)
      onDeleted()
    } catch (error) {
      toast.error((error as Error).message)
      throw error
    }
  }

  // The card's face already names it; a card saved elsewhere, or anything else, says its name below.
  const named = !!card?.brand && !!card.last4
  // A login is named for its site, so the site needs no row of its own unless it's named otherwise.
  const siteRow = entry.kind !== 'login' || entry.label !== host

  return (
    <div className="pb-1">
      <header className="flex flex-col items-center pt-3 text-center">
        {card ? (
          <div className="w-full max-w-[17rem]">
            <CardFace brand={card.brand} last4={card.last4} />
          </div>
        ) : (
          <EntryIcon entry={entry} size={64} />
        )}
        <h2
          className={cn(
            'mt-4 max-w-full text-title font-semibold tracking-[-0.02em] text-balance [overflow-wrap:anywhere]',
            named && 'sr-only',
          )}
        >
          {entry.label}
        </h2>
      </header>

      <div className="mt-7 space-y-6">
        <ListGroup footer={entry.added && `Saved ${savedOn(entry.added)}`}>
          {siteRow && <ListRow title="Website" detail={<Detail>{host ?? 'None'}</Detail>} />}
          {entry.kind === 'login' && (
            <>
              <ListRow
                title={IDENTIFIER[identifierType(entry.identifier ?? '')]}
                detail={<Detail>{entry.identifier}</Detail>}
              />
              <ListRow title="Password" detail={<Detail className="tracking-[0.12em]">••••••••</Detail>} />
              {entry.otp && <ListRow title="Sign-in codes" detail={<Detail>Automatic</Detail>} />}
            </>
          )}
        </ListGroup>

        <ListGroup>
          <ListRow title={`Change ${noun}`} onClick={onChange} chevron />
        </ListGroup>

        <ConfirmCard
          className="mt-8"
          label={`Delete ${noun}`}
          title={`Delete this ${noun}?`}
          body={deleteBody(agent.name, entry.kind, host)}
          confirm="Delete"
          onConfirm={remove}
        />
      </div>
    </div>
  )
}

const IDENTIFIER = { email: 'Email', phone: 'Phone', username: 'Username' } as const

function Detail({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('block max-w-[min(15rem,55vw)] truncate', className)}>{children}</span>
}

function deleteBody(name: string, kind: VaultKind, host = 'that site') {
  if (kind === 'login') return `${name} won’t be able to sign in to ${host} with it anymore.`
  if (kind === 'payment') return `${name} won’t be able to pay with it on ${host} anymore.`
  return `${name} won’t be able to fill it in on ${host} anymore.`
}

function savedOn(date: Date) {
  const days = Math.floor((startOfDay(new Date()) - startOfDay(date)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return `on ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', ...(!sameYear && { year: 'numeric' }) })}`
}
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

// ── Adding and changing ─────────────────────────────────────────────────────

type Fields = {
  site: string
  identifier: string
  password: string
  otp: string
  number: string
  expiry: string
  cvc: string
  name: string
  line1: string
  line2: string
  city: string
  state: string
  postcode: string
  country: string
}

function inputOf(kind: VaultKind, f: Fields): VaultInput {
  if (kind === 'login') return { kind, site: f.site, identifier: f.identifier, password: f.password, otp: f.otp }
  if (kind === 'payment')
    return { kind, site: f.site, number: f.number, expiry: f.expiry, cvc: f.cvc, name: f.name, postcode: f.postcode }
  return { kind, site: f.site, line1: f.line1, line2: f.line2, city: f.city, state: f.state, postcode: f.postcode, country: f.country }
}

/**
 * A new item, or a change to one: the same form either way. A change starts
 * from what Hermes lets anyone see (the site, and who a login signs in as);
 * the secret parts are typed again.
 */
function ItemForm({
  agent,
  kind,
  entry,
  onSaved,
}: {
  agent: Agent
  kind: VaultKind
  entry?: VaultEntry
  onSaved: (id: string) => void
}) {
  const actions = useVaultActions(agent.id)
  const [f, setF] = useState<Fields>(() => ({
    site: entry?.origin ? hostOf(entry.origin) : '',
    identifier: entry?.identifier ?? '',
    password: '',
    otp: '',
    number: '',
    expiry: '',
    cvc: '',
    name: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postcode: '',
    country: '',
  }))
  const [touched, setTouched] = useState<Set<keyof Fields>>(new Set())
  const [otpOpen, setOtpOpen] = useState(!!entry?.otp)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const again = !!entry

  const set = (key: keyof Fields) => (value: string) => {
    setF((prev) => ({ ...prev, [key]: value }))
    setError(undefined)
  }
  const touch = (key: keyof Fields) => () => setTouched((prev) => new Set(prev).add(key))
  const field = (key: keyof Fields) => ({
    value: f[key],
    onChange: (e: { target: { value: string } }) => set(key)(e.target.value),
    onBlur: touch(key),
    disabled: saving,
  })

  const ready = !!toWire(inputOf(kind, f))
  const origin = originOf(f.site)
  const digits = digitsOf(f.number)
  const brand = cardBrand(digits)

  const problems: Partial<Record<keyof Fields, string>> = {}
  if (touched.has('site') && f.site.trim() && !origin) problems.site = 'That doesn’t look like a website’s address.'
  if (touched.has('number') && digits && !cardNumberOk(digits)) problems.number = 'Check the card number.'
  if (touched.has('expiry') && digitsOf(f.expiry).length === 4 && !parseExpiry(f.expiry))
    problems.expiry = Number(digitsOf(f.expiry).slice(0, 2)) > 12 ? 'Check the month.' : 'This card has expired.'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready || saving) return
    setSaving(true)
    try {
      const input = inputOf(kind, f)
      const id = entry ? await actions.replace(entry, input) : await actions.add(input)
      // Gone from here the moment Hermes has it.
      setF((prev) => ({ ...prev, password: '', otp: '', number: '', cvc: '', expiry: '' }))
      onSaved(id)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  const host = origin ? hostOf(origin) : undefined
  const siteHint = kind === 'login' ? undefined : `Where ${agent.name} can use it`

  return (
    <form onSubmit={submit} autoComplete="off" noValidate className="pb-1">
      <header className="flex flex-col items-center pt-3 text-center">
        {kind === 'payment' ? (
          <div className="w-full max-w-[17rem]">
            <CardFace brand={brand} digits={digits} name={f.name} expiry={f.expiry} />
          </div>
        ) : (
          <>
            {/* The site takes shape as its address is typed. */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={kind === 'login' && host ? siteKey(host) : 'none'}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
                transition={{ type: 'spring', duration: 0.4, bounce: 0.3 }}
                className="block"
              >
                {kind === 'login' ? (
                  <SiteIcon host={host} size={64} />
                ) : (
                  <IconChip icon={HomeIcon} size={64} radius={16} />
                )}
              </motion.span>
            </AnimatePresence>
            <h2 className="mt-4 max-w-full truncate text-title font-semibold tracking-[-0.02em]">
              {kind === 'login'
                ? (host ?? (again ? 'Change login' : 'New login'))
                : f.line1.trim() || (again ? 'Change address' : 'New address')}
            </h2>
          </>
        )}
      </header>

      <div className="mt-7 space-y-4">
        {kind === 'login' && (
          <>
            <Site
              {...field('site')}
              autoFocus
              placeholder="github.com"
              problem={problems.site}
            />
            <div>
              <Label>Email or username</Label>
              <TextField
                {...field('identifier')}
                placeholder="you@example.com"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                data-1p-ignore
              />
            </div>
            <div>
              <Label>Password</Label>
              <SecretField {...field('password')} placeholder={again ? 'Type it again' : 'Password'} />
            </div>
            <AnimatePresence mode="popLayout" initial={false}>
              {otpOpen ? (
                <motion.div
                  key="otp"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease }}
                >
                  <Label>Setup key for sign-in codes</Label>
                  <SecretField
                    {...field('otp')}
                    autoFocus={!again}
                    placeholder={again ? 'Type it again' : 'Optional'}
                    className="font-mono placeholder:font-sans"
                  />
                  <p className="mt-2 px-4 text-footnote text-pretty text-ink-3">
                    The key a site shows when you turn on two-factor sign-in. With it, {agent.name} enters the codes
                    itself.
                  </p>
                </motion.div>
              ) : (
                <motion.div key="add" exit={{ opacity: 0, transition: { duration: 0.1 } }}>
                  <button
                    type="button"
                    onClick={() => setOtpOpen(true)}
                    className="pressable -my-1 rounded-full px-4 py-1 text-subhead font-medium text-accent hover:bg-fill-1"
                  >
                    Add a setup key for sign-in codes
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {kind === 'payment' && (
          <>
            <Problem problem={problems.number}>
              <Label>Card number</Label>
              <TextField
                {...field('number')}
                onChange={(e) => set('number')(formatCardNumber(e.target.value))}
                autoFocus
                inputMode="numeric"
                autoComplete="cc-number"
                placeholder="1234 5678 9012 3456"
                className="tabular-nums"
              />
            </Problem>
            <div className="grid grid-cols-2 gap-3">
              <Problem problem={problems.expiry}>
                <Label>Expires</Label>
                <TextField
                  {...field('expiry')}
                  onChange={(e) => set('expiry')(formatExpiry(e.target.value, f.expiry))}
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  placeholder="MM / YY"
                  className="tabular-nums"
                />
              </Problem>
              <div>
                <Label>Security code</Label>
                <TextField
                  {...field('cvc')}
                  onChange={(e) => set('cvc')(digitsOf(e.target.value).slice(0, 4))}
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  placeholder={brand === 'amex' ? '••••' : '•••'}
                  className="tabular-nums"
                />
              </div>
            </div>
            <div>
              <Label>Name on card</Label>
              <TextField {...field('name')} autoComplete="cc-name" placeholder="Optional" />
            </div>
            <div>
              <Label>Billing ZIP or postcode</Label>
              <TextField {...field('postcode')} autoComplete="postal-code" placeholder="Optional" />
            </div>
            <Site {...field('site')} hint={siteHint} placeholder="www.amazon.com" problem={problems.site} />
          </>
        )}

        {kind === 'address' && (
          <>
            <AddressLines line1={field('line1')} line2={field('line2')} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>City</Label>
                <TextField {...field('city')} autoComplete="address-level2" />
              </div>
              <div>
                <Label>State or region</Label>
                <TextField {...field('state')} autoComplete="address-level1" placeholder="Optional" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>ZIP or postcode</Label>
                <TextField {...field('postcode')} autoComplete="postal-code" />
              </div>
              <div>
                <Label>Country</Label>
                <TextField {...field('country')} autoComplete="country-name" />
              </div>
            </div>
            <Site {...field('site')} hint={siteHint} placeholder="www.amazon.com" problem={problems.site} />
          </>
        )}
      </div>

      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease }}
            className="mt-5 px-4 text-footnote text-pretty text-danger"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-7">
        <Button type="submit" variant="accent" size="lg" disabled={!ready} loading={saving}>
          Save
        </Button>
      </div>
    </form>
  )
}

type FieldProps = {
  value: string
  onChange: (e: { target: { value: string } }) => void
  onBlur: () => void
  disabled: boolean
}

/** Where it's used: a site's address, which Hermes matches exactly before it fills anything in. */
function Site({
  hint,
  problem,
  ...props
}: FieldProps & { hint?: string; problem?: string; placeholder: string; autoFocus?: boolean }) {
  return (
    <Problem problem={problem}>
      <Label hint={hint}>Website</Label>
      <TextField
        {...props}
        inputMode="url"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
      />
    </Problem>
  )
}

function AddressLines({ line1, line2 }: { line1: FieldProps; line2: FieldProps }) {
  const id = useId()
  return (
    <div>
      <Label htmlFor={id}>Address</Label>
      <div className="space-y-2">
        <TextField id={id} {...line1} autoFocus autoComplete="address-line1" placeholder="Street and number" />
        <TextField
          {...line2}
          aria-label="Apartment, suite or floor"
          autoComplete="address-line2"
          placeholder="Apartment, suite or floor (optional)"
        />
      </div>
    </div>
  )
}

/** A field, and under it what's wrong with it once it's been left. */
function Problem({ problem, children }: { problem?: string; children: ReactNode }) {
  const shown = useRef(problem)
  if (problem) shown.current = problem
  return (
    <div className={cn(problem && '[&_input]:ring-danger/50!')}>
      {children}
      <AnimatePresence initial={false}>
        {problem && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease }}
            className="overflow-hidden px-4 text-footnote text-danger"
          >
            <span className="block pt-2">{shown.current}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
