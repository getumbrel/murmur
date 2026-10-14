import { memo, useRef, useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import { Orb } from '@/ui/orb'
import { Button } from '@/ui/button'
import { TextField } from '@/ui/field'
import { cn } from '@/lib/cn'
import type { ChatItem, ClarifyQuestion } from './types'
import { Swap, arrive } from './collapse'

type Item = Extract<ChatItem, { kind: 'clarify' }>
type Answer = { picked: string[]; other: string; otherOpen: boolean }
const EMPTY: Answer = { picked: [], other: '', otherOpen: false }

function valueOf(a: Answer) {
  return [...a.picked, ...(a.otherOpen && a.other.trim() ? [a.other.trim()] : [])].join(', ')
}

export const ClarifyCard = memo(function ClarifyCard({
  item,
  hue,
  seed,
  onAnswer,
}: {
  item: Item
  hue: number
  seed?: string
  onAnswer: (requestId: string, answers: Record<string, string>) => void
}) {
  const pending = item.status === 'pending'
  const watched = useRef(pending)
  return (
    <Swap id={pending ? 'card' : 'receipt'}>
      {pending ? (
        <Card item={item} hue={hue} seed={seed} onAnswer={onAnswer} />
      ) : (
        <Receipt item={item} fresh={watched.current} />
      )}
    </Swap>
  )
})

function Card({
  item,
  hue,
  seed,
  onAnswer,
}: {
  item: Item
  hue: number
  seed?: string
  onAnswer: (id: string, a: Record<string, string>) => void
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [sent, setSent] = useState(false)
  const single = item.questions.length === 1
  const get = (qid: string) => answers[qid] ?? EMPTY
  const set = (qid: string, next: Partial<Answer>) =>
    setAnswers((a) => ({ ...a, [qid]: { ...(a[qid] ?? EMPTY), ...next } }))
  const ready = item.questions.every((q) => valueOf(get(q.qid)))

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!ready || sent) return
    setSent(true)
    onAnswer(item.requestId, Object.fromEntries(item.questions.map((q) => [q.qid, valueOf(get(q.qid))])))
  }

  return (
    <motion.form
      {...arrive}
      onSubmit={submit}
      aria-label="Question from your agent"
      className="rounded-xl bg-elevated p-4 shadow-[inset_0_0_0_0.5px_var(--line-strong)]"
    >
      <div className="flex items-center gap-3">
        <Orb hue={hue} size={28} state="waiting" seed={seed} />
        <h3 className="min-w-0 flex-1 text-subhead font-semibold tracking-[-0.01em]">
          {single ? item.questions[0].question : 'A few questions'}
        </h3>
      </div>

      <div className="mt-3 space-y-5">
        {item.questions.map((q) => (
          <Question
            key={q.qid}
            q={q}
            showLabel={!single}
            answer={get(q.qid)}
            onChange={(n) => set(q.qid, n)}
            disabled={sent}
          />
        ))}
      </div>

      {/* Like the permission card: a full-width answer under the thumb on phones. */}
      <div className="mt-4 flex justify-end">
        <Button type="submit" variant="primary" disabled={!ready} loading={sent} className="h-11 w-full sm:h-10 sm:w-auto sm:min-w-24">
          Send
        </Button>
      </div>
    </motion.form>
  )
}

function Question({
  q,
  showLabel,
  answer,
  onChange,
  disabled,
}: {
  q: ClarifyQuestion
  showLabel: boolean
  answer: Answer
  onChange: (next: Partial<Answer>) => void
  disabled: boolean
}) {
  const choices = q.choices ?? []
  const labelId = `q-${q.qid}`

  if (!choices.length) {
    return (
      <div>
        {showLabel && (
          <p id={labelId} className="mb-2 text-subhead text-ink">
            {q.question}
          </p>
        )}
        <TextField
          aria-labelledby={showLabel ? labelId : undefined}
          aria-label={showLabel ? undefined : q.question}
          placeholder="Type your answer"
          className="h-11"
          value={answer.other}
          disabled={disabled}
          onChange={(e) => onChange({ other: e.target.value, otherOpen: true })}
        />
      </div>
    )
  }

  const toggle = (c: string) => {
    const on = answer.picked.includes(c)
    if (q.multi) onChange({ picked: on ? answer.picked.filter((p) => p !== c) : [...answer.picked, c] })
    else onChange({ picked: on ? [] : [c], otherOpen: false })
  }

  return (
    <div>
      {showLabel && (
        <p id={labelId} className="mb-2 text-subhead text-ink">
          {q.question}
        </p>
      )}
      <div
        role={q.multi ? 'group' : 'radiogroup'}
        aria-labelledby={showLabel ? labelId : undefined}
        aria-label={showLabel ? undefined : q.question}
        className="flex flex-wrap gap-2"
      >
        {choices.map((c) => (
          <Chip key={c} on={answer.picked.includes(c)} multi={q.multi} disabled={disabled} onClick={() => toggle(c)}>
            {c}
          </Chip>
        ))}
        <Chip
          on={answer.otherOpen}
          multi={q.multi}
          disabled={disabled}
          onClick={() =>
            onChange(q.multi ? { otherOpen: !answer.otherOpen } : { otherOpen: !answer.otherOpen, picked: [] })
          }
        >
          Something else
        </Chip>
      </div>
      {answer.otherOpen && (
        <TextField
          autoFocus
          aria-label="Your answer"
          placeholder="Type your answer"
          className="mt-2 h-11 animate-fade"
          value={answer.other}
          disabled={disabled}
          onChange={(e) => onChange({ other: e.target.value })}
        />
      )}
    </div>
  )
}

function Chip({
  on,
  multi,
  disabled,
  onClick,
  children,
}: {
  on: boolean
  multi?: boolean
  disabled: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        // 36px to look at; the hit area reaches into the 8px gaps for 44.
        'pressable relative inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-left text-subhead leading-5 select-none after:absolute after:-inset-1',
        'disabled:opacity-60',
        on ? 'bg-accent text-accent-ink' : 'bg-fill-2 text-ink hover:bg-fill-3',
      )}
    >
      {multi && on && <Check size={14} strokeWidth={2.5} aria-hidden className="-ml-0.5" />}
      {children}
    </button>
  )
}

function Receipt({ item, fresh }: { item: Item; fresh: boolean }) {
  return (
    <ul className={cn('space-y-0.5', fresh && 'receipt-tint -mx-2 px-2')}>
      {item.questions.map((q) => (
        <li key={q.qid} className="flex h-8 min-w-0 items-center gap-2 text-footnote text-ink-3">
          <Check size={14} strokeWidth={2} aria-hidden className="flex-none text-success" />
          <span className="min-w-0 truncate">{q.question}</span>
          <span aria-hidden>·</span>
          <span className="max-w-[55%] flex-none truncate text-ink-2">{item.answers?.[q.qid] ?? 'Answered'}</span>
        </li>
      ))}
    </ul>
  )
}
