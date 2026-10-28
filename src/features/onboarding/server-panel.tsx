import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState, type FormEvent } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/ui/button'
import { Label, SecretField } from '@/ui/field'
import { Grow } from '@/ui/grow'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import { Field, Note, StatusDot } from '@/features/connection/fields'
import { SearchField } from '@/features/search/search-field'
import { prettyModel } from '@/features/model/names'
import { emptyLine, privacyLine } from './connect-copy'
import { addressesFor, hostOf, serverName, ServerProblem, type ModelServer, type ServerModel } from './servers'

// "Use a model server": the servers Murmur found by itself, each with its
// models, and a form for any other, at home or online. The form asks the
// server as its address is left, so a server that wants a key opens the key
// field by itself. Settings uses the same form to move a saved server or
// change its key.

const ease = [0.32, 0.72, 0, 1] as const

/** Which model is being connected: one per server. */
export const choiceKey = (server: ModelServer, model: ServerModel) => `${server.baseUrl} ${model.id}`

export function ServerPanel({
  servers,
  connecting,
  error,
  onChoose,
  onFind,
  onFound,
  umbrel,
  device,
}: {
  servers: ModelServer[]
  /** choiceKey() of the model being connected. */
  connecting?: string | null
  /** Why the last model picked didn't connect. */
  error?: string | null
  onChoose: (server: ModelServer, model: ServerModel) => void
  /** What's at an address; throws a ServerProblem saying what's wrong. */
  onFind?: (address: string, apiKey?: string) => Promise<ModelServer>
  /** A server found that way, to join `servers`. */
  onFound?: (server: ModelServer) => void
  umbrel?: boolean
  /** Hermes can run a model itself (the card above), so there's no need to send anyone off to install one. */
  device?: boolean
}) {
  const shown = servers.filter((s) => s.models.length)
  // A server that answered but has nothing to offer (Ollama, freshly installed) is there, just empty.
  const empty = servers.find((s) => !s.models.length)
  const [adding, setAdding] = useState(!shown.length)
  const line = privacyLine(shown, umbrel)
  const intro = !shown.length
    ? empty
      ? emptyLine(empty, umbrel)
      : umbrel && !device
        ? 'Nothing on this Umbrel yet. Install Ollama from the Umbrel App Store, or connect to any model server below.'
        : null
    : null

  return (
    <Grow>
      <div className="space-y-4">
        {intro && <p className="text-subhead text-pretty text-ink-2">{intro}</p>}
        <AnimatePresence initial={false}>
          {shown.map((server) => (
            <motion.div
              key={server.baseUrl}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
            >
              {shown.length > 1 && (
                <p className="mb-2 flex items-baseline gap-1.5 px-4 text-footnote">
                  <span className="font-medium text-ink-2">{server.name}</span>
                  {server.name !== hostOf(server.baseUrl) && (
                    <span className="truncate text-ink-3">{hostOf(server.baseUrl)}</span>
                  )}
                </p>
              )}
              <ModelList server={server} connecting={connecting} onChoose={onChoose} />
            </motion.div>
          ))}
        </AnimatePresence>
        {/* About the models above, so it sits with them, before any other server. */}
        {line && <p className="-mt-2 px-4 text-footnote text-pretty text-ink-3">{line}</p>}
        {error && <p className="px-4 text-footnote text-pretty text-danger">{error}</p>}
        {onFind &&
          (adding ? (
            <div className={cn(shown.length > 0 && 'animate-fade pt-1')}>
              <ServerForm
                autoFocus={shown.length > 0}
                onCheck={onFind}
                // Found: its models are the next step, so the form folds away.
                onSubmit={async (fields) => onFound?.(await onFind(fields.address, fields.apiKey))}
                onDone={() => setAdding(false)}
                submitLabel="Find models"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="pressable flex h-11 animate-fade items-center rounded-md px-4 text-subhead font-medium text-accent select-none"
            >
              Use another server
            </button>
          ))}
      </div>
    </Grow>
  )
}

// ── A server's models ───────────────────────────────────────────────────────

/** More than this, and the list can be searched; it (or what's found) shows FEW until asked for the rest. */
const MANY = 8
const FEW = 6

function ModelList({
  server,
  connecting,
  onChoose,
}: {
  server: ModelServer
  connecting?: string | null
  onChoose: (server: ModelServer, model: ServerModel) => void
}) {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const many = server.models.length > MANY
  const q = query.trim().toLowerCase()
  const matches = q
    ? server.models.filter((m) => `${m.id} ${prettyModel(m.id)}`.toLowerCase().includes(q))
    : server.models
  const rows = matches.length > MANY && !all ? matches.slice(0, FEW) : matches

  return (
    <div className="space-y-2">
      {many && (
        <SearchField value={query} onValueChange={setQuery} placeholder={`Search ${server.models.length} models`} />
      )}
      <div className="list-group overflow-hidden rounded-xl bg-fill-1">
        {rows.map((model) => {
          const key = choiceKey(server, model)
          const busy = connecting === key
          // Where it's from says which, when two share a name ("meta-llama", "Qwen").
          const from = model.id.includes('/') ? model.id.split('/')[0] : null
          const detail = [model.parameters, model.size != null && formatBytes(model.size), from]
            .filter(Boolean)
            .join(' · ')
          return (
            <button
              key={model.id}
              type="button"
              disabled={!!connecting}
              onClick={() => onChoose(server, model)}
              title={model.id}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors select-none focus-visible:-outline-offset-2 enabled:hover:bg-fill-1 enabled:active:bg-fill-2 disabled:cursor-default"
            >
              <span className={cn('min-w-0 flex-1', connecting && !busy && 'opacity-40')}>
                <span className="block truncate text-body">{prettyModel(model.id)}</span>
                {detail && <span className="block truncate text-footnote text-ink-2">{detail}</span>}
              </span>
              {busy ? (
                <Spinner className="text-ink-2" />
              ) : (
                <ChevronRight size={18} className="-mr-1.5 flex-none text-ink-3" />
              )}
            </button>
          )
        })}
        {rows.length < matches.length && (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="flex min-h-12 w-full items-center px-4 text-left text-subhead font-medium text-accent transition-colors select-none focus-visible:-outline-offset-2 hover:bg-fill-1 active:bg-fill-2"
          >
            Show all {matches.length}
          </button>
        )}
        {!matches.length && (
          <p className="px-4 py-3.5 text-subhead text-pretty text-ink-2">No models match “{query.trim()}”.</p>
        )}
      </div>
    </div>
  )
}

// ── Any other server ────────────────────────────────────────────────────────

type Fields = { address: string; apiKey?: string }

/** What the server said as its address was left: its name and models, or that it wants a key. */
type Look = { name: string; models?: number; needsKey?: boolean }

/**
 * An address, and the key when the server wants one. New (onboarding, "Add a
 * service"): `submitLabel` finds the server. With `saved` (Settings), it's
 * that server's address and key, and Save shows only once something changes;
 * closing the key field removes the saved key, as does a new address.
 */
export function ServerForm({
  saved,
  onCheck,
  onSubmit,
  onDone,
  submitLabel,
  doneLabel,
  autoFocus,
}: {
  saved?: { address: string; hasKey: boolean }
  /** Asked quietly as the address is left; only "it wants a key" changes anything. */
  onCheck?: (address: string, apiKey?: string) => Promise<ModelServer>
  /** Throws a ServerProblem (or an Error) to say what's wrong; `apiKey` is undefined for "as it is", '' for none. */
  onSubmit: (fields: Fields) => Promise<void>
  /** After it worked (a beat later, with `doneLabel`). */
  onDone?: () => void
  submitLabel: string
  /** Shown on the button once it worked: "Saved". */
  doneLabel?: string
  autoFocus?: boolean
}) {
  const [address, setAddress] = useState(saved?.address ?? '')
  const [key, setKey] = useState('')
  const [keyOpen, setKeyOpen] = useState(!!saved?.hasKey)
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle')
  const [problem, setProblem] = useState<ServerProblem | null>(null)
  const [look, setLook] = useState<Look | null>(null)
  const [probing, setProbing] = useState(false)
  const probed = useRef<string | undefined>(saved?.address)
  const keyRef = useRef<HTMLInputElement>(null)

  // A saved key stays with its address: it's never sent anywhere new without being typed again.
  const keyKept = !!saved?.hasKey && sameUrl(address, saved.address)
  // Typed: that one. Open and empty: the saved one, where it's kept. Otherwise none, so a saved one goes.
  const apiKey = keyOpen && key.trim() ? key.trim() : keyOpen && keyKept ? undefined : saved?.hasKey ? '' : undefined
  const unchanged = !!saved && sameUrl(address, saved.address) && apiKey === undefined

  const openKey = () => {
    setKeyOpen(true)
    // After the disclosure has opened.
    setTimeout(() => keyRef.current?.focus(), 320)
  }

  const check = async () => {
    const typed = address.trim()
    if (!onCheck || !typed || probed.current === typed || phase !== 'idle') return
    let name: string
    try {
      name = serverName(addressesFor(typed).urls[0])
    } catch {
      return // Submit says what's wrong with it.
    }
    probed.current = typed
    setProbing(true)
    try {
      const found = await onCheck(typed, keyOpen ? key.trim() || undefined : undefined)
      if (probed.current === typed) setLook({ name: found.name, models: found.models.length })
    } catch (e) {
      if (probed.current !== typed) return
      // Leaving the field only opens doors; problems wait for the button.
      const wantsKey = e instanceof ServerProblem && e.kind === 'needs-key'
      setLook(wantsKey ? { name, needsKey: true } : null)
      if (wantsKey && !keyOpen) openKey()
    } finally {
      setProbing(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const typed = address.trim()
    if (!typed || phase !== 'idle' || unchanged) return
    setPhase('busy')
    setProblem(null)
    try {
      await onSubmit({ address: typed, apiKey })
    } catch (err) {
      setPhase('idle')
      let p =
        err instanceof ServerProblem
          ? err
          : new ServerProblem(
              (err instanceof Error && err.message) || 'Something went wrong. Try again.',
              'unreachable',
            )
      // Its saved key was being dropped, but it needs one: the key comes back, and that's said.
      if (p.kind === 'needs-key' && keyKept)
        p = new ServerProblem('This server needs its key, so the key stays.', 'needs-key')
      setProblem(p)
      if (p.field === 'key') {
        if (!keyOpen) openKey()
        else keyRef.current?.select()
      }
      return
    }
    if (!doneLabel) {
      setPhase('idle')
      return onDone?.()
    }
    setPhase('done')
    setTimeout(() => onDone?.(), 900)
  }

  const editAddress = (value: string) => {
    setAddress(value)
    probed.current = undefined
    setLook(null)
    if (problem?.field === 'address' || problem?.kind === 'needs-key') setProblem(null)
  }
  const editKey = (value: string) => {
    setKey(value)
    if (problem?.field === 'key') setProblem(null)
  }

  const addressError = problem?.field === 'address' ? problem.message : undefined
  const keyProblem = problem?.field === 'key' ? problem : null
  const host = (() => {
    try {
      return hostOf(addressesFor(address).urls[0])
    } catch {
      return ''
    }
  })()

  // Baseline-aligned, so the words (not the dot's box) sit on the label's baseline.
  const hint = probing ? (
    <span className="inline-flex items-baseline gap-1.5">
      <Spinner size={11} className="self-center" />
      Checking…
    </span>
  ) : look ? (
    <span className="inline-flex items-baseline gap-1.5 text-ink-2 tabular-nums">
      <span className="flex self-center">
        <StatusDot tone={look.needsKey ? 'warning' : 'success'} />
      </span>
      {look.needsKey
        ? look.name === host
          ? 'Wants a key'
          : look.name
        : [look.name !== host && look.name, plural(look.models ?? 0, 'model')].filter(Boolean).join(' · ')}
    </span>
  ) : undefined

  const button = (
    <Button
      type="submit"
      size="lg"
      variant="accent"
      loading={phase === 'busy'}
      disabled={!address.trim() || (unchanged && phase === 'idle')}
      className={cn(phase === 'done' && 'bg-success! text-accent-ink! opacity-100!')}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={phase === 'done' ? 'done' : 'go'}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          className="inline-flex items-center gap-2"
        >
          {phase === 'done' ? (
            <>
              <Check size={18} strokeWidth={2.5} /> {doneLabel}
            </>
          ) : (
            submitLabel
          )}
        </motion.span>
      </AnimatePresence>
    </Button>
  )

  return (
    <form onSubmit={submit} noValidate>
      <div>
        <Label hint={hint}>Address</Label>
        <Field
          value={address}
          onChange={(e) => editAddress(e.target.value)}
          onBlur={check}
          placeholder="192.168.1.20:11434"
          inputMode="url"
          type="url"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-label="Server address"
          invalid={!!addressError}
        />
        <Note tone="danger">{addressError}</Note>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => (keyOpen ? setKeyOpen(false) : openKey())}
          aria-expanded={keyOpen}
          // px-4: the words start on the Label line above, like every label.
          className="pressable flex min-h-11 items-center gap-1.5 rounded-md px-4 text-subhead text-ink-2 select-none hover:text-ink active:text-ink"
        >
          This server needs an API key
          <ChevronDown
            size={16}
            className={cn('transition-transform duration-300 ease-[var(--ease-out)]', keyOpen && 'rotate-180')}
          />
        </button>
        <AnimatePresence initial={false}>
          {keyOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.26, ease } }}
              transition={{ duration: 0.34, ease }}
              className="-mx-1 overflow-hidden px-1"
            >
              <div className="pt-2 pb-1">
                <SecretField
                  ref={keyRef}
                  value={key}
                  onChange={(e) => editKey(e.target.value)}
                  placeholder={keyKept ? 'Saved' : 'API key'}
                  aria-label="API key"
                  aria-invalid={keyProblem?.kind === 'bad-key' || undefined}
                  className={cn(
                    'font-mono text-[0.9375rem] placeholder:font-sans',
                    keyProblem?.kind === 'bad-key' && 'ring-danger/50! focus:ring-danger/70!',
                  )}
                />
              </div>
              <Note tone={keyProblem?.kind === 'bad-key' ? 'danger' : 'quiet'}>
                {keyProblem?.message ?? 'Hermes keeps it, and sends it only to this server.'}
              </Note>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Closing it is how a saved key goes: said, so Save isn't a surprise. */}
        <Note>{saved?.hasKey && !keyOpen ? 'Saving removes its key.' : undefined}</Note>
      </div>

      {saved ? (
        <AnimatePresence initial={false}>
          {(!unchanged || phase !== 'idle') && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.24, ease } }}
              transition={{ duration: 0.3, ease }}
              className="overflow-hidden"
            >
              <div className="pt-5">{button}</div>
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        <div className="pt-4">{button}</div>
      )}
    </form>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function formatBytes(bytes: number) {
  const gb = bytes / 1e9
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(bytes / 1e6)} MB`
}

function sameUrl(a: string, b: string) {
  const clean = (s: string) =>
    s
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
  return clean(a) === clean(b)
}
