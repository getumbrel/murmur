import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Lock, MessageCircle, RotateCw, Sparkles } from 'lucide-react'
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
  botLink,
  cancelPairing,
  clearPairing,
  disconnectTelegram,
  pairingActive,
  startPairing,
  telegramKey,
  usePairing,
  useTelegram,
  type Pairing,
  type PairingPhase,
  type TelegramStatus,
} from '@/state/telegram'
import { People } from '@/features/access/people'
import { QrCode } from './qr-code'
import { TelegramGlyph } from './telegram-glyph'

type Props = { agent: Agent; open: boolean; onOpenChange: (open: boolean) => void }

const spring = { type: 'spring', duration: 0.35, bounce: 0 } as const
const ease = [0.16, 1, 0.3, 1] as const

/** Set up, check on, or turn off texting an agent from Telegram. */
export function TelegramSheet({ agent, open, onOpenChange }: Props) {
  const status = useTelegram(agent.id, { enabled: open })
  const pairing = usePairing(agent.id)

  // Closing on a finished or failed pairing the person saw tidies it away
  // (on every device); a code still waiting keeps going on Murmur's server,
  // so they can come back. One that ended while the sheet was shut stays, so
  // the agent's page can say how it went.
  const phase = pairing?.phase
  const shown = useRef<PairingPhase | undefined>(undefined)
  if (open) shown.current = phase
  useEffect(() => {
    if (open || !phase || pairingActive(phase) || shown.current !== phase) return
    const t = setTimeout(() => {
      shown.current = undefined
      clearPairing(agent.id)
    }, 400)
    return () => clearTimeout(t)
  }, [open, phase, agent.id])

  const view: View = pairing
    ? pairing.phase === 'connected'
      ? 'done'
      : pairing.phase === 'failed'
        ? 'error'
        : pairing.phase === 'applying'
          ? 'saving'
          : 'pairing'
    : status.data && status.data.state !== 'off'
      ? 'connected'
      : status.isPending
        ? 'loading'
        : 'intro'

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`${agent.name} on Telegram`} hideTitle width={420}>
      <Grow className="hue-scope" style={{ '--hue': agent.hue } as CSSProperties}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            // Saving and done are one view, so the orb carries straight on into its smile.
            key={view === 'done' ? 'saving' : view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.16 } }}
            transition={{ duration: 0.32, ease }}
          >
            {view === 'loading' && <Loading agent={agent} />}
            {view === 'intro' && <Intro agent={agent} onStart={() => startPairing(agent.id, agent.name)} />}
            {view === 'pairing' && pairing && <Waiting agent={agent} pairing={pairing} />}
            {(view === 'saving' || view === 'done') && (
              <Finish
                agent={agent}
                done={view === 'done'}
                username={pairing?.username}
                onClose={() => onOpenChange(false)}
              />
            )}
            {view === 'error' && pairing && <Failed agent={agent} message={pairing.message} />}
            {view === 'connected' && status.data && <Connected agent={agent} status={status.data} />}
          </motion.div>
        </AnimatePresence>
      </Grow>
    </Sheet>
  )
}

type View = 'loading' | 'intro' | 'pairing' | 'saving' | 'done' | 'error' | 'connected'

// ── Pieces ──────────────────────────────────────────────────────────────────

function Hero({
  agent,
  state = 'idle',
  badge = true,
  size = 84,
}: {
  agent: Agent
  state?: BuddyState
  badge?: boolean
  size?: number
}) {
  return (
    <div className="relative mx-auto w-fit">
      <Buddy hue={agent.hue} size={size} seed={agent.id} state={state} />
      {badge && (
        <motion.span
          className="absolute -right-1.5 -bottom-1"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.45, bounce: 0.3, delay: 0.12 }}
        >
          <TelegramGlyph size={Math.round(size * 0.38)} ring />
        </motion.span>
      )}
    </div>
  )
}

/** While we check: the face, and the shape of what's coming. */
function Loading({ agent }: { agent: Agent }) {
  return (
    <div className="pt-4 pb-10" aria-busy aria-label="Loading">
      <Hero agent={agent} badge={false} />
      <div className="mt-6 flex flex-col items-center gap-2.5">
        <Skeleton className="h-4 w-52 rounded-full" />
        <Skeleton className="h-3 w-64 rounded-full" />
      </div>
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

// ── Not set up ──────────────────────────────────────────────────────────────

function Intro({ agent, onStart }: { agent: Agent; onStart: () => void }) {
  const points: [ReactNode, string, string][] = [
    [
      <Sparkles key="s" size={18} strokeWidth={1.85} />,
      'Its own Telegram bot',
      `Made for ${agent.name} in a few taps.`,
    ],
    [<Lock key="l" size={18} strokeWidth={1.85} />, 'Just for you', 'Only your Telegram account can message it.'],
    [
      <MessageCircle key="m" size={18} strokeWidth={1.85} />,
      `The same ${agent.name}`,
      'Same memory, and your chats show up here.',
    ],
  ]
  return (
    <div className="pt-4">
      <Hero agent={agent} />
      <Heading title={`Text ${agent.name} from Telegram`}>
        Message {agent.name} from anywhere, right where you already chat.
      </Heading>
      <ul className="mt-7 space-y-4 px-1">
        {points.map(([icon, title, body], i) => (
          <motion.li
            key={title}
            className="flex gap-3.5"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38, ease, delay: 0.08 + i * 0.05 }}
          >
            <span className="flex size-9 flex-none items-center justify-center rounded-full bg-accent-soft text-accent">
              {icon}
            </span>
            <span className="min-w-0 pt-px">
              <span className="block text-subhead font-medium text-ink">{title}</span>
              <span className="block text-footnote text-ink-2">{body}</span>
            </span>
          </motion.li>
        ))}
      </ul>
      <div className="mt-8">
        <StartButton onStart={onStart} label="Set up Telegram" />
        <p className="mt-3 text-center text-footnote text-ink-3">You’ll need Telegram on your phone.</p>
      </div>
    </div>
  )
}

function StartButton({ onStart, label }: { onStart: () => void; label: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="accent"
      size="lg"
      loading={busy}
      onClick={async () => {
        setBusy(true)
        await onStart()
        setBusy(false)
      }}
    >
      {label}
    </Button>
  )
}

// ── Waiting for Telegram ────────────────────────────────────────────────────

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

function Waiting({ agent, pairing }: { agent: Agent; pairing: Pairing }) {
  const wide = useIsWide()
  const touch = useMedia('(pointer: coarse)')
  // On a phone you can't scan your own screen: lead with the button.
  const phone = touch && !wide
  const [showCode, setShowCode] = useState(!phone)
  const now = useNow(pairing.phase === 'waiting')
  const left = (pairing.expiresAt ?? 0) - now
  const expired = pairing.phase === 'expired' || (pairing.phase === 'waiting' && left <= 0)
  const starting = pairing.phase === 'starting'

  // Buttons the person will look for are named in full ink, the rest stays quiet.
  const ui = (label: string) => <span className="font-medium text-ink">{label}</span>
  const steps: [string, ReactNode][] = phone
    ? [
        ['open', <>Tap {ui('Open Telegram')} below.</>],
        ['start', <>Tap {ui('Start')}, then follow the steps.</>],
        ['back', 'Come back here. That’s it.'],
      ]
    : [
        ['scan', 'Scan the code with your phone’s camera.'],
        ['start', <>In Telegram, tap {ui('Start')} and follow the steps.</>],
        ['back', `${agent.name} will appear here when it’s done.`],
      ]

  return (
    <div className="pt-2">
      <div className="text-center">
        <h2 className="text-title font-semibold tracking-[-0.02em] text-balance">
          {expired ? 'That code expired' : phone ? 'Finish in Telegram' : 'Scan to connect'}
        </h2>
        <p className="mx-auto mt-1 max-w-80 text-subhead text-balance text-ink-2">
          {expired ? 'For your safety, codes only last a while.' : `Telegram will make a bot just for ${agent.name}.`}
        </p>
      </div>

      <AnimatePresence initial={false}>
        {showCode && (
          <motion.div
            key="code"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            className="-mx-5 overflow-hidden px-5 pb-4"
          >
            <div className="relative mx-auto mt-6 w-fit rounded-[26px] p-2 shadow-[0_0_0_0.5px_var(--line-strong),0_12px_32px_-12px_hsl(var(--shadow-color)/0.25)]">
              {pairing.qr ? (
                <QrCode
                  value={pairing.qr}
                  size={phone ? 196 : 212}
                  hue={agent.hue}
                  className={cn('transition-[filter,opacity] duration-300', expired && 'opacity-30 blur-[3px]')}
                  center={
                    <span className="flex items-center justify-center rounded-full bg-white p-[3px]">
                      <Buddy hue={agent.hue} size={phone ? 30 : 34} seed={agent.id} />
                    </span>
                  }
                />
              ) : (
                <div
                  className="animate-pulse rounded-[18px] bg-fill-2"
                  style={{ width: phone ? 196 : 212, height: phone ? 196 : 212 }}
                />
              )}
              {expired && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Button variant="primary" size="sm" onClick={() => startPairing(agent.id, agent.name)}>
                    <RotateCw size={15} strokeWidth={2.25} aria-hidden />
                    New code
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!expired && (
        <ol className={cn('mx-auto max-w-80 space-y-2.5', showCode ? 'mt-2' : 'mt-6')}>
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

      <div className="mt-6 space-y-2">
        {expired ? (
          !showCode && <StartButton onStart={() => startPairing(agent.id, agent.name)} label="Get a new code" />
        ) : (
          <a
            href={pairing.link}
            target="_blank"
            rel="noreferrer"
            aria-disabled={starting || !pairing.link}
            className={cn(
              'pressable flex h-13 w-full items-center justify-center gap-2 rounded-full text-body font-medium',
              phone ? 'bg-[#229ed9] text-white' : 'bg-fill-2 text-ink hover:bg-fill-3',
              (starting || !pairing.link) && 'pointer-events-none opacity-40',
            )}
          >
            {phone && <TelegramGlyph size={20} className="!rounded-full bg-white/20 [&_circle]:fill-transparent" />}
            {phone ? 'Open Telegram' : 'Open Telegram on this computer'}
          </a>
        )}
      </div>

      {!expired && <Live expiresIn={starting ? undefined : left} />}

      <div className="mt-0.5 flex items-center justify-center gap-1 text-footnote">
        {phone && !expired && (
          <>
            <button
              type="button"
              onClick={() => setShowCode((v) => !v)}
              className="pressable h-11 rounded-full px-3 text-ink-2 hover:text-ink"
            >
              {showCode ? 'Hide code' : 'Use another phone'}
            </button>
            <span className="text-ink-3" aria-hidden>
              ·
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => cancelPairing(agent.id)}
          className="pressable h-11 rounded-full px-3 text-ink-2 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/** "Waiting for Telegram · 9:41", breathing so you know it's listening. */
function Live({ expiresIn }: { expiresIn?: number }) {
  const low = expiresIn !== undefined && expiresIn < 60_000
  return (
    <div className="mt-5 flex items-center justify-center gap-2.5 text-footnote" aria-live="polite">
      <span className="relative flex size-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60 [animation-duration:1.6s]" />
        <span className="relative size-2 rounded-full bg-accent" />
      </span>
      <span className="text-shimmer font-medium">Waiting for Telegram</span>
      {expiresIn !== undefined && (
        <span
          className={cn('tabular-nums transition-colors', low ? 'text-warning' : 'text-ink-3')}
          aria-label="Code expires in"
        >
          {clock(expiresIn)}
        </span>
      )}
    </div>
  )
}

// ── Finishing, failed ───────────────────────────────────────────────────────

/**
 * Saving, then done, as one moment: the working orb stays where it is, then
 * smiles and bounces as two soft rings ripple out and the way to say hi rises in.
 */
function Finish({
  agent,
  done,
  username,
  onClose,
}: {
  agent: Agent
  done: boolean
  username?: string
  onClose: () => void
}) {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (done) navigator.vibrate?.(12)
  }, [done])
  const rise = (delay: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0.15, delay } : { duration: 0.42, ease, delay },
  })
  return (
    <div className="flex flex-col items-center pt-8 pb-2 text-center">
      <div className="relative">
        {done &&
          !reduce &&
          [0, 0.14].map((delay, i) => (
            <motion.span
              key={i}
              className={cn('absolute inset-0 rounded-full border-2', i ? 'border-[#2aabee]/60' : 'border-accent/70')}
              initial={{ scale: 0.9, opacity: 0.9 }}
              animate={{ scale: 2.1, opacity: 0 }}
              transition={{ duration: 1.1, ease, delay: 0.05 + delay }}
            />
          ))}
        {/* The orb's own "done" bounce is the celebration. */}
        <Hero agent={agent} state={done ? 'done' : 'working'} size={96} />
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        {done ? (
          <motion.div key="done" className="w-full" {...rise(0.12)}>
            <Heading title={`${agent.name} is on Telegram`}>
              {username ? (
                <>
                  Find it at <span className="font-medium text-ink">@{username}</span>. Only you can message it.
                </>
              ) : (
                'Say hi. Only you can message it.'
              )}
            </Heading>
          </motion.div>
        ) : (
          <motion.div key="saving" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            <Heading title={<span className="text-shimmer">Connecting {agent.name} to Telegram</span>}>
              This takes a few seconds.
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
        {(username || !done) && <OpenBot username={username ?? ''} />}
        <Button variant="secondary" size="lg" onClick={onClose}>
          Done
        </Button>
      </motion.div>
    </div>
  )
}

function OpenBot({ username }: { username: string }) {
  return (
    <a
      href={botLink(username)}
      target="_blank"
      rel="noreferrer"
      className="pressable flex h-13 w-full items-center justify-center gap-2 rounded-full bg-accent text-body font-medium text-accent-ink hover:brightness-105"
    >
      Open in Telegram
    </a>
  )
}

function Failed({ agent, message }: { agent: Agent; message?: string }) {
  return (
    <div className="flex flex-col items-center pt-6 text-center">
      <Hero agent={agent} state="error" badge={false} />
      <Heading title="Telegram didn’t connect">{message ?? 'Something went wrong.'}</Heading>
      <div className="mt-8 w-full space-y-2">
        <StartButton onStart={() => startPairing(agent.id, agent.name)} label="Set up again" />
        <Button variant="ghost" size="lg" onClick={() => clearPairing(agent.id)}>
          Back
        </Button>
      </div>
    </div>
  )
}

// ── Already set up ──────────────────────────────────────────────────────────

function Connected({ agent, status }: { agent: Agent; status: TelegramStatus }) {
  const qc = useQueryClient()
  const disconnect = async () => {
    try {
      await disconnectTelegram(agent.id)
      qc.setQueryData(telegramKey(agent.id), { state: 'off' } satisfies TelegramStatus)
      void qc.invalidateQueries({ queryKey: telegramKey(agent.id) })
      toast(`${agent.name} is off Telegram`)
    } catch (e) {
      toast.error('Couldn’t disconnect Telegram. Try again.')
      throw e
    }
  }

  const pill =
    status.state === 'connected'
      ? { dot: 'bg-success', text: status.username ? `Connected as @${status.username}` : 'Connected' }
      : status.state === 'starting'
        ? { dot: 'bg-warning animate-pulse', text: 'Connecting…' }
        : { dot: 'bg-danger', text: status.problem ?? 'Not connected' }

  return (
    <div className="flex flex-col items-center pt-4 text-center">
      <Hero agent={agent} state={status.state === 'problem' ? 'offline' : 'idle'} />
      <p className="mt-5 text-title font-semibold tracking-[-0.02em]">{agent.name} on Telegram</p>
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
        {status.username && <OpenBot username={status.username} />}
        <p className="mt-3 px-4 text-footnote text-balance text-ink-3 first:mt-0">
          Only you can message {agent.name} there. Your Telegram chats show up here too.
        </p>
      </div>

      <People agent={agent} platform="telegram" className="mt-8" />

      <ConfirmCard
        className="mt-8 w-full"
        label="Disconnect Telegram"
        title="Disconnect Telegram?"
        body={`${agent.name} will stop answering there. You can set it up again any time.`}
        confirm="Disconnect"
        onConfirm={disconnect}
      />
    </div>
  )
}
