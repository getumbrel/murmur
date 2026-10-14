import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet } from '@/ui/sheet'
import { Button } from '@/ui/button'
import { Label, TextArea, TextField } from '@/ui/field'
import { Segmented } from '@/ui/segmented'
import { Spinner } from '@/ui/spinner'
import { Grow } from '@/ui/grow'
import { cn } from '@/lib/cn'
import { haptic } from '@/lib/haptics'
import type { Agent } from '@/state/agents'
import { useBlueprints, useDeliveryTargets, useRoutineActions, type BlueprintField } from '@/state/routines'
import { Glyph } from './glyph'
import { TimeWheel } from './time-wheel'
import { DayChips, RepeatPicker } from './day-picker'
import { Skeleton } from '@/ui/skeleton'
import { curate, fieldLabel, isHintOnly, optionLabel, tileFor, tiles, type Template, type Tile } from './templates'
import { EVERY_DAY, WEEKDAYS, WEEKENDS, describeWhen, type Days, type When } from './schedule'

export type NewRoutineView = { page: 'pick' } | { page: 'template'; key: string } | { page: 'custom' }

type Props = {
  agent: Agent
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new routine's id once it exists. */
  onCreated?: (id: string) => void
  /** Start somewhere other than the template gallery (deep links, screenshots). */
  initialView?: NewRoutineView
}

const push = { duration: 0.3, ease: [0.32, 0.72, 0, 1] } as const

/** Pick a template (or "Something else"), then fill in a short, friendly form. */
export function NewRoutineSheet({ agent, open, onOpenChange, onCreated, initialView }: Props) {
  const reduce = useReducedMotion()
  const blueprints = useBlueprints(open ? agent.id : undefined)
  const targets = useDeliveryTargets(open ? agent.id : undefined)
  const actions = useRoutineActions(agent.id)
  const templates = useMemo(() => curate(blueprints.data ?? []), [blueprints.data])
  // The gallery doesn't wait for Hermes: Murmur's own picks show at once.
  const gallery = useMemo(() => tiles(blueprints.data, blueprints.isError), [blueprints.data, blueprints.isError])

  const [view, setView] = useState<NewRoutineView>(initialView ?? { page: 'pick' })
  const [dir, setDir] = useState(1)
  const [busy, setBusy] = useState(false)
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const body = useRef<HTMLDivElement>(null)
  // Start fresh each time it opens.
  useEffect(() => {
    if (open) {
      setView(initialView ?? { page: 'pick' })
      setDir(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const go = (next: NewRoutineView, d: 1 | -1) => {
    setDir(d)
    setView(next)
  }

  // A new page starts at its top, the way a pushed screen does.
  const pageKey = view.page === 'template' ? view.key : view.page
  useLayoutEffect(() => {
    body.current?.closest('.overflow-y-auto')?.scrollTo({ top: 0 })
  }, [pageKey])

  const template = view.page === 'template' ? templates.find((t) => t.key === view.key) : undefined
  // Picked before Hermes's details arrived: its own words while they do.
  const tile = template ?? (view.page === 'template' ? tileFor(view.key) : undefined)
  const title = view.page === 'custom' ? 'Something else' : tile ? tile.title : 'New routine'

  const finish = async (create: () => Promise<string>) => {
    setBusy(true)
    try {
      const id = await create()
      haptic('success')
      onCreated?.(id)
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? `Couldn’t add that routine. ${err.message}`
          : 'Couldn’t add that routine. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const page: { key: string; body: ReactNode } =
    view.page === 'pick'
      ? {
          key: 'pick',
          body: (
            <Gallery
              agent={agent}
              templates={gallery}
              onPick={(t) => go({ page: 'template', key: t.key }, 1)}
              onCustom={() => go({ page: 'custom' }, 1)}
            />
          ),
        }
      : view.page === 'template' && template
        ? {
            key: `t-${template.key}`,
            body: (
              <TemplateForm
                template={template}
                telegram={Boolean(targets.data?.telegram)}
                busy={busy}
                onBack={() => go({ page: 'pick' }, -1)}
                onSubmit={(input) =>
                  finish(() => actions.createFromTemplate({ blueprint: template.blueprint, ...input }))
                }
              />
            ),
          }
        : view.page === 'custom'
          ? {
              key: 'custom',
              body: (
                <CustomForm
                  agent={agent}
                  telegram={Boolean(targets.data?.telegram)}
                  busy={busy}
                  onBack={() => go({ page: 'pick' }, -1)}
                  onSubmit={(input) => finish(() => actions.createCustom(input))}
                />
              ),
            }
          : tile && blueprints.isPending
            ? {
                key: `t-${tile.key}`,
                body: <FormSkeleton tile={tile} onBack={() => go({ page: 'pick' }, -1)} />,
              }
            : {
                key: 'loading',
                body: (
                  <div className="flex justify-center py-16 text-ink-3">
                    <Spinner size={20} />
                  </div>
                ),
              }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      // The gallery says what it's for right under its title, like Routines does.
      description={
        view.page === 'pick' ? `Pick something for ${agent.name} to do on its own. You can change it any time.` : undefined
      }
      width={480}
      footer={
        view.page === 'pick' ? undefined : (
          <div ref={setFooter} className="hue-scope" style={{ '--hue': agent.hue } as CSSProperties} />
        )
      }
    >
      <FooterSlot.Provider value={footer}>
        <Grow className="hue-scope" style={{ '--hue': agent.hue } as CSSProperties}>
          <div ref={body} className="relative">
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.div
                key={page.key}
                custom={dir}
                variants={{
                  enter: (d: number) => (reduce ? { opacity: 0 } : { opacity: 0, x: d * 32 }),
                  center: { opacity: 1, x: 0 },
                  exit: (d: number) => (reduce ? { opacity: 0 } : { opacity: 0, x: d * -32 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={reduce ? { duration: 0.12 } : push}
              >
                {page.body}
              </motion.div>
            </AnimatePresence>
          </div>
        </Grow>
      </FooterSlot.Provider>
    </Sheet>
  )
}

/** The sheet's pinned footer, where each form puts its button. */
const FooterSlot = createContext<HTMLElement | null>(null)

// ── Gallery ─────────────────────────────────────────────────────────────────

function Gallery({
  agent,
  templates,
  onPick,
  onCustom,
}: {
  agent: Agent
  templates: Tile[]
  onPick: (t: Tile) => void
  onCustom: () => void
}) {
  const reduce = useReducedMotion()
  const rise = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.42, ease: [0.16, 1, 0.3, 1] as const, delay: Math.min(i, 10) * 0.025 },
        }
  return (
    <div className="pb-1">
      <div className="grid grid-cols-2 gap-2">
        {templates.map((t, i) => (
          <motion.button
            key={t.key}
            type="button"
            onClick={() => onPick(t)}
            {...rise(i)}
            className="pressable flex min-h-[124px] flex-col items-start rounded-xl bg-fill-1 p-4 text-left hover:bg-fill-2 active:bg-fill-2"
          >
            <Glyph icon={t.icon} size={36} />
            <span className="mt-3 block text-subhead font-semibold tracking-[-0.01em] text-balance">
              {unbroken(t.title)}
            </span>
            {/* No `block` here: it would undo the clamp's -webkit-box. */}
            <span className="mt-0.5 line-clamp-3 text-footnote text-pretty text-ink-2">{t.description}</span>
          </motion.button>
        ))}
        <motion.button
          type="button"
          onClick={onCustom}
          {...rise(templates.length)}
          className="pressable col-span-2 flex items-center gap-3 rounded-xl p-4 text-left ring-1 ring-line-strong ring-inset hover:bg-fill-1"
        >
          <Glyph icon={PenLine} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block text-subhead font-semibold tracking-[-0.01em]">Something else</span>
            <span className="block text-footnote text-ink-2">Tell {agent.name} what to do, and when.</span>
          </span>
        </motion.button>
      </div>
    </div>
  )
}

/** Keep hyphenated words whole: "Evening wind-down", never "wind-" / "down". */
function unbroken(text: string) {
  return text.split(/(\S+-\S+)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

// ── Pieces shared by both forms ─────────────────────────────────────────────

function Header({
  template,
  onBack,
}: {
  template: { title: string; description: string; icon: Template['icon'] }
  onBack: () => void
}) {
  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl bg-fill-1 p-4">
      <Glyph icon={template.icon} size={40} />
      <p className="min-w-0 flex-1 text-footnote text-pretty text-ink-2">{template.description}</p>
      <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-mr-1 flex-none text-accent!">
        Change
      </Button>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <Label hint={hint}>{label}</Label>
      {children}
    </section>
  )
}

/** Pill choices: for options that don't fit a segmented control. */
function Choices<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'pressable touch-target relative h-9 rounded-full px-4 text-footnote font-medium transition-colors duration-200',
              on ? 'bg-accent text-accent-ink' : 'bg-fill-2 text-ink hover:bg-fill-3',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

type Deliver = 'local' | 'telegram'

function DeliverPicker({ value, onChange }: { value: Deliver; onChange: (v: Deliver) => void }) {
  return (
    <Field label="Results">
      <Segmented<Deliver>
        label="Results"
        value={value}
        onChange={onChange}
        options={[
          { value: 'local', label: 'Here in Murmur' },
          { value: 'telegram', label: 'Also on Telegram' },
        ]}
      />
    </Field>
  )
}

/** "Add routine", pinned in the sheet's footer. */
function Submit({
  onSubmit,
  busy,
  disabled,
  when,
}: {
  onSubmit: () => void
  busy: boolean
  disabled?: boolean
  when?: string
}) {
  const slot = useContext(FooterSlot)
  if (!slot) return null
  return createPortal(
    <div>
      <AnimatePresence mode="popLayout" initial={false}>
        {when && (
          <motion.p
            key={when}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="mb-2.5 truncate text-center text-footnote text-ink-2"
          >
            {when}
          </motion.p>
        )}
      </AnimatePresence>
      <Button type="button" variant="accent" size="lg" loading={busy} disabled={disabled} onClick={onSubmit}>
        Add routine
      </Button>
    </div>,
    slot,
  )
}

// ── From a template ─────────────────────────────────────────────────────────

/** A template's form while Hermes's details for it are still on the way. */
function FormSkeleton({ tile, onBack }: { tile: Tile; onBack: () => void }) {
  return (
    <div aria-busy="true">
      <Header template={tile} onBack={onBack} />
      {[0, 1].map((i) => (
        <section key={i} className="mb-6">
          <Skeleton className="mb-3 ml-1 h-2.5 w-24 rounded-full" />
          <Skeleton className="h-12 rounded-xl" />
        </section>
      ))}
      <Submit onSubmit={() => {}} busy={false} disabled />
    </div>
  )
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function defaultsFor(t: Template) {
  const b = t.blueprint
  const time = b.fields.find((f) => f.type === 'time')?.default ?? '08:00'
  const [hour, minute] = time.split(':').map(Number)
  let days: Days = EVERY_DAY
  const recurrence = b.fields.find((f) => f.type === 'weekdays')?.default
  const day = b.fields.find((f) => f.name === 'day')?.default
  if (recurrence === 'weekdays') days = WEEKDAYS
  else if (recurrence === 'weekends') days = WEEKENDS
  else if (day && DAY_NAMES.includes(day)) days = [DAY_NAMES.indexOf(day)]
  else if (/\*\s+\*\s+1-5$/.test(b.schedule ?? '')) days = WEEKDAYS
  const values: Record<string, string> = {}
  for (const f of t.fields) values[f.name] = isHintOnly(t.key, f.name) ? '' : (f.default ?? '')
  return { hour: hour || 0, minute: minute || 0, days, values }
}

function TemplateForm({
  template,
  telegram,
  busy,
  onBack,
  onSubmit,
}: {
  template: Template
  telegram: boolean
  busy: boolean
  onBack: () => void
  onSubmit: (input: {
    values: Record<string, string>
    when?: Extract<When, { kind: 'time' }>
    name: string
    deliver: Deliver
  }) => void
}) {
  const initial = useMemo(() => defaultsFor(template), [template])
  const [values, setValues] = useState(initial.values)
  const [time, setTime] = useState({ hour: initial.hour, minute: initial.minute })
  const [days, setDays] = useState<Days>(initial.days)
  const [deliver, setDeliver] = useState<Deliver>('local')

  const when = template.timed ? ({ kind: 'time', ...time, days } as const) : undefined
  const missing = template.fields.some((f) => !f.optional && f.type === 'text' && !values[f.name]?.trim())
  const set = (name: string, v: string) => setValues((s) => ({ ...s, [name]: v }))
  const submit = () => {
    if (missing || busy) return
    const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]))
    onSubmit({ values: trimmed, when, name: template.nameFor(trimmed), deliver })
  }

  // Not a <form>: segmented controls are buttons, and Enter must never press one.
  return (
    <div>
      <Header template={template} onBack={onBack} />

      {template.fields.map((f) => (
        <BlueprintInput
          key={f.name}
          template={template.key}
          field={f}
          value={values[f.name] ?? ''}
          onChange={(v) => set(f.name, v)}
          onEnter={submit}
        />
      ))}

      {template.timed && (
        <>
          <Field label="Time">
            <TimeWheel hour={time.hour} minute={time.minute} onChange={(hour, minute) => setTime({ hour, minute })} />
          </Field>
          <Field label={template.days === 'one' ? 'Day' : 'Repeat'}>
            {template.days === 'one' ? (
              <DayChips days={days.slice(0, 1)} onChange={setDays} single className="px-1" />
            ) : (
              <RepeatPicker days={days} onChange={setDays} />
            )}
          </Field>
        </>
      )}

      {telegram && <DeliverPicker value={deliver} onChange={setDeliver} />}

      <Submit
        onSubmit={submit}
        busy={busy}
        disabled={missing}
        when={when ? describeWhen(when) : humanizeFixed(template)}
      />
    </div>
  )
}

/** For templates whose rhythm is fixed by Hermes, e.g. "every 30 minutes". */
function humanizeFixed(t: Template) {
  const s = t.blueprint.scheduleHuman
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

function BlueprintInput({
  template,
  field,
  value,
  onChange,
  onEnter,
}: {
  template: string
  field: BlueprintField
  value: string
  onChange: (v: string) => void
  onEnter: () => void
}) {
  const label = fieldLabel(template, field)
  if (field.type === 'enum' && field.options.length) {
    const options = field.options.map((o) => ({ value: String(o), label: optionLabel(template, field, String(o)) }))
    const fitsSegmented = options.length <= 3 && options.every((o) => o.label.length <= 12)
    return (
      <Field label={label}>
        {fitsSegmented ? (
          <Segmented label={label} value={value || options[0].value} options={options} onChange={onChange} />
        ) : (
          <Choices value={value || options[0].value} options={options} onChange={onChange} label={label} />
        )}
      </Field>
    )
  }
  const hint = isHintOnly(template, field.name) ? field.default : undefined
  return (
    <Field label={label}>
      <TextField
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint ? hint[0].toUpperCase() + hint.slice(1) : field.help || undefined}
        enterKeyHint="done"
        autoCapitalize="sentences"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
          e.preventDefault()
          e.currentTarget.blur()
          onEnter()
        }}
      />
    </Field>
  )
}

// ── Something else ──────────────────────────────────────────────────────────

type Kind = 'time' | 'every' | 'once'
type OnceDay = 'today' | 'tomorrow' | 'pick'

const IDEAS = ['Tell me if I’ll need an umbrella', 'Share a quote to start my day', 'Remind me to take my vitamins']

const dateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function nameFrom(prompt: string) {
  const first = prompt
    .split(/\n|(?<=[.!?])\s/)[0]
    .replace(/[.!?\s]+$/, '')
    .trim()
  const s = first.length > 44 ? `${first.slice(0, 43).trimEnd()}…` : first
  return s ? s[0].toUpperCase() + s.slice(1) : 'Routine'
}

function CustomForm({
  agent,
  telegram,
  busy,
  onBack,
  onSubmit,
}: {
  agent: Agent
  telegram: boolean
  busy: boolean
  onBack: () => void
  onSubmit: (input: { prompt: string; when: When; name: string; deliver: Deliver }) => void
}) {
  const reduce = useReducedMotion()
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<Kind>('time')
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60_000)
    return { hour: d.getHours(), minute: 0 }
  })
  const [days, setDays] = useState<Days>(EVERY_DAY)
  const [hours, setHours] = useState('3')
  const [onceDay, setOnceDay] = useState<OnceDay>('today')
  const [picked, setPicked] = useState(() => dateInput(new Date(Date.now() + 2 * 86_400_000)))
  const [deliver, setDeliver] = useState<Deliver>('local')

  const onceAt = (() => {
    const base = onceDay === 'pick' ? new Date(`${picked}T00:00`) : new Date()
    if (onceDay === 'tomorrow') base.setDate(base.getDate() + 1)
    base.setHours(time.hour, time.minute, 0, 0)
    return base.getTime()
  })()

  const when: When =
    kind === 'time'
      ? { kind: 'time', ...time, days }
      : kind === 'every'
        ? { kind: 'every', minutes: Number(hours) * 60 }
        : { kind: 'once', at: onceAt }

  const past = kind === 'once' && (Number.isNaN(onceAt) || onceAt <= Date.now() + 30_000)
  const disabled = !prompt.trim() || past
  const submit = () => {
    if (disabled || busy) return
    onSubmit({ prompt: prompt.trim(), when, name: nameFrom(prompt), deliver })
  }

  return (
    <div>
      <Header
        template={{
          title: 'Something else',
          description: `Ask ${agent.name} for anything, on your schedule.`,
          icon: PenLine,
        }}
        onBack={onBack}
      />

      <Field label={`What should ${agent.name} do?`}>
        <TextArea
          aria-label={`What should ${agent.name} do?`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Look up the weekend weather and suggest something fun to do"
          className="min-h-24"
          autoCapitalize="sentences"
        />
        <AnimatePresence initial={false}>
          {!prompt && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={reduce ? { duration: 0.12 } : { type: 'spring', duration: 0.3, bounce: 0 }}
              className="-mx-5 overflow-hidden [@media(min-width:900px)]:-mx-6"
            >
              <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pt-3 [@media(min-width:900px)]:px-6">
                {IDEAS.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setPrompt(idea)}
                    className="pressable h-8 flex-none rounded-full bg-fill-2 px-3.5 text-footnote text-ink-2 hover:bg-fill-3 hover:text-ink"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Field>

      <Field label="When">
        <Segmented<Kind>
          label="When"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'time', label: 'At a time' },
            { value: 'every', label: 'Hourly' },
            { value: 'once', label: 'Once' },
          ]}
        />
      </Field>

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={kind}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0.12 } : { duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        >
          {kind === 'every' ? (
            <Field label="How often">
              <Choices
                label="How often"
                value={hours}
                onChange={setHours}
                options={['1', '2', '3', '6', '12'].map((h) => ({
                  value: h,
                  label: h === '1' ? 'Every hour' : `${h} hours`,
                }))}
              />
            </Field>
          ) : (
            <>
              {kind === 'once' && (
                <Field label="Day">
                  <div className="flex flex-wrap items-center gap-2">
                    <Choices<OnceDay>
                      label="Day"
                      value={onceDay}
                      onChange={setOnceDay}
                      options={[
                        { value: 'today', label: 'Today' },
                        { value: 'tomorrow', label: 'Tomorrow' },
                        { value: 'pick', label: 'Another day' },
                      ]}
                    />
                    {onceDay === 'pick' && (
                      <input
                        type="date"
                        value={picked}
                        min={dateInput(new Date())}
                        onChange={(e) => setPicked(e.target.value)}
                        className="h-9 rounded-full bg-fill-2 px-3.5 text-footnote font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        aria-label="Date"
                      />
                    )}
                  </div>
                </Field>
              )}
              <Field label="Time" hint={past ? <span className="text-danger">That time has passed</span> : undefined}>
                <TimeWheel
                  hour={time.hour}
                  minute={time.minute}
                  onChange={(hour, minute) => setTime({ hour, minute })}
                />
              </Field>
              {kind === 'time' && (
                <Field label="Repeat">
                  <RepeatPicker days={days} onChange={setDays} />
                </Field>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {telegram && <DeliverPicker value={deliver} onChange={setDeliver} />}

      <Submit onSubmit={submit} busy={busy} disabled={disabled} when={describeWhen(when)} />
    </div>
  )
}
