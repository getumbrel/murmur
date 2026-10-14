import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from 'motion/react'
import { ArrowUp, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet } from '@/ui/sheet'
import { Button } from '@/ui/button'
import { Buddy } from '@/ui/buddy'
import { Skeleton } from '@/ui/skeleton'
import { ConfirmCard } from '@/ui/confirm-card'
import { Grow } from '@/ui/grow'
import { cn } from '@/lib/cn'
import { useMedia } from '@/lib/use-media'
import type { Agent } from '@/state/agents'
import { fullMemoryText, useMemories, useMemoryActions, type Memory } from '@/state/memory'

type Props = {
  agent: Agent
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Called with what the person typed in "Tell {agent} something to remember".
   * Send `rememberMessage(text)` to the agent in chat; it saves the memory itself.
   * Without it the field is hidden.
   */
  onRemember?: (text: string) => void
}

const spring = { type: 'spring', duration: 0.35, bounce: 0 } as const
const ease = [0.16, 1, 0.3, 1] as const
/** How long to keep checking for the agent to save what it was told. */
const WATCH_MS = 45_000

/** What an agent remembers about you, and the notes it keeps: read, fix, forget. */
export function MemorySheet({ agent, open, onOpenChange, onRemember }: Props) {
  const [watchUntil, setWatchUntil] = useState(0)
  const memories = useMemories(agent.id, { enabled: open, watch: watchUntil > Date.now() })
  const actions = useMemoryActions(agent.id)
  const [editing, setEditing] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [wiping, setWiping] = useState(false)
  // Hermes ids move as cards come and go, and an edit changes the text, so
  // cards are keyed by what they said when first shown.
  const keys = useRef(new Map<string, string>())
  const keyOf = (m: Memory) => keys.current.get(`${m.kind}:${m.text}`) ?? `${m.kind}:${m.text}`

  useEffect(() => {
    if (open) return
    setEditing(null)
    setRevealed(null)
  }, [open])

  const list = memories.data ?? []
  const you = list.filter((m) => m.kind === 'you')
  const notes = list.filter((m) => m.kind === 'note')
  const empty = memories.isSuccess && list.length === 0

  const forget = (memory: Memory) => {
    setRevealed(null)
    if (editing === keyOf(memory)) setEditing(null)
    actions.forget(memory).catch((e: Error) => toast.error(friendly(e, 'Couldn’t forget that. Try again.')))
  }

  const save = async (memory: Memory, text: string) => {
    if (text.trim() === memory.text) return setEditing(null)
    try {
      const key = keyOf(memory)
      keys.current.set(`${memory.kind}:${text.trim()}`, key)
      await actions.edit(memory, text)
      setEditing(null)
    } catch (e) {
      toast.error(friendly(e as Error, 'Couldn’t save that change. Try again.'))
    }
  }

  const forgetAll = async () => {
    setWiping(true)
    setEditing(null)
    setRevealed(null)
    try {
      await actions.forgetAll()
    } catch (e) {
      toast.error(friendly(e as Error, 'Couldn’t forget everything. Try again.'))
    } finally {
      setTimeout(() => setWiping(false), 600)
    }
  }

  const card = (memory: Memory, index: number) => {
    const key = keyOf(memory)
    return (
      <MemoryCard
        key={key}
        agentId={agent.id}
        memory={memory}
        exitDelay={wiping ? index * 0.04 : 0}
        editing={editing === key}
        revealed={revealed === key}
        onEdit={() => {
          setRevealed(null)
          setEditing(key)
        }}
        onCancel={() => setEditing(null)}
        onSave={(text) => save(memory, text)}
        onReveal={(on) => setRevealed(on ? key : null)}
        onForget={() => forget(memory)}
      />
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`What ${agent.name} remembers`}
      description={`Things ${agent.name} has picked up from your chats.`}
      width={480}
    >
      <Grow className="hue-scope" style={{ '--hue': agent.hue } as CSSProperties}>
        {onRemember && (
          <RememberField
            name={agent.name}
            onSubmit={(text) => {
              onRemember(text)
              setWatchUntil(Date.now() + WATCH_MS)
              setTimeout(() => setWatchUntil(0), WATCH_MS)
            }}
          />
        )}

        {memories.isPending && open ? (
          <Loading />
        ) : memories.isError ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <p className="text-subhead text-ink-2">Can’t load what {agent.name} remembers right now.</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => memories.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <Group title="About you" count={you.length}>
              {you.map((m, i) => card(m, i))}
            </Group>
            <Group title="Notes" count={notes.length}>
              {notes.map((m, i) => card(m, you.length + i))}
            </Group>

            <AnimatePresence initial={false}>{empty && <Empty key="empty" agent={agent} />}</AnimatePresence>

            {list.length > 0 && (
              <motion.div layout="position" transition={spring}>
                <Hint />
                <ForgetEverything name={agent.name} count={list.length} onConfirm={forgetAll} />
              </motion.div>
            )}
          </>
        )}
      </Grow>
    </Sheet>
  )
}

function friendly(error: Error, fallback: string) {
  // Our own messages are already human; Hermes's aren't.
  return /changed in the meantime|can’t be empty/.test(error.message) ? error.message : fallback
}

// ── Groups and cards ────────────────────────────────────────────────────────

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <motion.section layout="position" transition={spring} className={cn(count > 0 && 'mt-6 first:mt-2')}>
      <AnimatePresence initial={false}>
        {count > 0 && (
          <motion.h3
            key="title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className="mb-2 px-4 text-footnote font-medium text-ink-2"
          >
            {title}
          </motion.h3>
        )}
      </AnimatePresence>
      {/* Stays mounted so the last cards can dissolve out, but an empty list
          isn't announced to screen readers as one. */}
      <ul role={count > 0 ? undefined : 'presentation'} className="relative flex flex-col gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {children}
        </AnimatePresence>
      </ul>
    </motion.section>
  )
}

const REVEAL = 92

type CardProps = {
  /** AnimatePresence's popLayout measures the card through this. */
  ref?: React.Ref<HTMLLIElement>
  agentId: string
  memory: Memory
  editing: boolean
  revealed: boolean
  exitDelay: number
  onEdit: () => void
  onCancel: () => void
  onSave: (text: string) => Promise<void>
  onReveal: (on: boolean) => void
  onForget: () => void
}

function MemoryCard({
  ref,
  agentId,
  memory,
  editing,
  revealed,
  exitDelay,
  onEdit,
  onCancel,
  onSave,
  onReveal,
  onForget,
}: CardProps) {
  const reduce = useReducedMotion()
  const fine = useMedia('(hover: hover) and (pointer: fine)')
  const x = useMotionValue(0)
  const actionOpacity = useTransform(x, [-REVEAL, -12, 0], [1, 0.6, 0])
  const actionScale = useTransform(x, [-REVEAL, 0], [1, 0.85])
  const press = useRef<ReturnType<typeof setTimeout>>(undefined)
  const longPressed = useRef(false)
  // A swipe ends in a click on the card; that click shouldn't open the editor.
  const dragged = useRef(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const controls = animate(x, revealed ? -REVEAL : 0, { type: 'spring', stiffness: 500, damping: 42 })
    return () => controls.stop()
  }, [revealed, x])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    setTimeout(() => (dragged.current = false), 0)
    // A long, fast swipe forgets straight away, the way Mail deletes.
    if (info.offset.x < -200 || info.velocity.x < -1400) return onForget()
    const open = info.offset.x < -REVEAL / 2 || info.velocity.x < -400
    animate(x, open ? -REVEAL : 0, { type: 'spring', stiffness: 500, damping: 42, velocity: info.velocity.x })
    onReveal(open)
  }

  // Dissolve: the note softens, lifts and evaporates; the ones below glide up.
  const dissolve = reduce
    ? { opacity: 0, transition: { duration: 0.15 } }
    : {
        opacity: 0,
        scale: 1.03,
        y: -6,
        filter: 'blur(10px)',
        transition: { duration: 0.42, ease, delay: exitDelay },
      }

  return (
    <motion.li
      ref={ref}
      layout="position"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={dissolve}
      transition={spring}
      className="group relative"
    >
      {/* Revealed by swiping left or a long press. */}
      <motion.button
        type="button"
        tabIndex={revealed ? 0 : -1}
        aria-hidden={!revealed}
        onClick={onForget}
        style={{ width: REVEAL - 8, opacity: actionOpacity, scale: actionScale }}
        className="absolute inset-y-0 right-0 flex items-center justify-center rounded-xl bg-danger text-subhead font-medium text-white"
      >
        Forget
      </motion.button>

      <motion.div
        style={{ x }}
        drag={editing ? false : 'x'}
        dragDirectionLock
        dragConstraints={{ left: -REVEAL, right: 0 }}
        dragElastic={{ left: 0.5, right: 0 }}
        onDragStart={() => {
          dragged.current = true
          clearTimeout(press.current)
        }}
        onDragEnd={onDragEnd}
        className={cn(
          'relative rounded-xl bg-elevated transition-[box-shadow] duration-200',
          // An opaque card (so the red can't show through) tinted like the rest.
          '[background-image:linear-gradient(var(--fill-1),var(--fill-1))]',
          editing && 'shadow-[inset_0_0_0_1.5px_var(--accent)]',
        )}
      >
        {editing ? (
          <Editor
            agentId={agentId}
            memory={memory}
            roomy={fine}
            onCancel={onCancel}
            onSave={async (text) => {
              await onSave(text)
              setSaved(true)
              setTimeout(() => setSaved(false), 900)
            }}
          />
        ) : (
          <button
            type="button"
            onPointerDown={() => {
              longPressed.current = false
              press.current = setTimeout(() => {
                longPressed.current = true
                navigator.vibrate?.(10)
                onReveal(true)
              }, 500)
            }}
            onPointerUp={() => clearTimeout(press.current)}
            onPointerLeave={() => clearTimeout(press.current)}
            onPointerCancel={() => clearTimeout(press.current)}
            onContextMenu={(e) => {
              e.preventDefault()
              onReveal(true)
            }}
            onClick={() => {
              if (longPressed.current || dragged.current) return
              if (revealed) onReveal(false)
              else onEdit()
            }}
            className={cn(
              // Long links and words wrap rather than push the card wide.
              'block w-full rounded-xl py-3 pl-4 text-left text-body whitespace-pre-line text-ink [overflow-wrap:anywhere]',
              'transition-colors duration-150 active:bg-fill-2 [@media(hover:hover)]:hover:bg-fill-1',
              fine ? 'pr-11' : 'pr-4',
            )}
          >
            {memory.text}
            {memory.clipped && '…'}
          </button>
        )}

        {/* A quiet tick after an edit lands. */}
        <AnimatePresence>
          {saved && (
            <motion.span
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', duration: 0.35, bounce: 0.25 }}
              className="pointer-events-none absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-success text-white"
            >
              <Check size={12} strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>

        {fine && !editing && !saved && (
          <button
            type="button"
            onClick={() => onReveal(!revealed)}
            aria-label="Forget this"
            title="Forget this"
            className={cn(
              'pressable absolute top-2 right-2 flex size-8 items-center justify-center rounded-full text-ink-3',
              'opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-fill-2 hover:text-ink focus-visible:opacity-100',
              revealed && 'invisible',
            )}
          >
            <X size={16} strokeWidth={2} />
          </button>
        )}
      </motion.div>
    </motion.li>
  )
}

function Editor({
  agentId,
  memory,
  roomy,
  onCancel,
  onSave,
}: {
  agentId: string
  memory: Memory
  /** Leave the same room on the right as the card's hover button, so lines don't rewrap. */
  roomy: boolean
  onCancel: () => void
  onSave: (text: string) => Promise<void>
}) {
  const [text, setText] = useState(memory.text)
  const [loading, setLoading] = useState(memory.clipped)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  // Long notes are cut short in the list; edit the whole thing.
  useEffect(() => {
    if (!memory.clipped) return
    fullMemoryText(agentId, memory)
      .then(setText)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [agentId, memory])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  useEffect(() => {
    const el = ref.current
    if (!el || loading) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [loading])

  // Escape leaves the edit, not the sheet: catch it before the dialog does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const submit = async () => {
    if (!text.trim() || saving) return
    setSaving(true)
    try {
      await onSave(text)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 pt-3 pb-3">
      <textarea
        ref={ref}
        value={text}
        disabled={loading}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
        aria-label="Memory"
        className={cn(
          'block w-full resize-none bg-transparent text-body text-ink outline-none placeholder:text-ink-3 disabled:opacity-50 [overflow-wrap:anywhere]',
          roomy && 'pr-7',
        )}
      />
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease }}
        className="mt-3 flex items-center justify-end gap-2"
      >
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="accent" size="sm" onClick={submit} loading={saving} disabled={!text.trim() || loading}>
          Save
        </Button>
      </motion.div>
    </div>
  )
}

// ── Telling it something new ────────────────────────────────────────────────

function RememberField({ name, onSubmit }: { name: string; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const ready = text.trim().length > 0

  useEffect(() => () => clearTimeout(timer.current), [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    onSubmit(text.trim())
    setText('')
    setSent(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSent(false), 3200)
  }

  return (
    <form onSubmit={submit} className="relative mt-1 mb-2">
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (sent) setSent(false)
        }}
        enterKeyHint="send"
        aria-label={`Tell ${name} something to remember`}
        placeholder={sent ? '' : `Tell ${name} something to remember`}
        className={cn(
          'h-12 w-full rounded-full bg-fill-1 pr-13 pl-5 text-body text-ink outline-none placeholder:text-ink-3',
          'ring-1 ring-transparent ring-inset transition-[background-color,box-shadow] duration-200 focus:bg-fill-2 focus:ring-line-strong',
        )}
      />
      <AnimatePresence>
        {sent && !text && (
          <motion.span
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.24, ease }}
            className="pointer-events-none absolute inset-y-0 left-5 flex items-center gap-2 text-body text-ink-2"
          >
            <Check size={16} strokeWidth={2.5} className="text-success" aria-hidden />
            Sent. {name} will save it in a moment.
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {ready && (
          <motion.button
            type="submit"
            aria-label="Send"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.12 } }}
            // motion owns this button's transform, so the press lives here rather than in CSS.
            whileTap={{ scale: 0.94 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.2 }}
            className="absolute top-1.5 right-1.5 flex size-9 items-center justify-center rounded-full bg-accent text-accent-ink after:absolute after:-inset-1"
          >
            <ArrowUp size={18} strokeWidth={2.25} />
          </motion.button>
        )}
      </AnimatePresence>
    </form>
  )
}

// ── States ──────────────────────────────────────────────────────────────────

function Empty({ agent }: { agent: Agent }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { ...spring, delay: 0.25 } }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className="flex flex-col items-center px-4 pt-8 pb-6 text-center"
    >
      <Buddy hue={agent.hue} size={64} seed={agent.id} />
      <p className="mt-4 text-body font-medium text-ink">Nothing saved yet</p>
      <p className="mt-1 max-w-72 text-subhead text-balance text-ink-2">
        As you chat, {agent.name} remembers what matters.
      </p>
    </motion.div>
  )
}

/** The shape of the list while it loads: a heading and three cards, sized like the real ones. */
function Loading() {
  return (
    <div className="mt-2" aria-busy aria-label="Loading">
      <div className="mb-2 flex h-[18px] items-center px-4">
        <Skeleton className="h-2.5 w-20 rounded-full" />
      </div>
      <div className="flex flex-col gap-2">
        {[0.92, 0.7, 0.84].map((w, i) => (
          <div key={i} className="flex h-12 items-center rounded-xl bg-fill-1 px-4">
            <Skeleton className="h-3 rounded-full" style={{ width: `${w * 100}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function Hint() {
  const fine = useMedia('(hover: hover) and (pointer: fine)')
  return (
    <p className="mt-3 px-4 text-footnote text-pretty text-ink-3">
      {fine ? 'Click a memory to change it.' : 'Tap a memory to change it. Swipe left to forget it.'}
    </p>
  )
}

function ForgetEverything({ name, count, onConfirm }: { name: string; count: number; onConfirm: () => Promise<void> }) {
  return (
    <ConfirmCard
      className="mt-8 mb-1"
      label="Forget everything"
      title="Forget everything?"
      body={`${name} will lose ${count === 1 ? 'the one thing it remembers' : `all ${count} memories`}. This can’t be undone.`}
      confirm="Forget all"
      onConfirm={onConfirm}
    />
  )
}
