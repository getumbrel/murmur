import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react'
import { Button } from '@/ui/button'
import { TextField } from '@/ui/field'
import { Orb } from '@/ui/orb'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import type { DeviceModel, DeviceSetup } from '@/state/local-jobs'
import { overall } from '@/state/local-jobs'
import { formatSize } from '@/state/local-tiers'
import { fitLine } from '@/state/local-hf'
import { Bloom } from './bloom'
import { emptyLine } from './connect-copy'
import { STEP_COLUMN, StepHeader } from './step'

// "Connect a model": the one decision Murmur needs before it can think.
// A few cards, one open at a time. The lead owns every async step and feeds
// progress back through `state`; this screen only renders it.

/** `device`: a model Hermes runs itself, on its own machine. `local`: a model server such as Ollama. */
export type ConnectOption = 'chatgpt' | 'device' | 'local' | 'api-key'

export type DeviceCode = { userCode: string; verificationUrl: string; /** epoch ms */ expiresAt: number }

export type ChatGPTFlow =
  | { status: 'idle' }
  | { status: 'starting' }
  /** A code is ready; nobody is polling yet. */
  | ({ status: 'code' } & DeviceCode)
  /** Code shown and Murmur is polling for the sign-in to land. */
  | ({ status: 'waiting' } & DeviceCode)
  | { status: 'success' }
  | { status: 'error'; message: string; kind: 'device_login_disabled' | 'expired' | 'other' }

export type LocalModel = { id: string; size: number | null; parameters: string | null }
export type LocalServer = { name: string; baseUrl: string; models: LocalModel[] }

export type ApiKeyService = 'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'xai'

export type ConnectState = {
  /** Which cards to show, in order. Defaults to all three. */
  options?: ConnectOption[]
  chatgpt: ChatGPTFlow
  local: {
    loading: boolean
    servers: LocalServer[]
    /** Model id being connected, if any. */
    connecting?: string | null
    /** Checking an address typed into "Use another server". */
    adding?: boolean
    addError?: string | null
  }
  apiKey: {
    validating: boolean
    /** Shown under the key field, e.g. "That key didn’t work. Check it and try again." */
    error?: string | null
  }
  /** Running a model on Hermes's own machine. Absent or unsupported: no card. */
  device?: {
    supported: boolean
    loading?: boolean
    /** Where Hermes is: "this Umbrel", "this computer", "VPS". */
    place: string
    /** Up to two, the suggestion first. */
    models: DeviceModel[]
    /** Even the suggestion is a squeeze: what's free right now. */
    tight?: { free: number } | null
    setup?: DeviceSetup | null
    /** Any other model on Hugging Face, typed in by name: being looked up, found, or not. */
    custom?: FindState | null
  }
}

export type FindState = { query: string; finding: boolean; model: DeviceModel | null; error: string | null }

export const API_KEY_SERVICES: { id: ApiKeyService; label: string; placeholder: string; keysUrl: string }[] = [
  { id: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-…', keysUrl: 'https://openrouter.ai/keys' },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-…', keysUrl: 'https://platform.openai.com/api-keys' },
  {
    id: 'anthropic',
    label: 'Anthropic',
    placeholder: 'sk-ant-…',
    keysUrl: 'https://console.anthropic.com/settings/keys',
  },
  { id: 'gemini', label: 'Gemini', placeholder: 'AIza…', keysUrl: 'https://aistudio.google.com/apikey' },
  { id: 'xai', label: 'xAI', placeholder: 'xai-…', keysUrl: 'https://console.x.ai' },
]

const CHATGPT_SECURITY_URL = 'https://chatgpt.com/#settings/Security'

type Props = {
  state: ConnectState
  onChooseChatGPT: () => void
  onChooseLocal: (server: LocalServer, model: LocalModel) => void
  onSubmitKey: (service: ApiKeyService, key: string) => void
  /** Look for models at an address the person types in. */
  onAddServer?: (url: string) => void
  onSkip?: () => void
  /** Shown once ChatGPT is connected, if the lead doesn't move on by itself. */
  onDone?: () => void
  /** Card to open on first render (playground, deep links). */
  defaultOpen?: ConnectOption | null
  /** Just the cards, for use inside a sheet. */
  embedded?: boolean
  /** Running on umbrelOS: local models live "on this Umbrel". */
  umbrel?: boolean
  /** Download a model (by its id in local-tiers.ts) and switch to it. */
  onRunDevice?: (id: string) => void
  onPauseDevice?: () => void
  onResumeDevice?: () => void
  onCancelDevice?: () => void
  /** Look a model up on Hugging Face by what someone typed. Absent: no "Use another model". */
  onFindDevice?: (query: string) => void
}

export function ConnectModel({
  state,
  onChooseChatGPT,
  onChooseLocal,
  onSubmitKey,
  onAddServer,
  onSkip,
  onDone,
  defaultOpen,
  embedded,
  umbrel,
  onRunDevice,
  onPauseDevice,
  onResumeDevice,
  onCancelDevice,
  onFindDevice,
}: Props) {
  const device = state.device?.supported && onRunDevice ? state.device : null
  const options = (state.options ?? ['chatgpt', 'device', 'local', 'api-key']).filter((o) => o !== 'device' || device)
  const setup = device?.setup ?? null
  const [open, setOpen] = useState<ConnectOption | null>(
    defaultOpen ?? (state.chatgpt.status !== 'idle' ? 'chatgpt' : setup ? 'device' : null),
  )
  // A sign-in that starts elsewhere (or resumes) opens its card; so does a download found under way.
  const [lastStatus, setLastStatus] = useState(state.chatgpt.status)
  if (state.chatgpt.status !== lastStatus) {
    setLastStatus(state.chatgpt.status)
    if (lastStatus === 'idle') setOpen('chatgpt')
  }
  const [hadSetup, setHadSetup] = useState(Boolean(setup))
  if (Boolean(setup) !== hadSetup) {
    setHadSetup(Boolean(setup))
    if (setup && open === null) setOpen('device')
  }
  const { servers, loading } = state.local
  const modelCount = servers.reduce((n, s) => n + s.models.length, 0)
  const emptyServers = servers.filter((s) => !s.models.length)

  // Opening a card only explains it; signing in is its own, deliberate tap.
  const toggle = (option: ConnectOption) => setOpen(open === option ? null : option)

  const cards: Record<ConnectOption, ReactNode> = {
    chatgpt: (
      <OptionCard
        key="chatgpt"
        glyph={
          state.chatgpt.status === 'success' ? (
            <Check key="ok" size={20} strokeWidth={2.25} className="animate-pop" />
          ) : (
            <Sparkles size={20} strokeWidth={1.75} />
          )
        }
        title="Continue with ChatGPT"
        subtitle="Use your ChatGPT Plus or Pro plan"
        open={open === 'chatgpt'}
        onToggle={() => toggle('chatgpt')}
      >
        <ChatGPTPanel flow={state.chatgpt} onStart={onChooseChatGPT} onDone={onDone} />
      </OptionCard>
    ),
    local: (
      <OptionCard
        key="local"
        glyph={<HardDrive size={20} strokeWidth={1.75} />}
        // Beside "Run a model on this Umbrel", this one is about servers.
        title={device ? 'Use a model server' : umbrel ? 'Use a model on this Umbrel' : 'Use a model on your network'}
        subtitle={
          loading ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner size={12} /> Looking for models…
            </span>
          ) : modelCount ? (
            servers
              .filter((s) => s.models.length)
              .map((s) => `${s.name} · ${plural(s.models.length, 'model')}`)
              .join(', ')
          ) : emptyServers.length ? (
            `${emptyServers[0].name} · no models yet`
          ) : onAddServer ? (
            device ? 'Ollama, LM Studio and others' : 'Ollama, LocalAI and others'
          ) : umbrel && !device ? (
            'Install Ollama from the Umbrel App Store to run models privately'
          ) : (
            'No model servers found'
          )
        }
        open={open === 'local'}
        disabled={!modelCount && !emptyServers.length && !onAddServer}
        onToggle={() => toggle('local')}
      >
        <LocalPanel
          servers={servers}
          connecting={state.local.connecting}
          onChoose={onChooseLocal}
          onAdd={onAddServer}
          adding={state.local.adding}
          addError={state.local.addError}
          umbrel={umbrel}
          device={Boolean(device)}
        />
      </OptionCard>
    ),
    device: device && (
      <OptionCard
        key="device"
        glyph={setup ? <ProgressGlyph setup={setup} /> : <Cpu size={20} strokeWidth={1.75} />}
        // While a model sets up, the tile wears its colour.
        hue={setup ? [...device.models, device.custom?.model].find((m) => m?.id === setup.id)?.hue : undefined}
        title={`Run a model on ${device.place}`}
        subtitle={
          device.loading ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner size={12} /> Checking what fits…
            </span>
          ) : setup ? (
            <span className="tabular-nums">{setupLine(setup)}</span>
          ) : (
            'Private and free'
          )
        }
        open={open === 'device'}
        disabled={device.loading}
        onToggle={() => toggle('device')}
      >
        <DevicePanel
          place={device.place}
          models={device.models}
          tight={device.tight}
          setup={setup}
          custom={device.custom}
          onRun={onRunDevice!}
          onFind={onFindDevice}
          onPause={onPauseDevice}
          onResume={onResumeDevice}
          onCancel={onCancelDevice}
        />
      </OptionCard>
    ),
    'api-key': (
      <OptionCard
        key="api-key"
        glyph={<KeyRound size={20} strokeWidth={1.75} />}
        title="Use an API key"
        subtitle="OpenRouter, OpenAI, Anthropic…"
        open={open === 'api-key'}
        onToggle={() => toggle('api-key')}
      >
        <ApiKeyPanel validating={state.apiKey.validating} error={state.apiKey.error} onSubmit={onSubmitKey} />
      </OptionCard>
    ),
  }

  // Full screen, the cards arrive one after another under the title.
  const list = (
    <div className="space-y-3">
      {options.map((o, i) => (
        <div
          key={o}
          className={cn(!embedded && 'animate-rise')}
          style={embedded ? undefined : { animationDelay: `${120 + i * 70}ms` }}
        >
          {cards[o]}
        </div>
      ))}
    </div>
  )
  if (embedded) return list

  return (
    <main className={`relative flex min-h-dvh flex-col pb-[max(16px,env(safe-area-inset-bottom))] safe-top md:justify-center md:py-12 ${STEP_COLUMN}`}>
      <StepHeader
        animate
        title="Connect a model"
        body="Murmur needs a model to think with. You can change this anytime."
        onSkip={onSkip}
        className="pb-8 md:pt-0"
      />
      {list}
    </main>
  )
}

function OptionCard({
  glyph,
  title,
  subtitle,
  open,
  disabled,
  hue,
  onToggle,
  children,
}: {
  glyph: ReactNode
  title: string
  subtitle: ReactNode
  open: boolean
  disabled?: boolean
  /** The tile's accent, when it isn't the app's. */
  hue?: number
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-2xl ring-1 ring-inset transition-[box-shadow,background-color] duration-300',
        open ? 'bg-elevated ring-line-strong shadow-float' : 'bg-fill-1 ring-transparent',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        className="flex w-full items-center gap-4 p-4 text-left transition-colors select-none focus-visible:-outline-offset-2 enabled:hover:bg-fill-1 enabled:active:bg-fill-2 disabled:cursor-default"
      >
        <span
          className={cn(
            // Settings' row tile, at card size: soft accent at rest, solid once chosen.
            'grid size-11 flex-none place-items-center rounded-md transition-colors duration-300',
            hue !== undefined && 'hue-scope',
            open ? 'bg-accent text-accent-ink' : disabled ? 'bg-fill-2 text-ink-3' : 'bg-accent-soft text-accent',
          )}
          style={hue !== undefined ? ({ '--hue': hue } as React.CSSProperties) : undefined}
        >
          {glyph}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-body font-semibold tracking-[-0.01em] text-pretty', disabled && 'text-ink-2')}>
            {title}
          </span>
          <span className="mt-0.5 block text-footnote text-pretty text-ink-2">{subtitle}</span>
        </span>
        {!disabled && (
          <ChevronDown
            size={18}
            className={cn(
              // Its stroke, not its box, meets the edge (as ListRow's chevrons do).
              '-mr-1 flex-none text-ink-3 transition-transform duration-300 ease-[var(--ease-out)]',
              open && 'rotate-180',
            )}
          />
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.26, ease: [0.32, 0.72, 0, 1] } }}
            transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="px-4 pt-1 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

// ── ChatGPT device sign-in ──────────────────────────────────────────────────

function ChatGPTPanel({ flow, onStart, onDone }: { flow: ChatGPTFlow; onStart: () => void; onDone?: () => void }) {
  return (
    <Measured>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={flow.status === 'waiting' ? 'code' : flow.status}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          {flow.status === 'idle' && (
            <div>
              <p className="text-subhead text-pretty text-ink-2">
                You’ll get a one-time code to enter on ChatGPT. Murmur never sees your password.
              </p>
              <Button size="lg" variant="accent" className="mt-4" onClick={onStart}>
                Get sign-in code
              </Button>
            </div>
          )}
          {flow.status === 'starting' && (
            <div className="flex h-24 items-center justify-center gap-2 text-subhead text-ink-2">
              <Spinner /> Getting a sign-in code…
            </div>
          )}
          {(flow.status === 'code' || flow.status === 'waiting') && <DeviceCodeView flow={flow} />}
          {flow.status === 'success' && (
            <div className="flex flex-col items-center py-4 text-center">
              <span className="hue-scope relative" style={{ '--hue': 150 } as React.CSSProperties}>
                <Bloom delay={0.1} />
                <motion.span
                  className="relative block"
                  initial={{ scale: 0.85 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', duration: 0.6, bounce: 0.35 }}
                >
                  <Orb hue={150} size={64} state="done" seed="chatgpt" />
                </motion.span>
              </span>
              <p className="mt-4 animate-rise text-body font-semibold [animation-delay:120ms]">You’re connected</p>
              <p className="mt-1 animate-rise text-subhead text-ink-2 [animation-delay:170ms]">
                Murmur will think with your ChatGPT plan.
              </p>
              {onDone && (
                <Button size="lg" variant="accent" className="mt-5" onClick={onDone}>
                  Continue
                </Button>
              )}
            </div>
          )}
          {flow.status === 'error' && <ChatGPTError error={flow} onRetry={onStart} />}
        </motion.div>
      </AnimatePresence>
    </Measured>
  )
}

/** Springs its height to fit whatever it holds, so swapping states never jumps. */
function Measured({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')
  useLayoutEffect(() => {
    const el = inner.current!
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <motion.div
      className="overflow-hidden"
      initial={false}
      animate={{ height }}
      transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  )
}

function DeviceCodeView({ flow }: { flow: Extract<ChatGPTFlow, { status: 'code' | 'waiting' }> }) {
  const [copied, setCopied] = useState(false)
  const left = useSecondsLeft(flow.expiresAt)

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(id)
  }, [copied])

  const copy = async () => setCopied(await copyText(flow.userCode))
  const openChatGPT = () => {
    void copy()
    window.open(flow.verificationUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div>
      <p className="text-subhead text-pretty text-ink-2">
        Open ChatGPT and enter this <span className="whitespace-nowrap">one-time code.</span>
      </p>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy code ${flow.userCode}`}
        className="pressable group mt-3 flex w-full flex-col items-center rounded-xl bg-fill-1 pt-5 pb-3 ring-1 ring-line ring-inset hover:bg-fill-2"
      >
        {/* The code types itself in, once. */}
        <span className="-mr-[0.2em] font-mono text-[1.75rem] leading-9 font-medium tracking-[0.2em] tabular-nums select-all">
          {[...flow.userCode].map((ch, i) => (
            <motion.span
              key={i}
              className="inline-block"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1], delay: 0.08 + i * 0.035 }}
            >
              {ch}
            </motion.span>
          ))}
        </span>
        <span className="mt-1.5 flex h-5 items-center gap-1 text-caption font-medium">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={String(copied)}
              className={cn('inline-flex items-center gap-1', copied ? 'text-success' : 'text-ink-3')}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.18 }}
            >
              {copied ? <Check size={13} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />}
              {copied ? 'Copied' : 'Copy code'}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>

      <Button size="lg" variant="accent" className="mt-3" onClick={openChatGPT}>
        Open ChatGPT
        <ArrowUpRight size={18} strokeWidth={2} />
      </Button>

      <div className="mt-4 flex items-center gap-2 text-footnote" aria-live="polite">
        {flow.status === 'waiting' ? (
          <>
            <Spinner size={14} className="text-ink-2" />
            <span className="min-w-0 truncate text-ink-2">Waiting for you to sign in…</span>
          </>
        ) : (
          <span className="min-w-0 truncate text-ink-3">Murmur notices when you’re done.</span>
        )}
        <span className="ml-auto flex-none whitespace-nowrap text-ink-3 tabular-nums">
          {left > 0 ? `Expires in ${formatClock(left)}` : 'Expired'}
        </span>
      </div>
    </div>
  )
}

function ChatGPTError({ error, onRetry }: { error: Extract<ChatGPTFlow, { status: 'error' }>; onRetry: () => void }) {
  const copy = {
    device_login_disabled: {
      title: 'Device code sign-in is off',
      body: 'Turn on device code sign-in in ChatGPT\u00a0→\u00a0Settings\u00a0→\u00a0Security, then try again.',
      retry: 'Try again',
    },
    expired: {
      title: 'That code expired',
      body: 'Codes only last a few minutes. Get a fresh one to keep going.',
      retry: 'Get a new code',
    },
    other: { title: 'Couldn’t sign in to ChatGPT', body: error.message, retry: 'Try again' },
  }[error.kind]

  return (
    <div className="flex flex-col items-center pt-2 text-center">
      <Orb
        hue={278}
        size={48}
        state={error.kind === 'device_login_disabled' ? 'waiting' : error.kind === 'expired' ? 'offline' : 'error'}
        seed="chatgpt"
      />
      <p className="mt-3 text-body font-semibold">{copy.title}</p>
      <p className="mt-1 max-w-[19rem] text-subhead text-balance text-ink-2">{copy.body}</p>
      <div className="mt-5 grid w-full gap-2">
        {error.kind === 'device_login_disabled' && (
          <Button
            size="lg"
            variant="accent"
            onClick={() => window.open(CHATGPT_SECURITY_URL, '_blank', 'noopener,noreferrer')}
          >
            Open ChatGPT settings
            <ArrowUpRight size={18} strokeWidth={2} />
          </Button>
        )}
        <Button size="lg" variant={error.kind === 'device_login_disabled' ? 'secondary' : 'accent'} onClick={onRetry}>
          {copy.retry}
        </Button>
      </div>
    </div>
  )
}

// ── Local models ────────────────────────────────────────────────────────────

function LocalPanel({
  servers,
  connecting,
  onChoose,
  onAdd,
  adding,
  addError,
  umbrel,
  device,
}: {
  servers: LocalServer[]
  connecting?: string | null
  onChoose: (server: LocalServer, model: LocalModel) => void
  onAdd?: (url: string) => void
  adding?: boolean
  addError?: string | null
  umbrel?: boolean
  /** Hermes can run a model itself (the card above), so there's no need to send anyone off to install one. */
  device?: boolean
}) {
  const shown = servers.filter((s) => s.models.length)
  // A server that answered but has nothing to offer (Ollama, freshly installed) is there, just empty.
  const empty = servers.find((s) => !s.models.length)
  return (
    <div className="space-y-4">
      {!shown.length && (
        <p className="text-subhead text-pretty text-ink-2">
          {empty
            ? emptyLine(empty, umbrel)
            : umbrel
              ? device
                ? 'No model servers on this Umbrel.'
                : 'Nothing found on this Umbrel yet. Install Ollama from the Umbrel App Store, or enter the address of a model server.'
              : 'Nothing found nearby yet. Enter the address of a computer running Ollama, LM Studio or LocalAI.'}
        </p>
      )}
      {shown.map((server) => (
        <div key={server.baseUrl}>
          {shown.length > 1 && <p className="mb-2 px-4 text-footnote font-medium text-ink-2">{server.name}</p>}
          <div className="list-group overflow-hidden rounded-xl bg-fill-1">
            {server.models.map((model) => {
              const busy = connecting === model.id
              const detail = [model.parameters, model.size != null && formatBytes(model.size)]
                .filter(Boolean)
                .join(' · ')
              return (
                <button
                  key={model.id}
                  type="button"
                  disabled={!!connecting}
                  onClick={() => onChoose(server, model)}
                  title={prettyModel(model.id)}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors select-none focus-visible:-outline-offset-2 enabled:hover:bg-fill-1 enabled:active:bg-fill-2 disabled:cursor-default"
                >
                  <span className={cn('min-w-0 flex-1', connecting && !busy && 'opacity-40')}>
                    <span className="block truncate text-body">{prettyModel(model.id)}</span>
                    {detail && <span className="block text-footnote text-ink-2">{detail}</span>}
                  </span>
                  {busy ? (
                    <Spinner className="text-ink-2" />
                  ) : (
                    <ChevronRight size={18} className="-mr-1.5 flex-none text-ink-3" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {onAdd && <AddServer onAdd={onAdd} adding={adding} error={addError} collapsed={shown.length > 0} />}
      {shown.length > 0 && (
        <p className="px-4 text-footnote text-pretty text-ink-3">
          {umbrel ? 'Runs privately on your Umbrel.' : 'Runs privately on your own computer.'} Nothing leaves your
          home.
        </p>
      )}
    </div>
  )
}

function AddServer({
  onAdd,
  adding,
  error,
  collapsed,
}: {
  onAdd: (url: string) => void
  adding?: boolean
  error?: string | null
  collapsed: boolean
}) {
  const [open, setOpen] = useState(!collapsed)
  const [url, setUrl] = useState('')
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable flex h-11 items-center rounded-md text-subhead font-medium text-accent select-none"
      >
        Use another server
      </button>
    )
  return (
    <form
      className="animate-fade"
      onSubmit={(e) => {
        e.preventDefault()
        if (url.trim()) onAdd(url.trim())
      }}
    >
      <div className="flex gap-2">
        <TextField
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="192.168.1.20:11434"
          aria-label="Server address"
          aria-invalid={!!error}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={collapsed}
          className={cn('min-w-0 flex-1', error && 'ring-danger/60! focus:ring-danger/70!')}
        />
        <Button type="submit" variant="secondary" className="h-12 flex-none" loading={adding} disabled={!url.trim()}>
          Find models
        </Button>
      </div>
      <p
        className={cn('mt-2 px-1 text-footnote text-balance', error ? 'text-danger' : 'text-ink-3')}
        aria-live="polite"
      >
        {error ?? 'Ollama, LM Studio or LocalAI on another computer works too.'}
      </p>
    </form>
  )
}

// ── A model on Hermes's own machine ─────────────────────────────────────────

const ease = [0.16, 1, 0.3, 1] as const

function DevicePanel({
  place,
  models,
  tight,
  setup,
  custom,
  onRun,
  onFind,
  onPause,
  onResume,
  onCancel,
}: {
  place: string
  models: DeviceModel[]
  tight?: { free: number } | null
  setup: DeviceSetup | null
  custom?: FindState | null
  onRun: (id: string) => void
  onFind?: (query: string) => void
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
}) {
  // A model found by name joins the list, chosen.
  const found = custom?.model ?? null
  const [chosen, setChosen] = useState<string | null>(found?.id ?? null)
  const [lastFound, setLastFound] = useState(found)
  if (found !== lastFound) {
    setLastFound(found)
    if (found) setChosen(found.id)
  }
  const all = found && !models.some((m) => m.id === found.id) ? [...models, found] : models
  const selected = all.find((m) => m.id === (setup?.id ?? chosen)) ?? all[0]
  // A setup for a model no longer offered (the machine changed) still shows.
  const running = setup ? (all.find((m) => m.id === setup.id) ?? null) : null
  const where = place.replace(/^this /, 'your ')
  const finder = onFind && !setup && <FindModel state={custom} onFind={onFind} collapsed={all.length > 0} />
  if (!selected)
    return (
      <div className="space-y-3">
        <p className="text-subhead text-pretty text-ink-2">Nothing fits {place} right now.</p>
        {finder}
      </div>
    )
  const list = running ? [running] : all
  const fit = selected.hf?.fit
  // What to say above the button: a squeeze, or why it can't be.
  const note =
    fit && fit !== 'fits'
      ? fitLine(selected.hf!)
      : !fit && tight
        ? `About ${formatSize(tight.free)} free right now. Closing an app or two helps.`
        : null
  // A long name found by name would wrap the button; the card above says which.
  const label = selected.name.length > 20 ? '' : ` ${selected.name}`
  return (
    <div>
      <div role={running ? undefined : 'radiogroup'} aria-label="Model" className="space-y-2">
        <AnimatePresence initial={false} mode="popLayout">
          {list.map((m) => (
            <motion.div
              key={m.id}
              layout="position"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
              transition={{ duration: 0.3, ease }}
            >
              <ModelCard
                model={m}
                where={where}
                choice={list.length > 1}
                selected={m.id === selected.id}
                setup={setup?.id === m.id ? setup : null}
                onSelect={() => setChosen(m.id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence initial={false} mode="popLayout">
        {setup ? (
          // Starting up and ready are moments to watch, not to manage.
          setup.stage !== 'starting' &&
          setup.stage !== 'ready' && (
            <motion.div
              key="actions"
              className="mt-2 flex min-h-11 items-center justify-end gap-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
            >
              {setup.stage === 'error' ? (
                <>
                  <QuietButton onClick={onCancel}>Cancel</QuietButton>
                  <QuietButton strong onClick={() => onRun(setup.id)}>
                    Try again
                  </QuietButton>
                </>
              ) : setup.stage === 'paused' ? (
                <>
                  <QuietButton onClick={onCancel}>Cancel</QuietButton>
                  <QuietButton strong onClick={onResume}>
                    Resume
                  </QuietButton>
                </>
              ) : (
                <>
                  {setup.canPause && onPause && <QuietButton onClick={onPause}>Pause</QuietButton>}
                  <QuietButton onClick={onCancel}>Cancel</QuietButton>
                </>
              )}
            </motion.div>
          )
        ) : (
          <motion.div
            key="go"
            className="hue-scope mt-2"
            style={{ '--hue': selected.hue } as React.CSSProperties}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            {finder}
            {note && (
              <p className="mt-2 px-1 text-footnote text-pretty text-ink-2" aria-live="polite">
                <span
                  className={cn(
                    'mr-1.5 inline-block size-1.5 -translate-y-px rounded-full align-middle',
                    fit === 'too-big' ? 'bg-danger' : 'bg-warning',
                  )}
                />
                {note}
              </p>
            )}
            <Button
              size="lg"
              variant="accent"
              className="mt-3"
              disabled={fit === 'too-big'}
              onClick={() => onRun(selected.id)}
            >
              {selected.downloaded ? `Use${label || ' it'}` : `Download${label}`}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * "Use another model": any GGUF on Hugging Face, by name. A link until
 * asked for; once a model's found, its card above is the answer and this
 * folds away again.
 */
function FindModel({
  state,
  onFind,
  collapsed,
}: {
  state?: FindState | null
  onFind: (query: string) => void
  collapsed: boolean
}) {
  const [open, setOpen] = useState(!collapsed || Boolean(state?.finding || state?.error))
  const [query, setQuery] = useState(state?.query ?? '')
  const finding = Boolean(state?.finding)
  const error = state?.error ?? null
  const [wasFinding, setWasFinding] = useState(finding)
  if (finding !== wasFinding) {
    setWasFinding(finding)
    if (!finding && !error && state?.model) setOpen(false)
  }
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable -ml-1 flex h-10 items-center rounded-md px-1 text-subhead font-medium text-ink-2 select-none hover:text-ink"
      >
        Use another model
      </button>
    )
  return (
    <form
      className="animate-fade pt-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (query.trim()) onFind(query.trim())
      }}
    >
      <div className="relative">
        <TextField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="unsloth/Qwen3.5-9B-GGUF:Q4_K_M"
          aria-label="Model on Hugging Face"
          aria-invalid={!!error}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={collapsed && !state?.query}
          className={cn('pr-12 text-subhead', error && 'ring-danger/60! focus:ring-danger/70!')}
        />
        <button
          type="submit"
          disabled={!query.trim() || finding}
          aria-label="Find this model"
          className="absolute top-0 right-0 grid size-12 place-items-center rounded-xl text-ink transition-colors select-none focus-visible:-outline-offset-2 disabled:text-ink-3"
        >
          {finding ? <Spinner size={16} className="text-ink-2" /> : <ArrowRight size={18} strokeWidth={2} />}
        </button>
      </div>
      <p className={cn('mt-2 px-1 text-footnote text-pretty', error ? 'text-danger' : 'text-ink-3')} aria-live="polite">
        {error ?? 'Any GGUF model on Hugging Face.'}
      </p>
    </form>
  )
}

function ModelCard({
  model,
  where,
  choice,
  selected,
  setup,
  onSelect,
}: {
  model: DeviceModel
  where: string
  /** One of two: a radio. */
  choice: boolean
  selected: boolean
  setup: DeviceSetup | null
  onSelect: () => void
}) {
  const busy = Boolean(setup)
  const state = !setup
    ? 'idle'
    : setup.stage === 'ready'
      ? 'done'
      : setup.stage === 'error'
        ? 'error'
        : setup.stage === 'paused'
          ? 'waiting'
          : 'working'
  const body = (
    <>
      <span className="relative flex-none">
        {setup?.stage === 'ready' && <Bloom />}
        <Orb hue={model.hue} size={44} state={state} seed={model.id} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-body font-semibold tracking-[-0.01em]">{model.name}</span>
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* While it downloads, the bar says the size. */}
          {!busy && <Chip>{model.downloaded ? 'Downloaded' : formatSize(model.bytes)}</Chip>}
          {model.hf && <Chip>{model.hf.quant}</Chip>}
          {model.speed && <Chip>{model.speed}</Chip>}
          {model.smarts && <Chip>{model.smarts}</Chip>}
          {((model.recommended && model.fits) || model.hf?.fit === 'fits') && !busy && (
            <span className="inline-flex h-6 items-center gap-1 pl-0.5 text-caption font-medium text-success">
              <Check size={13} strokeWidth={2.5} />
              Fits {where}
            </span>
          )}
          {model.hf && model.hf.fit !== 'fits' && !busy && (
            <span
              className={cn(
                'inline-flex h-6 items-center gap-1.5 pl-0.5 text-caption font-medium',
                model.hf.fit === 'tight' ? 'text-warning' : 'text-danger',
              )}
            >
              <span className="size-1.5 rounded-full bg-current" />
              {model.hf.fit === 'tight' ? 'Tight fit' : 'Too big'}
            </span>
          )}
        </span>
      </span>
      {!busy && choice && (
        <span
          aria-hidden
          className={cn(
            'grid size-5.5 flex-none place-items-center rounded-full ring-1 ring-inset transition-colors duration-200',
            selected ? 'bg-accent ring-accent text-accent-ink' : 'ring-line-strong',
          )}
        >
          {selected && <Check size={13} strokeWidth={3} className="animate-pop" />}
        </span>
      )}
    </>
  )
  const frame = cn(
    'hue-scope flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1 ring-inset transition-[background-color,box-shadow] duration-200',
    selected ? 'bg-accent-soft ring-accent/40' : 'bg-fill-1 ring-transparent',
  )
  const hue = { '--hue': model.hue } as React.CSSProperties
  if (!setup && !choice)
    return (
      <div className={frame} style={hue}>
        {body}
      </div>
    )
  if (!setup)
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className={cn(frame, 'pressable select-none focus-visible:-outline-offset-2 enabled:hover:bg-fill-2')}
        style={hue}
      >
        {body}
      </button>
    )
  return (
    <div className={cn(frame, 'flex-wrap')} style={hue}>
      {body}
      <SetupProgress setup={setup} />
    </div>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full bg-fill-2 px-2 text-caption font-medium text-ink-2 tabular-nums">
      {children}
    </span>
  )
}

function QuietButton({ strong, onClick, children }: { strong?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'pressable h-11 rounded-md px-3 text-subhead font-medium select-none',
        strong ? 'text-accent' : 'text-ink-3 hover:text-ink-2',
      )}
    >
      {children}
    </button>
  )
}

/** One bar for the whole setup, and one line under it. */
function SetupProgress({ setup }: { setup: DeviceSetup }) {
  const value = overall(setup)
  const waiting = setup.stage === 'preparing' || setup.stage === 'starting'
  const right =
    setup.stage === 'downloading' && setup.eta != null
      ? formatEta(setup.eta)
      : setup.stage === 'downloading' || setup.stage === 'paused'
        ? `${Math.round(value * 100)}%`
        : null
  return (
    <div className="w-full pt-1" aria-live="polite">
      <div
        role="progressbar"
        aria-label="Setting up the model"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        className="relative h-1.5 overflow-hidden rounded-full bg-fill-2"
      >
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-700 ease-[var(--ease-out)] motion-reduce:transition-none',
            setup.stage === 'error'
              ? 'bg-danger'
              : setup.stage === 'paused'
                ? 'bg-ink-3'
                : setup.stage === 'ready'
                  ? 'bg-success'
                  : 'bg-accent',
          )}
          style={{ width: `${value * 100}%` }}
        />
        {waiting && <div className="progress-sweep absolute inset-0" />}
      </div>
      <div className="mt-2 flex items-center gap-2 text-footnote">
        <span
          className={cn('min-w-0 flex-1', setup.stage === 'error' ? 'text-pretty text-danger' : 'truncate text-ink-2')}
        >
          {setup.stage === 'ready' ? (
            <span className="inline-flex animate-fade items-center gap-1 font-medium text-success">
              <Check size={14} strokeWidth={2.5} /> Ready
            </span>
          ) : (
            stageLine(setup)
          )}
        </span>
        {right && <span className="flex-none text-ink-3 tabular-nums">{right}</span>}
      </div>
    </div>
  )
}

/** The card's tile while a setup runs: a ring filling up. */
function ProgressGlyph({ setup }: { setup: DeviceSetup }) {
  const value = overall(setup)
  if (setup.stage === 'ready') return <Check size={20} strokeWidth={2.25} className="animate-pop" />
  const r = 8.5
  const c = 2 * Math.PI * r
  return (
    <svg width={22} height={22} viewBox="0 0 22 22" aria-hidden className="-rotate-90">
      <circle cx={11} cy={11} r={r} fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={2.25} />
      <circle
        cx={11}
        cy={11}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.04, value))}
        className="transition-[stroke-dashoffset] duration-700 ease-[var(--ease-out)] motion-reduce:transition-none"
      />
    </svg>
  )
}

function stageLine(setup: DeviceSetup) {
  switch (setup.stage) {
    case 'preparing':
      return 'Getting ready…'
    case 'starting':
      return 'Starting up…'
    case 'error':
      return setup.error ?? 'Something went wrong.'
    case 'paused':
    case 'downloading':
      return setup.total
        ? `${formatSize(setup.done)} of ${formatSize(setup.total)}${setup.stage === 'paused' ? ' · Paused' : ''}`
        : setup.stage === 'paused'
          ? 'Paused'
          : 'Downloading…'
    default:
      return ''
  }
}

/** The collapsed card's one line: "Downloading · 45%". */
function setupLine(setup: DeviceSetup) {
  const pct = `${Math.round(overall(setup) * 100)}%`
  switch (setup.stage) {
    case 'preparing':
      return 'Getting ready…'
    case 'downloading':
      return `Downloading · ${pct}`
    case 'paused':
      return `Paused · ${pct}`
    case 'starting':
      return 'Starting up…'
    case 'ready':
      return 'Ready'
    case 'error':
      return 'Didn’t finish'
  }
}

function formatEta(seconds: number) {
  if (seconds < 60) return 'Under a minute'
  const min = Math.round(seconds / 60)
  return min < 90 ? `${min} min left` : `${Math.round(min / 60)} hr left`
}

// ── API key ─────────────────────────────────────────────────────────────────

function ApiKeyPanel({
  validating,
  error,
  onSubmit,
}: {
  validating: boolean
  error?: string | null
  onSubmit: (service: ApiKeyService, key: string) => void
}) {
  const [service, setService] = useState<ApiKeyService>('openrouter')
  const [key, setKey] = useState('')
  const [reveal, setReveal] = useState(false)
  const info = API_KEY_SERVICES.find((s) => s.id === service)!

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (key.trim()) onSubmit(service, key.trim())
      }}
    >
      <div role="radiogroup" aria-label="Service" className="flex flex-wrap gap-2">
        {API_KEY_SERVICES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={s.id === service}
            onClick={() => setService(s.id)}
            className={cn(
              'pressable h-11 rounded-full px-4 text-subhead font-medium',
              s.id === service ? 'bg-ink text-bg' : 'bg-fill-2 text-ink-2 hover:text-ink',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="relative mt-4">
        <TextField
          type={reveal ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={info.placeholder}
          aria-label={`${info.label} API key`}
          aria-invalid={!!error}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn('pr-12 font-mono text-[0.9375rem]', error && 'ring-danger/60! focus:ring-danger/70!')}
        />
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          aria-label={reveal ? 'Hide key' : 'Show key'}
          className="absolute top-0 right-0 grid size-12 place-items-center rounded-xl text-ink-3 transition-colors select-none hover:text-ink-2 focus-visible:-outline-offset-2 active:text-ink"
        >
          {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>

      <p className={cn('mt-2 px-1 text-footnote', error ? 'text-danger' : 'text-ink-3')} aria-live="polite">
        {error ?? (
          <>
            Get a key at{' '}
            <a
              href={info.keysUrl}
              target="_blank"
              rel="noreferrer"
              className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
            >
              {new URL(info.keysUrl).host}
            </a>
          </>
        )}
      </p>

      <Button type="submit" size="lg" variant="accent" className="mt-4" loading={validating} disabled={!key.trim()}>
        Connect
      </Button>
    </form>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function useSecondsLeft(expiresAt: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return Math.max(0, Math.round((expiresAt - now) / 1000))
}

const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const plural = (n: number, word: string) => `${n}\u00a0${word}${n === 1 ? '' : 's'}`

function formatBytes(bytes: number) {
  const gb = bytes / 1e9
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)}\u00a0GB` : `${Math.round(bytes / 1e6)}\u00a0MB`
}

/** "llama3.2:3b" → "llama3.2 3b"; "latest" tags add nothing. */
const prettyModel = (id: string) => id.replace(/:latest$/, '').replace(':', ' ')

// umbrel.local is plain http, where navigator.clipboard doesn't exist.
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const el = Object.assign(document.createElement('textarea'), { value: text })
    el.style.cssText = 'position:fixed;opacity:0'
    document.body.append(el)
    el.select()
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  }
}
