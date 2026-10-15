import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Sheet } from '@/ui/sheet'
import { Button } from '@/ui/button'
import { Buddy, type BuddyState } from '@/ui/buddy'
import { ConfirmCard } from '@/ui/confirm-card'
import { Grow } from '@/ui/grow'
import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import { useIsWide, useMedia } from '@/lib/use-media'
import type { Agent } from '@/state/agents'
import {
  cancelLink,
  chatLink,
  disconnectWhatsApp,
  linkActive,
  phoneLabel,
  startLink,
  useLinks,
  useWhatsApp,
  whatsappKey,
  type Link,
  type LinkPhase,
  type WhatsAppAccount,
  type WhatsAppMode,
  type WhatsAppStatus,
} from '@/state/whatsapp'
import { QrCode } from '@/features/telegram/qr-code'
import { People } from '@/features/access/people'
import { WhatsAppGlyph } from './whatsapp-glyph'
import { PersonIcon, PhoneIcon } from '@/ui/icons'

type Props = { agent: Agent; open: boolean; onOpenChange: (open: boolean) => void }

const ease = [0.16, 1, 0.3, 1] as const

/** Link, check on, or turn off texting an agent on WhatsApp. */
export function WhatsAppSheet({ agent, open, onOpenChange }: Props) {
  const status = useWhatsApp(agent.id, { enabled: open })
  const link = useLinks((s) => s.byAgent[agent.id])

  // Nobody can scan a code nobody's looking at: closing the sheet stops it
  // (Hermes stops its bridge). A link being saved finishes regardless; a
  // finished or failed one is tidied away once the sheet is gone.
  const phase = link?.phase
  const shown = useRef<LinkPhase | undefined>(undefined)
  if (open) shown.current = phase
  useEffect(() => {
    if (open || !phase || phase === 'saving') return
    if (linkActive(phase)) return cancelLink(agent.id)
    if (shown.current !== phase) return
    const t = setTimeout(() => cancelLink(agent.id), 400)
    return () => clearTimeout(t)
  }, [open, phase, agent.id])

  const view: View = link
    ? link.phase === 'done' || link.phase === 'saving'
      ? 'finish'
      : link.phase === 'failed'
        ? 'error'
        : 'linking'
    : status.data && status.data.state !== 'off'
      ? 'connected'
      : status.isPending
        ? 'loading'
        : 'intro'

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`${agent.name} on WhatsApp`} hideTitle width={420}>
      <Grow className="hue-scope" style={{ '--hue': agent.hue } as CSSProperties}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.16 } }}
            transition={{ duration: 0.32, ease }}
          >
            {view === 'loading' && <Loading agent={agent} />}
            {view === 'intro' && <Intro agent={agent} />}
            {view === 'linking' && link && <Linking agent={agent} link={link} />}
            {view === 'finish' && link && <Finish agent={agent} link={link} onClose={() => onOpenChange(false)} />}
            {view === 'error' && link && <Failed agent={agent} link={link} />}
            {view === 'connected' && status.data && <Connected agent={agent} status={status.data} />}
          </motion.div>
        </AnimatePresence>
      </Grow>
    </Sheet>
  )
}

type View = 'loading' | 'intro' | 'linking' | 'finish' | 'error' | 'connected'

// ── Pieces ──────────────────────────────────────────────────────────────────

function Hero({ agent, state = 'idle', size = 84 }: { agent: Agent; state?: BuddyState; size?: number }) {
  return (
    <div className="relative mx-auto w-fit">
      <Buddy hue={agent.hue} size={size} seed={agent.id} state={state} />
      <motion.span
        className="absolute -right-1.5 -bottom-1"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', duration: 0.45, bounce: 0.3, delay: 0.12 }}
      >
        <WhatsAppGlyph size={Math.round(size * 0.38)} ring />
      </motion.span>
    </div>
  )
}

function Heading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mt-5 text-center">
      <h2 className="text-title font-semibold tracking-[-0.02em] text-balance">{title}</h2>
      {children && <p className="mx-auto mt-1.5 max-w-80 text-subhead text-balance text-ink-2">{children}</p>}
    </div>
  )
}

function Loading({ agent }: { agent: Agent }) {
  return (
    <div className="pt-4 pb-10" aria-busy aria-label="Loading">
      <div className="mx-auto w-fit">
        <Buddy hue={agent.hue} size={84} seed={agent.id} />
      </div>
      <div className="mt-6 flex flex-col items-center gap-2.5">
        <Skeleton className="h-4 w-52 rounded-full" />
        <Skeleton className="h-3 w-64 rounded-full" />
      </div>
    </div>
  )
}

/** Your own number opens your "Message yourself" chat; the agent's opens a chat with it. */
function OpenChat({ phone, className }: { phone: string; className?: string }) {
  return (
    <a
      href={chatLink(phone)}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'pressable flex h-13 w-full items-center justify-center gap-2 rounded-full bg-[#25c152] text-body font-medium text-white hover:brightness-105',
        className,
      )}
    >
      Open WhatsApp
    </a>
  )
}

// ── Not set up ──────────────────────────────────────────────────────────────

const MODES: { mode: WhatsAppMode; icon: ReactNode; title: string; body: (name: string) => string }[] = [
  {
    mode: 'self-chat',
    icon: <PersonIcon size={21} />,
    title: 'Your WhatsApp',
    body: (name) => `Talk to ${name} in Message yourself. Only you can.`,
  },
  {
    mode: 'bot',
    icon: <PhoneIcon size={21} />,
    title: 'A spare number',
    body: (name) => `${name} gets its own number. You approve who can text it.`,
  },
]

function Intro({ agent }: { agent: Agent }) {
  const [mode, setMode] = useState<WhatsAppMode>('self-chat')
  const [busy, setBusy] = useState(false)
  return (
    <div className="pt-4">
      <Hero agent={agent} />
      <Heading title={`Text ${agent.name} on WhatsApp`}>Right where you already chat, with the same memory.</Heading>
      <div
        role="radiogroup"
        aria-label="Which WhatsApp"
        className="list-group mt-7 overflow-hidden rounded-xl bg-fill-1"
      >
        {MODES.map((m, i) => {
          const on = mode === m.mode
          return (
            <motion.button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={on}
              data-has-icon=""
              onClick={() => setMode(m.mode)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, ease, delay: 0.08 + i * 0.05 }}
              className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors select-none hover:bg-fill-1 active:bg-fill-2"
            >
              <span
                className={cn(
                  'flex size-9 flex-none items-center justify-center rounded-full transition-colors duration-200',
                  on ? 'bg-accent text-accent-ink' : 'bg-accent-soft text-accent',
                )}
              >
                {m.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-subhead font-medium text-ink">{m.title}</span>
                <span className="block text-footnote text-pretty text-ink-2">{m.body(agent.name)}</span>
              </span>
              <span
                aria-hidden
                className={cn(
                  'flex size-5.5 flex-none items-center justify-center rounded-full transition-[background-color,box-shadow] duration-200',
                  on ? 'bg-accent text-accent-ink' : 'shadow-[inset_0_0_0_1.5px_var(--line-strong)]',
                )}
              >
                <motion.span
                  initial={false}
                  animate={{ scale: on ? 1 : 0.4, opacity: on ? 1 : 0 }}
                  transition={{ type: 'spring', duration: 0.3, bounce: 0.3 }}
                  className="flex"
                >
                  <Check size={13} strokeWidth={3} />
                </motion.span>
              </span>
            </motion.button>
          )
        })}
      </div>
      <div className="mt-7">
        <Button
          variant="accent"
          size="lg"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            await startLink(agent.id, mode)
            setBusy(false)
          }}
        >
          Show QR code
        </Button>
        <p className="mx-auto mt-3 max-w-80 text-center text-footnote text-balance text-ink-3">
          WhatsApp doesn’t officially support assistants like this, so a spare number is the safest bet.
        </p>
      </div>
    </div>
  )
}

// ── Showing the code ────────────────────────────────────────────────────────

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Linking({ agent, link }: { agent: Agent; link: Link }) {
  const wide = useIsWide()
  const touch = useMedia('(pointer: coarse)')
  const phone = touch && !wide
  const size = phone ? 224 : 256
  const now = useNow(link.phase === 'waiting')
  const left = (link.expiresAt ?? Infinity) - now
  const expired = link.phase === 'expired' || left <= 0
  const ready = link.phase === 'waiting' && link.qr
  // The first link downloads WhatsApp's bridge, which takes a minute: say so only once it's slow.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (ready || expired) return setSlow(false)
    const t = setTimeout(() => setSlow(true), 6_000)
    return () => clearTimeout(t)
  }, [ready, expired])

  const ui = (label: string) => <span className="font-medium text-ink">{label}</span>
  const steps: [string, ReactNode][] = [
    ['open', <>In WhatsApp, open {ui('Settings')}.</>],
    [
      'link',
      <>
        Tap {ui('Linked devices')}, then {ui('Link a device')}.
      </>,
    ],
    ['scan', 'Point the camera at this code.'],
  ]

  return (
    <div className="pt-2">
      <div className="text-center">
        <h2 className="text-title font-semibold tracking-[-0.02em] text-balance">
          {expired ? 'That code expired' : 'Scan with WhatsApp'}
        </h2>
        <p className="mx-auto mt-1 max-w-80 text-subhead text-balance text-ink-2">
          {expired
            ? 'For your safety, codes only last a while.'
            : link.mode === 'bot'
              ? `Use the phone with ${agent.name}’s number.`
              : `It links ${agent.name} to your WhatsApp.`}
        </p>
      </div>

      <div className="relative mx-auto mt-6 w-fit rounded-[26px] p-2 shadow-[0_0_0_0.5px_var(--line-strong),0_12px_32px_-12px_hsl(var(--shadow-color)/0.25)]">
        <AnimatePresence mode="popLayout" initial={false}>
          {ready ? (
            <QrCode
              key="qr"
              value={link.qr!}
              size={size}
              hue={agent.hue}
              className={cn('transition-[filter,opacity] duration-300', expired && 'opacity-30 blur-[3px]')}
              center={
                <span className="flex items-center justify-center rounded-full bg-white p-[3px]">
                  <Buddy hue={agent.hue} size={phone ? 30 : 34} seed={agent.id} />
                </span>
              }
            />
          ) : (
            <motion.div
              key="getting-ready"
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              className="relative flex flex-col items-center justify-center overflow-hidden rounded-[18px] bg-fill-1"
              style={{ width: size, height: size }}
            >
              {/* The ghost of a code, fading out from the middle, where the buddy works on the real one. */}
              <span aria-hidden className="absolute inset-0" style={ghost} />
              <Buddy hue={agent.hue} size={52} seed={agent.id} state={expired ? 'idle' : 'working'} />
              {!expired && (
                <span className="relative mt-3 text-footnote text-ink-2" aria-live="polite">
                  <span className="text-shimmer">Getting a code</span>
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {expired && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Button variant="primary" size="sm" onClick={() => startLink(agent.id, link.mode)}>
              <RotateCw size={15} strokeWidth={2.25} aria-hidden />
              New code
            </Button>
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {slow && !ready && !expired && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
            className="overflow-hidden text-center text-footnote text-ink-3"
          >
            <span className="block pt-3">The first time takes a minute.</span>
          </motion.p>
        )}
      </AnimatePresence>

      {!expired && (
        <ol className="mx-auto mt-6 max-w-80 space-y-2.5">
          {steps.map(([key, step], i) => (
            <li key={key} className="flex items-baseline gap-3 text-subhead text-ink-2">
              <span className="flex size-5.5 flex-none translate-y-[-1px] items-center justify-center rounded-full bg-fill-2 text-caption font-semibold text-ink tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 text-pretty">{step}</span>
            </li>
          ))}
        </ol>
      )}

      {/* A phone can't scan its own screen: your own WhatsApp needs another one showing the code. */}
      {phone && link.mode === 'self-chat' && !expired && (
        <p className="mx-auto mt-4 max-w-80 rounded-xl bg-fill-1 px-3.5 py-2.5 text-center text-footnote text-balance text-ink-2">
          On this phone? Open Murmur on a computer and scan from there.
        </p>
      )}

      {!expired && ready && <Live expiresIn={left} />}

      <div className={cn('flex justify-center text-footnote', ready ? 'mt-0.5' : 'mt-5')}>
        <button
          type="button"
          onClick={() => cancelLink(agent.id)}
          className="pressable h-11 rounded-full px-3 text-ink-2 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

const ghost: CSSProperties = {
  backgroundImage: 'radial-gradient(var(--line-strong) 1.4px, transparent 1.8px)',
  backgroundSize: '9px 9px',
  maskImage: 'radial-gradient(circle at 50% 50%, transparent 28%, #000 75%)',
  WebkitMaskImage: 'radial-gradient(circle at 50% 50%, transparent 28%, #000 75%)',
}

/** "Waiting for WhatsApp", breathing so you know it's listening; the time left in the last minute. */
function Live({ expiresIn }: { expiresIn: number }) {
  const low = expiresIn < 60_000
  return (
    <div className="mt-5 flex items-center justify-center gap-2.5 text-footnote" aria-live="polite">
      <span className="relative flex size-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#25c152] opacity-60 [animation-duration:1.6s]" />
        <span className="relative size-2 rounded-full bg-[#25c152]" />
      </span>
      <span className="text-shimmer font-medium">Waiting for WhatsApp</span>
      {low && (
        <span className="text-warning tabular-nums" aria-label="Code expires in">
          {clock(expiresIn)}
        </span>
      )}
    </div>
  )
}

// ── Linked ──────────────────────────────────────────────────────────────────

/**
 * Saving, then done, as one moment: the working buddy stays where it is,
 * then smiles and bounces as two soft rings ripple out (the agent's colour,
 * then WhatsApp's green) and the way to say hi rises in.
 */
function Finish({ agent, link, onClose }: { agent: Agent; link: Link; onClose: () => void }) {
  const reduce = useReducedMotion()
  const done = link.phase === 'done'
  useEffect(() => {
    if (done) navigator.vibrate?.(12)
  }, [done])
  const rise = (delay: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0.15, delay } : { duration: 0.42, ease, delay },
  })
  const number = phoneLabel(link.account?.phone)
  return (
    <div className="flex flex-col items-center pt-8 pb-2 text-center">
      <div className="relative">
        {done &&
          !reduce &&
          [0, 0.14].map((delay, i) => (
            <motion.span
              key={i}
              className={cn('absolute inset-0 rounded-full border-2', i ? 'border-[#25c152]/60' : 'border-accent/70')}
              initial={{ scale: 0.9, opacity: 0.9 }}
              animate={{ scale: 2.1, opacity: 0 }}
              transition={{ duration: 1.1, ease, delay: 0.05 + delay }}
            />
          ))}
        <Hero agent={agent} state={done ? 'done' : 'working'} size={96} />
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        {done ? (
          <motion.div key="done" className="w-full" {...rise(0.12)}>
            <Heading title={`${agent.name} is on WhatsApp`}>
              {link.mode === 'bot' ? (
                number ? (
                  <>
                    Text <span className="font-medium text-ink">{number}</span> to talk to it. You’ll approve new people
                    here.
                  </>
                ) : (
                  'Text its number to talk to it. You’ll approve new people here.'
                )
              ) : (
                'Say hi in your Message yourself chat.'
              )}
            </Heading>
          </motion.div>
        ) : (
          <motion.div key="saving" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            <Heading title={<span className="text-shimmer">Linking {agent.name}</span>}>
              {link.account?.name ? `Linked to ${link.account.name}. Just a moment.` : 'This takes a few seconds.'}
            </Heading>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Held in place (unseen) while saving, so nothing shifts when it's done. */}
      <motion.div
        className={cn('mt-8 w-full space-y-2', !done && 'invisible')}
        aria-hidden={!done}
        initial={false}
        animate={done ? rise(0.2).animate : rise(0).initial}
        transition={rise(0.2).transition}
      >
        {(link.account?.phone || !done) && <OpenChat phone={link.account?.phone ?? ''} />}
        <Button variant="secondary" size="lg" onClick={onClose}>
          Done
        </Button>
      </motion.div>
    </div>
  )
}

function Failed({ agent, link }: { agent: Agent; link: Link }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-col items-center pt-6 text-center">
      <div className="mx-auto w-fit">
        <Buddy hue={agent.hue} size={84} seed={agent.id} state="error" />
      </div>
      <Heading title="WhatsApp didn’t link">{link.message ?? 'Something went wrong.'}</Heading>
      <div className="mt-8 w-full space-y-2">
        <Button
          variant="accent"
          size="lg"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            await startLink(agent.id, link.mode)
            setBusy(false)
          }}
        >
          Try again
        </Button>
        <Button variant="ghost" size="lg" onClick={() => cancelLink(agent.id)}>
          Back
        </Button>
      </div>
    </div>
  )
}

// ── Already set up ──────────────────────────────────────────────────────────

function Connected({ agent, status }: { agent: Agent; status: WhatsAppStatus }) {
  const qc = useQueryClient()
  const disconnect = async () => {
    try {
      await disconnectWhatsApp(agent.id)
      qc.setQueryData(whatsappKey(agent.id), { state: 'off' } satisfies WhatsAppStatus)
      void qc.invalidateQueries({ queryKey: whatsappKey(agent.id) })
      toast(`${agent.name} is off WhatsApp`)
    } catch (e) {
      toast.error('Couldn’t disconnect WhatsApp. Try again.')
      throw e
    }
  }

  const who = accountLabel(status.account)
  const pill =
    status.state === 'connected'
      ? { dot: 'bg-success', text: who ? `Connected · ${who}` : 'Connected' }
      : status.state === 'starting'
        ? { dot: 'bg-warning animate-pulse', text: 'Connecting…' }
        : { dot: 'bg-danger', text: status.problem ?? 'Not connected' }

  return (
    <div className="flex flex-col items-center pt-4 text-center">
      <Hero agent={agent} state={status.state === 'problem' ? 'offline' : 'idle'} />
      <p className="mt-5 text-title font-semibold tracking-[-0.02em]">{agent.name} on WhatsApp</p>
      <motion.div
        key={pill.text}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease }}
        className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full bg-fill-1 px-3.5 py-1.5 text-footnote text-ink-2"
      >
        <span className={cn('size-2 flex-none rounded-full', pill.dot)} />
        <span className="truncate">{pill.text}</span>
      </motion.div>

      <div className="mt-8 w-full">
        {status.account?.phone && <OpenChat phone={status.account.phone} />}
        <p className="mt-3 px-4 text-footnote text-balance text-ink-3 first:mt-0">
          {status.mode === 'bot'
            ? `${agent.name} answers its own number. Your WhatsApp chats show up here too.`
            : `${agent.name} answers in your Message yourself chat. Only you can reach it there.`}
        </p>
      </div>

      {status.mode !== 'self-chat' && <People agent={agent} platform="whatsapp" className="mt-8" />}

      <ConfirmCard
        className="mt-8 w-full"
        label="Disconnect WhatsApp"
        title="Disconnect WhatsApp?"
        body={`${agent.name} will stop answering there. To unlink it fully, remove it under Linked devices in WhatsApp.`}
        confirm="Disconnect"
        onConfirm={disconnect}
      />
    </div>
  )
}

const accountLabel = (account?: WhatsAppAccount) => phoneLabel(account?.phone) ?? account?.name
