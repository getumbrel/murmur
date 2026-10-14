import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Check, ChevronLeft } from 'lucide-react'
import { AgentFields, canSubmit, type AgentDraft } from '@/features/agents/agent-editor'
import { Button } from '@/ui/button'
import { Sheet } from '@/ui/sheet'
import { Spinner } from '@/ui/spinner'
import { HUES } from '@/lib/hues'
import { useIsWide } from '@/lib/use-media'
import { cn } from '@/lib/cn'
import { TemplateGrid } from './template-grid'
import { slugFor } from '@/state/agents'
import { draftFromTemplate, suggestName, type Template } from './templates'

// Making an agent: pick a starting point, then shape it. The grid fades out and
// the editor rises in, its Buddy first; Back returns to the grid.
// The sheet holds one height throughout so nothing jumps between the two.

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the finished draft; `draft.template` names the template, if any. */
  onSubmit: (draft: AgentDraft) => void
  submitting?: boolean
  /** It exists now: the orb celebrates and the button turns into a tick. */
  born?: boolean
  /** Colour for "Start from scratch" (e.g. one nobody is wearing yet). */
  defaultHue?: number
  /** Names already in use, so a template suggests a fresh one. */
  takenNames?: string[]
  /** Ids already in use: a newcomer's Buddy is seeded with the id it will get. */
  takenIds?: string[]
}

type Stage = { kind: 'pick' } | { kind: 'edit'; from: string }

const blank = (hue: number): AgentDraft => ({ name: '', hue, role: '', personality: 'warm', custom: '' })

export function NewAgentSheet({
  open,
  onOpenChange,
  onSubmit,
  submitting,
  born,
  defaultHue = HUES[0],
  takenNames = [],
  takenIds = [],
}: Props) {
  const wide = useIsWide()
  const formId = useId()
  const body = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Stage>({ kind: 'pick' })
  const [draft, setDraft] = useState<AgentDraft>(() => blank(defaultHue))

  // Start fresh each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStage({ kind: 'pick' })
      setDraft(blank(defaultHue))
    }
  }

  const toTop = () => body.current?.closest('.overflow-y-auto')?.scrollTo({ top: 0 })
  const pick = (t: Template) => {
    toTop()
    setDraft(draftFromTemplate(t, takenNames))
    setStage({ kind: 'edit', from: t.id })
  }
  const scratch = () => {
    toTop()
    setDraft(blank(defaultHue))
    setStage({ kind: 'edit', from: 'scratch' })
  }
  const back = () => {
    toTop()
    setStage({ kind: 'pick' })
  }

  // The card's Buddy is the agent it will make: the suggested name's future id,
  // the same body the editor shows and the roster will keep.
  const seedFor = (t: Template) => slugFor(suggestName(t, takenNames), takenIds)

  const editing = stage.kind === 'edit'
  const name = draft.name.trim()

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="New agent"
      width={wide ? 560 : undefined}
      className={wide ? 'h-[min(660px,calc(100dvh-48px))]' : 'h-[calc(100dvh-env(safe-area-inset-top)-12px)]'}
      footer={
        editing ? (
          <div className="hue-scope animate-fade" style={{ '--hue': draft.hue } as CSSProperties}>
            {/* While Hermes sets it up (it can take a while), the button says so and stays solid. */}
            <Button
              form={formId}
              type="submit"
              size="lg"
              variant="accent"
              disabled={!canSubmit(draft) && !submitting}
              aria-disabled={submitting || born || undefined}
              className={cn((submitting || born) && 'pointer-events-none')}
            >
              {born ? (
                <Check key="born" size={22} strokeWidth={2.5} className="animate-pop" aria-label="Created" />
              ) : submitting ? (
                <SettingUp name={name.length <= 18 ? name : ''} />
              ) : name && name.length <= 18 ? (
                `Create ${name}`
              ) : (
                'Create agent'
              )}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div ref={body} className="relative">
        {/* The stage being left fades quickly while the next one rises in. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {stage.kind === 'pick' ? (
            <motion.div key="pick" exit={{ opacity: 0, transition: { duration: 0.16 } }}>
              <TemplateGrid onPick={pick} onScratch={scratch} seedFor={seedFor} columns={wide ? 3 : 2} />
            </motion.div>
          ) : (
            <motion.div
              key="edit"
              className="hue-scope relative"
              style={{ '--hue': draft.hue } as CSSProperties}
              exit={{ opacity: 0, transition: { duration: 0.14 } }}
            >
              <button
                type="button"
                onClick={back}
                disabled={submitting || born}
                className={cn(
                  'pressable absolute top-1 left-0 z-10 inline-flex h-8 animate-fade items-center gap-0.5 rounded-full bg-fill-2 pr-3 pl-1.5',
                  'text-footnote font-medium text-ink-2 transition-opacity select-none hover:text-ink disabled:opacity-0',
                  // A 44px target around the 32px pill.
                  "before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-['']",
                )}
              >
                <ChevronLeft size={16} strokeWidth={2.25} />
                Templates
              </button>
              <AgentFields
                id={formId}
                draft={draft}
                onChange={setDraft}
                onSubmit={onSubmit}
                entering
                celebrate={born}
                busy={submitting}
                names={takenNames}
                ids={takenIds}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  )
}

/** "Setting up Coder…", then a word of reassurance if Hermes takes its time. */
function SettingUp({ name }: { name: string }) {
  const lines = [`Setting up ${name || 'your agent'}…`, 'This can take a moment…', `Still setting up ${name || 'your agent'}…`]
  const [i, setI] = useState(0)
  useEffect(() => {
    const ids = [setTimeout(() => setI(1), 5000), setTimeout(() => setI(2), 20000)]
    return () => ids.forEach(clearTimeout)
  }, [])
  return (
    <span className="inline-flex items-center gap-2.5" aria-live="polite">
      <Spinner className="flex-none" />
      <span className="relative grid overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={i}
            className="block whitespace-nowrap"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
          >
            {lines[i]}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  )
}
