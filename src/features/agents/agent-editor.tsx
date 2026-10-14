import { AnimatePresence, animate, motion, useReducedMotion, type AnimationPlaybackControls } from 'motion/react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'
import { Button } from '@/ui/button'
import { Label, TextArea, TextField } from '@/ui/field'
import { Orb, type OrbState } from '@/ui/orb'
import { Sheet } from '@/ui/sheet'
import { HUES } from '@/lib/hues'
import { cn } from '@/lib/cn'
import { useMedia } from '@/lib/use-media'
import { slugFor } from '@/state/agents'
import { useKeyboardInset } from '@/features/chat/use-keyboard-inset'

// Make or edit an agent: a name, a colour, what it's for and how it talks.
// The preview orb at the top is the agent; everything below shapes it live.
//
// Its Buddy is the one it has everywhere else: every surface seeds Buddy with
// the agent's id. Editing, that's the id it has. Making one, it's the id it
// will get (the name's slug), settling a beat after typing stops so the body
// changes once, with a little hop, rather than on every keystroke.

export type Personality = 'warm' | 'concise' | 'playful' | 'thoughtful' | 'direct' | 'custom'

export type AgentDraft = {
  name: string
  hue: number
  role: string
  personality: Personality
  /** Free-form instructions, used when personality is "custom". */
  custom: string
  /** The template it started from (features/templates), if any. */
  template?: string
}

const PERSONALITIES: { id: Personality; label: string; sample: string; prompt: string }[] = [
  {
    id: 'warm',
    label: 'Warm',
    sample: 'Happy to help. Let’s figure this out together.',
    prompt:
      'You are warm and encouraging. Talk like a kind, capable friend: notice how the person is feeling, explain things patiently, and celebrate progress without overdoing it.',
  },
  {
    id: 'concise',
    label: 'Concise',
    sample: 'Done. Three options below.',
    prompt:
      'You are concise. Lead with the answer, use as few words as clarity allows, prefer short lists to long paragraphs, and skip pleasantries and filler.',
  },
  {
    id: 'playful',
    label: 'Playful',
    sample: 'Ooh, a puzzle. Let’s poke at it.',
    prompt:
      'You are playful and curious. Bring lightness and a little humour to the conversation and enjoy a good turn of phrase, but never let a joke get in the way of being genuinely useful.',
  },
  {
    id: 'thoughtful',
    label: 'Thoughtful',
    sample: 'A few angles are worth weighing first…',
    prompt:
      'You are thoughtful and considered. Think problems through before answering, surface trade-offs and assumptions, and explain your reasoning clearly and calmly.',
  },
  {
    id: 'direct',
    label: 'Direct',
    sample: 'Go with the second one. Here’s why.',
    prompt:
      'You are direct and candid. Give clear recommendations, say plainly when something is a bad idea, and only hedge when the uncertainty is real.',
  },
  { id: 'custom', label: 'Custom', sample: '', prompt: '' },
]

/** A short SOUL-style paragraph describing how the agent should talk. */
export function personalityPrompt(personality: Personality, custom = ''): string {
  if (personality === 'custom') return custom.trim()
  return PERSONALITIES.find((p) => p.id === personality)!.prompt
}

/** What each hue is called, for screen readers. */
const COLOUR_NAMES: Record<number, string> = {
  278: 'Violet',
  250: 'Blue',
  222: 'Sky',
  192: 'Teal',
  160: 'Green',
  128: 'Lime',
  82: 'Yellow',
  52: 'Orange',
  28: 'Red',
  4: 'Rose',
  338: 'Pink',
  308: 'Purple',
}

const NAMES = ['Juniper', 'Atlas', 'Pip', 'Nova', 'Ollie', 'Sage', 'Wren', 'Milo', 'Iris', 'Kit']

const emptyDraft = (initial?: Partial<AgentDraft>): AgentDraft => ({
  name: '',
  hue: HUES[0],
  role: '',
  personality: 'warm',
  custom: '',
  ...initial,
})

export const canSubmit = (d: AgentDraft) => d.name.trim().length > 0

/** Who's already here: their names (kept out of the suggestions) and ids (taken slugs). */
export type Taken = { names?: readonly string[]; ids?: readonly string[] }

type EditorProps = Taken & {
  initial?: Partial<AgentDraft>
  /** Editing: the agent's id, which seeds its Buddy. */
  seed?: string
  onSubmit: (draft: AgentDraft) => void
  onDelete?: () => void
  submitting?: boolean
  submitLabel?: string
  className?: string
}

/** Full-page editor with its own sticky footer. In a sheet, use AgentEditorSheet. */
export function AgentEditor({
  initial,
  onSubmit,
  onDelete,
  submitting,
  submitLabel = 'Create agent',
  className,
  seed,
  names,
  ids,
}: EditorProps) {
  const [draft, setDraft] = useState(() => emptyDraft(initial))
  const id = useId()
  return (
    <div className={cn('hue-scope flex flex-col', className)} style={{ '--hue': draft.hue } as CSSProperties}>
      <AgentFields
        id={id}
        draft={draft}
        onChange={setDraft}
        onSubmit={onSubmit}
        onDelete={onDelete}
        busy={submitting}
        seed={seed}
        names={names}
        ids={ids}
      />
      {/* Solid under the button, fading out above it, and above the fields it scrolls over. */}
      <div className="sticky bottom-0 z-10 mt-auto bg-[linear-gradient(to_top,var(--bg)_calc(100%-24px),transparent)] pt-6 pb-[max(16px,env(safe-area-inset-bottom))]">
        <Button form={id} type="submit" size="lg" variant="accent" loading={submitting} disabled={!canSubmit(draft)}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

type SheetProps = Omit<EditorProps, 'submitLabel' | 'className'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AgentEditorSheet({
  open,
  onOpenChange,
  initial,
  onSubmit,
  onDelete,
  submitting,
  seed,
  names,
  ids,
}: SheetProps) {
  const editing = !!initial?.name
  const [draft, setDraft] = useState(() => emptyDraft(initial))
  const id = useId()

  // Start fresh each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(emptyDraft(initial))
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit agent' : 'New agent'}
      footer={
        <div className="hue-scope" style={{ '--hue': draft.hue } as CSSProperties}>
          <Button form={id} type="submit" size="lg" variant="accent" loading={submitting} disabled={!canSubmit(draft)}>
            {editing ? 'Save' : 'Create agent'}
          </Button>
        </div>
      }
    >
      <div className="hue-scope" style={{ '--hue': draft.hue } as CSSProperties}>
        <AgentFields
          id={id}
          draft={draft}
          onChange={setDraft}
          onSubmit={onSubmit}
          onDelete={onDelete}
          busy={submitting}
          seed={seed}
          names={names}
          ids={ids}
        />
      </div>
    </Sheet>
  )
}

export type AgentFieldsProps = Taken & {
  /** Editing: the agent's id, which seeds its Buddy. Making one, leave it out. */
  seed?: string
  /** The form's id, for a submit button outside it. */
  id: string
  draft: AgentDraft
  onChange: (draft: AgentDraft) => void
  onSubmit: (draft: AgentDraft) => void
  onDelete?: () => void
  /** Arriving from somewhere (a template card): fields rise in, the orb says hello. */
  entering?: boolean
  /** Just created: the orb is delighted. */
  celebrate?: boolean
  /** Saving: the orb gets to work and the fields hold still. */
  busy?: boolean
}

/** The editor's fields on their own, for surfaces that bring their own chrome. */
export function AgentFields({
  id,
  draft,
  onChange,
  onSubmit,
  onDelete,
  entering,
  celebrate,
  busy,
  seed,
  names,
  ids,
}: AgentFieldsProps) {
  // Short phones keep the Name field in the first screenful.
  const short = useMedia('(max-height: 700px)')
  const set = (patch: Partial<AgentDraft>) => onChange({ ...draft, ...patch })
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const happy = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(happy.current), [])
  // Only a tap on Custom should raise the keyboard, not a pre-filled one.
  const [focusCustom, setFocusCustom] = useState(false)

  // A greeting once the orb has landed.
  useEffect(() => {
    if (!entering) return
    const t = setTimeout(() => {
      setOrbState('done')
      happy.current = setTimeout(() => setOrbState('idle'), 900)
    }, 380)
    return () => clearTimeout(t)
  }, [entering])
  const rise = (ms: number) => (entering ? { className: 'animate-rise', style: { animationDelay: `${ms}ms` } } : {})

  const hop = () => {
    setOrbState('done')
    clearTimeout(happy.current)
    happy.current = setTimeout(() => setOrbState('idle'), 900)
  }
  const pickHue = (hue: number) => {
    set({ hue })
    hop()
  }

  // The id a new agent will get, once typing settles (straight away when saving).
  const typed = draft.name.trim()
  const future = typed ? slugFor(typed, ids ?? []) : ''
  const [settled, setSettled] = useState(() => future || 'new')
  useEffect(() => {
    if (seed || !future || future === settled) return
    const t = setTimeout(
      () => {
        setSettled(future)
        if (!busy) hop()
      },
      busy ? 0 : 650,
    )
    return () => clearTimeout(t)
  }, [seed, future, settled, busy])
  const body = seed ?? settled
  const nextHue = () => pickHue(HUES[(HUES.indexOf(draft.hue as (typeof HUES)[number]) + 1) % HUES.length])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (canSubmit(draft) && !busy) onSubmit({ ...draft, name: draft.name.trim(), role: draft.role.trim() })
  }

  // Suggest names nobody here is using yet.
  const usedKey = (names ?? []).map((n) => n.trim().toLowerCase()).join('\n')
  const free = useMemo(() => {
    const used = new Set(usedKey.split('\n'))
    const left = NAMES.filter((n) => !used.has(n.toLowerCase()))
    return left.length ? left : NAMES
  }, [usedKey])
  const placeholder = useRotating(free, 2400, !draft.name)
  const current = PERSONALITIES.find((p) => p.id === draft.personality)!

  return (
    <form id={id} onSubmit={submit} className={cn(short ? 'space-y-5' : 'space-y-7')}>
      {/* Preview. Room above for its glow: the sheet's scrolling body would cut it off. */}
      <div className="flex flex-col items-center pt-8">
        <button
          type="button"
          onClick={nextHue}
          disabled={busy}
          aria-label="Change colour"
          className={cn('relative grid place-items-center rounded-full', short ? 'size-20' : 'size-28')}
        >
          <span
            className={cn(
              'pointer-events-none absolute -inset-8 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)] transition-colors duration-500',
              entering && 'animate-fade [animation-delay:200ms] [animation-duration:600ms]',
            )}
            aria-hidden
          />
          <span className={cn('relative block', entering && 'animate-rise')}>
            <Orb
              hue={draft.hue}
              size={short ? 72 : 96}
              state={celebrate ? 'done' : busy ? 'working' : orbState}
              seed={body}
              className="block transition-[filter] duration-500"
            />
          </span>
        </button>
        <p
          className={cn(
            'h-7 max-w-full truncate text-title font-semibold tracking-[-0.02em]',
            short ? 'mt-2' : 'mt-4',
            !draft.name && 'text-ink-3',
            entering && 'animate-rise',
          )}
          style={entering ? { animationDelay: '160ms' } : undefined}
        >
          {draft.name.trim() || placeholder}
        </p>
        <p
          className={cn('h-5 max-w-full truncate text-footnote text-ink-2', entering && 'animate-rise')}
          style={entering ? { animationDelay: '190ms' } : undefined}
        >
          {draft.role.trim()}
        </p>
      </div>

      <fieldset
        disabled={busy}
        className={cn('min-w-0 transition-opacity duration-300 disabled:opacity-50', short ? 'space-y-5' : 'space-y-7')}
      >
        {/* Name */}
        <div {...rise(60)}>
          <Label>Name</Label>
          <div className="relative">
            <TextField
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              aria-label="Name"
              maxLength={40}
              autoComplete="off"
              autoCapitalize="words"
            />
            {!draft.name && (
              <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center overflow-hidden text-body text-ink-3">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={placeholder}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {placeholder}
                  </motion.span>
                </AnimatePresence>
              </span>
            )}
          </div>
        </div>

        {/* Colour */}
        <div {...rise(100)}>
          <Label>Colour</Label>
          <div
            role="radiogroup"
            aria-label="Colour"
            className="grid grid-cols-6 justify-items-center gap-y-1 rounded-xl bg-fill-1 px-2 py-2"
          >
            {HUES.map((hue) => {
              const selected = hue === draft.hue
              return (
                <button
                  key={hue}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={COLOUR_NAMES[hue] ?? 'Colour'}
                  onClick={() => pickHue(hue)}
                  className="pressable relative grid size-11 place-items-center rounded-full [&_.buddy]:animate-none"
                >
                  <span
                    className={cn(
                      'absolute inset-[5px] rounded-full border-2 transition-[opacity,transform] duration-300 ease-[var(--ease-out)]',
                      selected ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
                    )}
                    style={{ borderColor: `oklch(0.66 0.17 ${hue})` }}
                  />
                  <Orb hue={hue} size={22} />
                </button>
              )
            })}
          </div>
        </div>

        {/* Role */}
        <div {...rise(140)}>
          <Label>What is it for?</Label>
          <TextField
            value={draft.role}
            onChange={(e) => set({ role: e.target.value })}
            placeholder="Research, writing, planning…"
            maxLength={80}
            autoComplete="off"
          />
        </div>

        {/* Personality */}
        <div {...rise(180)}>
          <Label>Personality</Label>
          <div role="radiogroup" aria-label="Personality" className="flex flex-wrap gap-2">
            {PERSONALITIES.map((p) => {
              const selected = p.id === draft.personality
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    set({ personality: p.id })
                    setFocusCustom(p.id === 'custom')
                  }}
                  className={cn(
                    'pressable h-11 rounded-full px-4 text-subhead font-medium',
                    selected ? 'bg-accent text-accent-ink' : 'bg-fill-2 text-ink-2 hover:text-ink',
                  )}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          <div className="mt-3">
            {draft.personality === 'custom' ? (
              <SoulField value={draft.custom} onChange={(custom) => set({ custom })} autoFocus={focusCustom} />
            ) : (
              <div className="flex items-end gap-2">
                <Orb hue={draft.hue} size={24} seed={body} className="mb-0.5" />
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.p
                    key={current.id}
                    className="rounded-[18px] rounded-bl-md bg-fill-2 px-3.5 py-2 text-subhead"
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    style={{ transformOrigin: '0% 100%' }}
                  >
                    {current.sample}
                  </motion.p>
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        {onDelete && (
          <Button type="button" variant="danger" size="lg" onClick={onDelete}>
            Delete agent
          </Button>
        )}
      </fieldset>
    </form>
  )
}

const grow = { type: 'spring', duration: 0.35, bounce: 0 } as const
const SOUL_HINT =
  'Describe how it should talk and behave. For example: “Calm and precise. Uses British spelling. Asks before making big changes.”'

/**
 * The personality (SOUL) box. It grows with what's written, up to 60% of the
 * screen (less the keyboard, on phones), then scrolls inside. Its height comes
 * from a hidden twin holding the same text, so measuring never collapses the
 * box: no caret or scroll jumps. Big changes (a template, a paste, a cut)
 * spring; a new line while typing appears at once, so the text never slides
 * under the caret.
 */
function SoulField({
  value,
  onChange,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const twin = useRef<HTMLTextAreaElement>(null)
  const motionRef = useRef<AnimationPlaybackControls>(undefined)
  const fitted = useRef(false)
  const reduce = useReducedMotion()
  const inset = useKeyboardInset()

  const fit = useCallback(
    (smooth: boolean) => {
      const el = box.current
      const ghost = twin.current
      if (!el || !ghost) return
      el.style.maxHeight = ''
      const css = getComputedStyle(el)
      const min = parseFloat(css.minHeight) || 0
      const max = parseFloat(css.maxHeight) || Infinity
      const line = parseFloat(css.lineHeight) || 24
      const content = Math.max(min, Math.ceil(ghost.scrollHeight))
      // Never scroll for less than a line: a few pixels over the cap, just fit.
      const want = content <= max + line ? content : max
      el.style.maxHeight = want > max ? 'none' : ''
      const from = el.getBoundingClientRect().height
      const delta = want - from
      if (Math.abs(delta) < 1) return
      motionRef.current?.stop()
      if (smooth && !reduce && fitted.current && !(delta > 0 && delta <= line * 1.5)) {
        motionRef.current = animate(el, { height: want }, grow)
        return
      }
      el.style.height = `${want}px`
      fitted.current = true
      // Typing past the bottom of what's visible: bring the new line along.
      if (delta > 0 && document.activeElement === el) {
        const scroller = el.closest<HTMLElement>('.overflow-y-auto')
        const vv = window.visualViewport
        const bottom = Math.min(
          scroller?.getBoundingClientRect().bottom ?? innerHeight,
          vv ? vv.offsetTop + vv.height : innerHeight,
        )
        const over = el.getBoundingClientRect().bottom + 12 - bottom
        if (over > 0) scroller?.scrollBy({ top: Math.min(over, delta) })
      }
    },
    [reduce],
  )

  useLayoutEffect(() => fit(true), [fit, value, inset])

  // A new width (rotation, a wider sheet, a web font arriving) rewraps the text.
  useEffect(() => {
    const ghost = twin.current
    if (!ghost) return
    let width = ghost.offsetWidth
    const ro = new ResizeObserver(() => {
      if (ghost.offsetWidth === width) return
      width = ghost.offsetWidth
      fit(false)
    })
    ro.observe(ghost)
    void document.fonts?.ready.then(() => fit(false))
    return () => {
      ro.disconnect()
      motionRef.current?.stop()
    }
  }, [fit])

  return (
    <div className="relative animate-fade" style={{ '--kb': `${inset}px` } as CSSProperties}>
      <TextArea
        ref={box}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={SOUL_HINT}
        aria-label="Custom personality"
        autoFocus={autoFocus}
        className="block max-h-[max(7rem,calc(60dvh-var(--kb)))]"
      />
      <TextArea
        ref={twin}
        value={value}
        placeholder={SOUL_HINT}
        readOnly
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none invisible absolute inset-x-0 top-0 h-0! min-h-0! overflow-hidden"
      />
    </div>
  )
}

/** Cycles through `items` while `active`. */
function useRotating<T>(items: readonly T[], ms: number, active: boolean) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setI((n) => (n + 1) % items.length), ms)
    return () => clearInterval(id)
  }, [items, ms, active])
  return items[i % items.length]
}
