import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { ModelSheet } from './model-sheet'
import { prettyModel, thinkingLabel, thinkingOf, type Thinking } from './names'
import { useModelOptions, useThinkingDefault, type ModelPick } from './use-models'

type Props = {
  agent: { id: string; name: string; hue: number }
  pick?: ModelPick
  effort?: string
  onPick: (pick: ModelPick) => void
  onThinking: (thinking: Thinking) => void
  /** Control the sheet from outside (e.g. the /model command). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** "GPT‑6.1 Sol · Deep" in the composer; opens the model sheet. */
export function ModelChip({ agent, pick, effort, onPick, onThinking, open: shown, onOpenChange }: Props) {
  const [own, setOwn] = useState(false)
  const open = shown ?? own
  const setOpen = onOpenChange ?? setOwn
  const fallback = useModelOptions(agent.id).data?.current
  const thinking = thinkingOf(effort, useThinkingDefault(agent.id).data)
  const model = (pick ?? fallback)?.model

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Model: ${prettyModel(model)}${thinking === 'auto' ? '' : `, ${thinkingLabel(thinking)} thinking`}`}
        className="pressable relative flex h-9 min-w-0 items-center gap-1 rounded-full pr-2.5 pl-2.5 text-footnote select-none font-medium text-ink-2 after:absolute after:-inset-y-1 after:inset-x-0 hover:bg-fill-2 hover:text-ink"
      >
        <Morph id={`${model}:${thinking}`}>
          <span className="truncate">{model ? prettyModel(model) : 'Model'}</span>
          {thinking !== 'auto' && (
            <span className="flex-none text-ink-3">
              <span aria-hidden> · </span>
              {thinkingLabel(thinking)}
            </span>
          )}
        </Morph>
        <ChevronDown size={14} strokeWidth={2.25} aria-hidden className="flex-none text-ink-3" />
      </button>
      <ModelSheet
        open={open}
        onOpenChange={setOpen}
        agent={agent}
        pick={pick}
        effort={effort}
        onPick={onPick}
        onThinking={onThinking}
      />
    </>
  )
}

const ease = [0.16, 1, 0.3, 1] as const

/** A label that changes by rolling: the old words slide up and away as the new ones rise in, and the chip eases to its new width. */
function Morph({ id, children }: { id: string; children: ReactNode }) {
  const reduce = useReducedMotion()
  const inner = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number | 'auto'>('auto')
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.offsetWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <motion.span
      initial={false}
      animate={{ width }}
      transition={reduce ? { duration: 0 } : { duration: 0.2, ease }}
      className="relative flex min-w-0 overflow-hidden"
    >
      <span ref={inner} className="relative flex flex-none">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={id}
            className="flex min-w-0 gap-1 whitespace-nowrap"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease }}
          >
            {children}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.span>
  )
}
