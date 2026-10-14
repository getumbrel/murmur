import { AnimatePresence, motion } from 'motion/react'
import { useId, useState, type CSSProperties } from 'react'
import { ChevronLeft } from 'lucide-react'
import { AgentFields, canSubmit, type AgentDraft } from '@/features/agents/agent-editor'
import { TemplateGrid } from '@/features/templates/template-grid'
import { draftFromTemplate, type Template } from '@/features/templates/templates'
import { Button } from '@/ui/button'
import { HUES } from '@/lib/hues'
import { cn } from '@/lib/cn'
import { STEP_COLUMN, StepHeader } from './step'

// The last onboarding step: shape the main agent, full screen. It starts the
// way making any agent does, with a few ready-made helpers and a way to start
// from scratch. The grid fades out and the editor rises in, its Buddy first;
// Templates takes you back.

type Props = {
  onSubmit: (draft: AgentDraft) => void
  submitting?: boolean
  onSkip?: () => void
  /** The main agent's id: its Buddy, whatever it's called. */
  seed?: string
  /** The other agents' names, so a template suggests a fresh one. */
  takenNames?: string[]
  /** Ids already in use. */
  takenIds?: string[]
  submitLabel?: string
}

type Stage = { kind: 'pick' } | { kind: 'edit'; from: string }

const blank = (): AgentDraft => ({ name: '', hue: HUES[0], role: '', personality: 'warm', custom: '' })

export function FirstAgent({
  onSubmit,
  submitting,
  onSkip,
  seed = 'default',
  takenNames = [],
  takenIds = [],
  submitLabel = 'Continue',
}: Props) {
  const formId = useId()
  const [stage, setStage] = useState<Stage>({ kind: 'pick' })
  const [draft, setDraft] = useState<AgentDraft>(blank)

  // The editor starts at the top, so the Buddy has somewhere to land.
  const toTop = () => window.scrollTo({ top: 0 })
  const pick = (t: Template) => {
    toTop()
    setDraft(draftFromTemplate(t, takenNames))
    setStage({ kind: 'edit', from: t.id })
  }
  const scratch = () => {
    toTop()
    setDraft(blank())
    setStage({ kind: 'edit', from: 'scratch' })
  }
  const back = () => {
    toTop()
    setStage({ kind: 'pick' })
  }

  return (
    <main className={`relative flex min-h-dvh flex-col safe-top ${STEP_COLUMN}`}>
      <StepHeader
        title="Say hello to your first agent"
        body="Start from a helper, or make your own. You can change anything later."
        onSkip={submitting ? undefined : onSkip}
        className="pb-6 md:pt-16"
      />
      {/* The stage being left fades quickly while the next one rises in. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {stage.kind === 'pick' ? (
          <motion.div
            key="pick"
            className="pb-[max(24px,env(safe-area-inset-bottom))] md:pb-16"
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
          >
            {/* The step's header already says what the grid's own line would. */}
            <TemplateGrid className="[&>p:first-child]:hidden" onPick={pick} onScratch={scratch} columns={2} />
          </motion.div>
        ) : (
          <motion.div
            key="edit"
            className="hue-scope relative flex flex-1 flex-col"
            style={{ '--hue': draft.hue } as CSSProperties}
            exit={{ opacity: 0, transition: { duration: 0.14 } }}
          >
            <button
              type="button"
              onClick={back}
              disabled={submitting}
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
              busy={submitting}
              seed={seed}
              names={takenNames}
              ids={takenIds}
            />
            {/* Solid under the button, fading out above it, over the fields it scrolls past. */}
            <div className="sticky bottom-0 z-10 mt-auto animate-fade bg-[linear-gradient(to_top,var(--bg)_calc(100%-24px),transparent)] pt-6 pb-[max(16px,env(safe-area-inset-bottom))] md:pb-8">
              <Button
                form={formId}
                type="submit"
                size="lg"
                variant="accent"
                loading={submitting}
                disabled={!canSubmit(draft)}
              >
                {submitLabel}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}
