import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, ChevronDown, Keyboard, Mic, MicOff, Phone, X } from 'lucide-react'
import { Buddy, type BuddyState } from '@/ui/buddy'
import { cn } from '@/lib/cn'
import { MediaBlock } from '@/features/media/blocks'
import { MediaProvider, useMediaContext, type MediaContext } from '@/features/media/context'
import { baseName, fileUrl } from '@/features/media/files'
import { FindCard } from '@/features/umbrel/cards'
import { count } from '@/features/umbrel/finds'
import { ApprovalCard } from '@/features/chat/approval-card'
import { answerApproval, useChats } from '@/state/chats'
import { MachineScreen } from '@/features/machine/machine-screen'
import { useScreen } from '@/state/screen'
import { HandCard, Peek } from '@/features/screen'
import { reelShift } from './spoken'
import { groups, hasPhotos, stepsTitle } from './stage-groups'
import { FindPhotos, StagePhotos, type StagePhoto } from './stage-photos'
import { endCall, finishTurn, setMinimized, setMuted, useTalk, voicePosition, type Phase, type StageItem, type Step } from './talk'
import { voiceChip, type VoiceChoice } from './voice-setup'
import './talk.css'

const PreviewFrame = lazy(() => import('@/features/media/preview-frame').then((m) => ({ default: m.PreviewFrame })))

type Props = {
  name: string
  hue: number
  seed: string
  media: MediaContext
  /** Heard and spoken on the agent's own machine: the call says so. */
  local?: boolean
  /** The voice chosen for the agent, which a call on Hermes's own voices can't tell by itself. */
  voice?: VoiceChoice
  /** Keyboard: the call folds into the chat's call button and the composer takes over. */
  onType: () => void
  onSetup: () => void
}

/** The call, over everything, while you talk. Minimised, it folds into the chat's call button. */
export function TalkCall(props: Props) {
  const open = useTalk((s) => s.open)
  const minimized = useTalk((s) => s.minimized)
  const style = { '--hue': props.hue } as CSSProperties
  return (
    <MediaProvider value={props.media}>
      {createPortal(<AnimatePresence>{open && !minimized && <Surface key="call" {...props} style={style} />}</AnimatePresence>, document.body)}
    </MediaProvider>
  )
}

const buddyFor = (phase: Phase, working: boolean): BuddyState =>
  phase === 'listening' || phase === 'hearing'
    ? 'listening'
    : phase === 'speaking'
      ? 'speaking'
      : phase === 'waiting'
        ? 'waiting'
        : phase === 'connecting'
          ? 'idle'
          : working
            ? 'working'
            : 'thinking'

/** What the call is doing, in a word or two, for the island and for screen readers. */
const labelFor = (phase: Phase, activity?: string, switching?: string) =>
  switching
    ? `Switching to ${switching}`
    : phase === 'connecting'
      ? 'Connecting'
      : phase === 'listening' || phase === 'hearing'
        ? 'Listening'
        : phase === 'transcribing'
          ? 'Thinking'
          : phase === 'speaking'
            ? 'Speaking'
            : (activity ?? 'Thinking')

function Surface({ name, hue, seed, local, voice, onType, onSetup, style }: Props & { style: CSSProperties }) {
  const phase = useTalk((s) => s.phase)
  const activity = useTalk((s) => s.activity)
  const switching = useTalk((s) => s.switching)
  const stage = useStage()
  const error = useTalk((s) => s.error)
  const origin = useTalk((s) => s.origin)
  const engine = useTalk((s) => s.engine)
  const onItsOwn = useTalk((s) => s.local)
  const reduce = useReducedMotion()
  const onStage = stage.length > 0
  const buddy = buddyFor(phase, !!activity)

  // It grows out of the call button and folds back into it.
  const [from] = useState(() => origin ?? { x: innerWidth / 2, y: innerHeight - 60 })
  const reach = Math.ceil(Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y)))
  const closed = `circle(18px at ${from.x}px ${from.y}px)`
  const open = `circle(${reach}px at ${from.x}px ${from.y}px)`

  // Esc minimises; the call keeps going. (A photo, or the agent's browser, open full screen closes first.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[data-lightbox], [data-screen-viewer]')) return
      e.preventDefault()
      e.stopPropagation()
      setMinimized(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <motion.div
      role="dialog"
      aria-modal
      aria-label={`Call with ${name}`}
      className="talk hue-scope"
      style={style}
      initial={reduce ? { opacity: 0 } : { clipPath: closed }}
      animate={reduce ? { opacity: 1 } : { clipPath: open }}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.15 } }
          : { clipPath: closed, opacity: [1, 1, 0], transition: { duration: 0.44, ease: [0.5, 0, 0.2, 1], opacity: { times: [0, 0.82, 1], duration: 0.44 } } }
      }
      transition={reduce ? { duration: 0.15 } : { duration: 0.6, ease: [0.4, 0, 0.1, 1] }}
    >
      <Light stage={onStage} />
      <motion.div
        className="talk-inner"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
        transition={{ duration: 0.28, delay: reduce ? 0 : 0.16 }}
      >
        <header className="talk-top">
          <button type="button" className="talk-icon pressable" aria-label="Back to the chat" onClick={() => setMinimized(true)}>
            <ChevronDown size={22} strokeWidth={2} />
          </button>
          <div className="min-w-0 text-center leading-tight">
            <div className="truncate text-[17px] font-semibold tracking-[-0.02em]">{name}</div>
            <Clock className="block text-footnote text-ink-3 tabular-nums" />
          </div>
          <div className="flex justify-end">
            {/* How it's listening and speaking: tap to change the voice. */}
            <button
              type="button"
              className="talk-chip pressable"
              onClick={onSetup}
              title="Change the voice"
            >
              {voiceChip(engine, voice, !!local || onItsOwn)}
            </button>
          </div>
        </header>

        {onStage ? (
          <div className="talk-stage">
            <div className="talk-island" role="status">
              <motion.div layoutId="talk-buddy" className="flex-none" transition={{ type: 'spring', duration: 0.55, bounce: 0.12 }}>
                <Buddy hue={hue} size={40} seed={seed} state={buddy} />
              </motion.div>
              <Label phase={phase} activity={activity} switching={switching} />
              <Bars phase={phase} />
            </div>
            <Stage items={stage} name={name} hue={hue} seed={seed} />
            <div className="talk-caption">
              <Caption compact />
            </div>
          </div>
        ) : (
          <div className="talk-full">
            <div className="talk-face">
              <motion.div
                layoutId="talk-buddy"
                initial={reduce ? false : { scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', duration: 0.6, bounce: 0.18, delay: reduce ? 0 : 0.12 }}
              >
                <Buddy hue={hue} size={148} seed={seed} state={buddy} label={labelFor(phase, activity, switching)} />
              </motion.div>
            </div>
            <div className="talk-activity" aria-live="polite">
              <AnimatePresence mode="wait">
                {phase === 'waiting' ? (
                  // It's asking you something on screen (an OK, a question): show the chat.
                  <motion.button
                    key="waiting"
                    type="button"
                    className="talk-needs pressable"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    onClick={() => setMinimized(true)}
                  >
                    {name} needs you · Show
                  </motion.button>
                ) : switching || phase === 'connecting' ? (
                  // Until it can really hear you, it says so.
                  <motion.span
                    key={switching ?? 'connecting'}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="text-shimmer"
                  >
                    {switching ? `Switching to ${switching}` : 'Connecting…'}
                  </motion.span>
                ) : (
                  (phase === 'thinking' || phase === 'transcribing') && (
                    <motion.span
                      key={activity ?? 'thinking'}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                      className="text-shimmer"
                    >
                      {activity ?? 'Thinking'}
                    </motion.span>
                  )
                )}
              </AnimatePresence>
            </div>
            <Caption />
          </div>
        )}

        <AnimatePresence>
          {error && (
            <motion.div
              key={error}
              className="talk-error"
              role="status"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <span>{error}</span>
              {/set up|isn’t set up/i.test(error) && (
                <button type="button" className="talk-error-action pressable" onClick={onSetup}>
                  Set up voice
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <Controls onType={onType} />
      </motion.div>
    </motion.div>
  )
}

/** The agent's light: it swells a little with your voice while it listens. */
function Light({ stage }: { stage: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(
    () =>
      useTalk.subscribe((s) => {
        const listening = s.phase === 'listening' || s.phase === 'hearing'
        ref.current?.style.setProperty('--swell', String(listening ? 1 + s.level * 0.16 : 1))
      }),
    [],
  )
  return <div ref={ref} aria-hidden className="talk-light" data-stage={stage || undefined} />
}

function Label({ phase, activity, switching }: { phase: Phase; activity?: string; switching?: string }) {
  const label = labelFor(phase, activity, switching)
  const busy = !!switching || phase === 'thinking' || phase === 'transcribing'
  return (
    <div className="min-w-0 flex-1 text-subhead font-medium">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.18 }}
          className={busy ? 'truncate text-shimmer' : phase === 'waiting' ? 'truncate text-warning' : 'truncate text-ink-2'}
        >
          {label}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** Five bars in the agent's colour: your voice while it listens, its own while it speaks. */
export function Bars({ phase }: { phase: Phase }) {
  const box = useRef<HTMLSpanElement>(null)
  const listening = phase === 'listening' || phase === 'hearing'
  useEffect(() => {
    if (!listening) return
    const shape = [0.55, 0.85, 1, 0.75, 0.5]
    return useTalk.subscribe((s) => {
      const bars = box.current?.children
      if (!bars) return
      for (let i = 0; i < bars.length; i++)
        (bars[i] as HTMLElement).style.transform = `scaleY(${(0.18 + s.level * shape[i]).toFixed(3)})`
    })
  }, [listening])
  return (
    <span ref={box} className="talk-bars" data-state={listening ? 'listening' : phase === 'speaking' ? 'speaking' : 'thinking'} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} style={listening ? undefined : { transform: '' }} />
      ))}
    </span>
  )
}

/**
 * What's being said: the agent's words up top, lighting up as it says them;
 * yours below, near the microphone, appearing as you say them and staying
 * while it answers. Each has its own box above the controls, which long words
 * move through. On the stage there's room for one of them, the latest.
 */
function Caption({ compact }: { compact?: boolean }) {
  const phase = useTalk((s) => s.phase)
  const engine = useTalk((s) => s.engine)
  const hearing = useTalk((s) => s.hearing)
  const you = useTalk((s) => s.you)
  const spoken = useTalk((s) => s.spoken)
  const words = phase === 'hearing' ? hearing : you
  // Heard by Hermes's own voice: your words only come once you've finished, so
  // dots stand in for them while you talk and for the beat it takes to write them down.
  const listening = phase === 'hearing' && engine === 'chained'
  const writing = (phase === 'transcribing' || listening) && !words
  const it = spoken && (
    <motion.p
      key={`it-${spoken.id}`}
      className="talk-line it"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', duration: 0.45, bounce: 0 }}
    >
      <Lit text={spoken.text} duration={spoken.duration} id={spoken.id} />
    </motion.p>
  )
  const yours = (words || writing) && (
    <motion.p
      key="you"
      className="talk-line you"
      data-live={phase === 'hearing' || undefined}
      data-quiet={!!spoken || undefined}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16, transition: { duration: 0.28 } }}
      transition={{ type: 'spring', duration: 0.45, bounce: 0 }}
    >
      {writing ? (
        <span className="talk-dots" aria-label={listening ? 'Listening' : 'Writing down what you said'} />
      ) : (
        <Words text={words!} />
      )}
    </motion.p>
  )
  const yoursOnly = compact && (phase === 'hearing' || !spoken)
  // It may not notice you've finished, in a loud room say: a tap says so.
  const taps = engine === 'chained' && (phase === 'hearing' || phase === 'listening')
  return (
    <div className={cn('talk-lines', compact && 'compact')} onClick={taps ? finishTurn : undefined}>
      <div className="talk-reel">
        <AnimatePresence mode="popLayout" initial={false}>
          {!yoursOnly && it}
        </AnimatePresence>
      </div>
      <div className="talk-yours" data-quiet={!!spoken || undefined}>
        <AnimatePresence initial={false}>{(!compact || yoursOnly) && yours}</AnimatePresence>
      </div>
    </div>
  )
}

/** Your words, each fading in as it's heard (the ones already there stay put). */
function Words({ text }: { text: string }) {
  const words = text.split(/\s+/).filter(Boolean)
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="talk-heard">
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

/** Moves a long sentence up its box as it's said. */
function keepInView(said: HTMLElement, word: Element | undefined) {
  const reel = said.closest('.talk-reel')
  if (!reel || !(word instanceof HTMLElement)) return
  const { paddingTop, paddingBottom } = getComputedStyle(reel)
  const room = reel.clientHeight - parseFloat(paddingTop) - parseFloat(paddingBottom)
  const line = parseFloat(getComputedStyle(said).lineHeight)
  said.style.transform = `translateY(${-reelShift(word.offsetTop, room, said.offsetHeight, line)}px)`
}

/**
 * A sentence that lights up word by word in time with the voice. Each word's
 * moment is estimated from its length (and the pauses punctuation makes) across
 * the clip's real duration, then read off the audio's own clock every frame.
 */
function Lit({ text, duration, id }: { text: string; duration: number; id: number }) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text])
  const starts = useMemo(() => {
    const weight = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2 + (/[,;:]$/.test(w) ? 4 : /[.!?…]$/.test(w) ? 7 : 0)
    const total = words.reduce((s, w) => s + weight(w), 0)
    let acc = 0
    return words.map((w) => {
      const at = (acc / total) * duration * 0.96
      acc += weight(w)
      return at
    })
  }, [words, duration])
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    let raf = 0
    let lit = -1
    const tick = () => {
      const pos = voicePosition()
      let n = 0
      while (n < starts.length && starts[n] <= pos + 0.04) n++
      if (n !== lit) {
        lit = n
        const said = ref.current
        if (said) {
          const spans = said.children
          for (let i = 0; i < spans.length; i++) spans[i].classList.toggle('lit', i < n)
          keepInView(said, spans[n - 1])
        }
      }
      if (n < starts.length) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [starts, id])
  return (
    <span ref={ref} className="talk-said">
      {words.map((w, i) => (
        <span key={i} className="talk-word">
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  )
}

/** The pictures a reply delivered. */
function MediaPhotos({ items }: { items: StageItem[] }) {
  const { sessionId, profile } = useMediaContext()
  const photos = useMemo(
    () =>
      items.flatMap((it): StagePhoto[] =>
        it.kind === 'media' ? [{ id: it.path, src: fileUrl({ path: it.path, sessionId, profile }), name: baseName(it.path) }] : [],
      ),
    [items, sessionId, profile],
  )
  return <StagePhotos photos={photos} total={photos.length} title={photos.length > 1 ? count(photos.length, 'photo') : photos[0].name} />
}

/** What's on the stage to see now: its browser only while it's on a screen, unless it's asking you there. */
function useStage() {
  const stage = useTalk((s) => s.stage)
  const running = !!useScreen(useTalk((s) => s.profile))?.running
  return useMemo(() => (running ? stage : stage.filter((i) => i.kind !== 'browser' || i.ask)), [stage, running])
}

/** Something it asks of you: an OK, or a hand in its browser. */
const asks = (it: StageItem | undefined) =>
  (it?.kind === 'approval' && it.item.status === 'pending') || (it?.kind === 'browser' && !!it.ask)

/** The newest thing the reply brought, big; the rest as chips to bring back. */
function Stage({ items, name, hue, seed }: { items: StageItem[]; name: string; hue: number; seed: string }) {
  const all = useMemo(() => groups(items), [items])
  const chatId = useTalk((s) => s.chatId)
  const profile = useTalk((s) => s.profile)
  const [picked, setPicked] = useState<string>()
  const working = useChats((s) => !!chatId && s.chats[chatId]?.status === 'working')
  // What it's asking you comes first, until you've answered.
  const asking = all.findLast((g) => asks(g.items[0]))
  const front = asking ?? all.find((g) => g.key === picked) ?? all.at(-1)!
  useEffect(() => setPicked(undefined), [all.length])
  return (
    <div className="talk-stage-body">
      {all.length > 1 && (
        <div className="talk-shelf">
          {all.map((g) => (
            <button
              key={g.key}
              type="button"
              className="talk-shelf-chip pressable"
              data-on={g.key === front.key || undefined}
              onClick={() => setPicked(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}
      <div className="talk-card-slot">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={front.key}
            className={cn(
              'talk-card',
              (front.gallery || hasPhotos(front.items[0])) && 'talk-pictures',
              (front.items[0]?.kind === 'find' || front.items[0]?.kind === 'steps') && 'talk-found',
              front.items[0]?.kind === 'approval' && 'talk-asks',
              front.items[0]?.kind === 'preview' && 'talk-widget',
              (front.items[0]?.kind === 'browser' || front.items[0]?.kind === 'machine') && 'talk-browser',
            )}
            initial={{ opacity: 0, y: 16, scale: 0.96, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -12, scale: 0.97, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', duration: 0.55, bounce: 0.1 }}
          >
            {front.gallery ? (
              <MediaPhotos items={front.items} />
            ) : (
              front.items.map((it) =>
                it.kind === 'media' ? (
                  <MediaBlock key={it.key} path={it.path} />
                ) : it.kind === 'find' ? (
                  hasPhotos(it) && it.find.kind === 'photos' ? <FindPhotos key={it.key} find={it.find} /> : <FindCard key={it.key} find={it.find} />
                ) : it.kind === 'steps' ? (
                  <StepsCard key={it.key} steps={it.steps} />
                ) : it.kind === 'approval' ? (
                  <ApprovalCard
                    key={it.key}
                    item={it.item}
                    hue={hue}
                    seed={seed}
                    onApprove={(requestId, choice) => chatId && answerApproval(chatId, requestId, choice)}
                  />
                ) : it.kind === 'machine' ? (
                  <MachineScreen key={it.key} screen={it.screen} live={working} />
                ) : it.kind === 'browser' ? (
                  profile &&
                  (it.ask ? (
                    <HandCard key={it.key} item={it.ask} agent={{ id: profile, name, hue }} site={it.site} hue={hue} seed={seed} />
                  ) : (
                    <Peek key={it.key} profile={profile} agent={{ id: profile, name, hue }} site={it.site} step={it.step} />
                  ))
                ) : (
                  <Suspense key={it.key} fallback={<div className="media-skeleton h-44 rounded-md" />}>
                    <PreviewFrame file={it.file} />
                  </Suspense>
                ),
              )
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

/** What it did through a connected app, each step ticking off as it's done. */
function StepsCard({ steps }: { steps: Step[] }) {
  const reduce = useReducedMotion()
  return (
    <section className="found talk-steps">
      <header className="found-head">
        <h3 className="min-w-0 flex-1 truncate text-subhead font-semibold tracking-[-0.015em] text-ink">{stepsTitle(steps)}</h3>
      </header>
      <ul>
        {steps.map((step, i) => (
          <motion.li
            key={step.id}
            className="talk-step"
            data-state={step.failed ? 'failed' : step.done ? 'done' : 'running'}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0, delay: Math.min(i, 4) * 0.03 }}
          >
            <span className="talk-step-mark" aria-hidden>
              <AnimatePresence initial={false}>
                {(step.done || step.failed) && (
                  <motion.span
                    key="mark"
                    initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', duration: 0.4, bounce: 0.35 }}
                  >
                    {step.failed ? <X size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-subhead font-medium tracking-[-0.01em]', step.done ? 'text-ink' : 'text-shimmer')}>
                {step.label}
              </span>
              {step.detail && <span className="block truncate text-footnote text-ink-3">{step.detail}</span>}
            </span>
          </motion.li>
        ))}
      </ul>
    </section>
  )
}

function Controls({ onType }: { onType: () => void }) {
  const muted = useTalk((s) => s.muted)
  return (
    <div className="talk-controls">
      <button
        type="button"
        className="talk-btn pressable"
        data-on={muted || undefined}
        aria-pressed={muted}
        aria-label={muted ? 'Unmute' : 'Mute'}
        title={muted ? 'Unmute' : 'Mute'}
        onClick={() => setMuted(!muted)}
      >
        {muted ? <MicOff size={24} strokeWidth={1.9} /> : <Mic size={24} strokeWidth={1.9} />}
      </button>
      <button type="button" className="talk-btn pressable" aria-label="Type instead" title="Type instead" onClick={onType}>
        <Keyboard size={24} strokeWidth={1.9} />
      </button>
      <button type="button" className="talk-btn end pressable" aria-label="End call" title="End call" onClick={endCall}>
        <Phone size={26} strokeWidth={2} fill="currentColor" className="rotate-[135deg]" />
      </button>
    </div>
  )
}

export function Clock({ className }: { className?: string }) {
  const startedAt = useTalk((s) => s.startedAt)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  return <span className={className}>{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
}
