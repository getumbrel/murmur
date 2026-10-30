import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { X } from 'lucide-react'
import { Orb } from '@/ui/orb'
import { useAgents } from '@/state/agents'
import { useGroupSummaries } from '@/state/groups'
import { useSections } from '@/state/sections'
import { cn } from '@/lib/cn'
import { TEMPLATES } from '@/features/templates/templates'
import { useCanMakeGroups, useGroupRows } from './groups'
import type { Density } from './roster'

// One gentle next step under the roster, so a short list still feels like a
// beginning: a second agent when there's only one, a group once there are
// two, sections once there are too many to take in at a glance. A tap does
// it, the ✕ puts it away for good.

type Kind = 'agent' | 'group' | 'section'

/** About where a list stops fitting on a phone's screen. */
const CROWDED = 7

const KEY = (kind: Kind) => `murmur:tip-dismissed:${kind}`
const wasDismissed = (kind: Kind) => {
  try {
    return localStorage.getItem(KEY(kind)) === '1'
  } catch {
    return false
  }
}

const spring = { type: 'spring', duration: 0.5, bounce: 0.15 } as const

type Props = { density: Density; onNewAgent: () => void; onNewGroup?: () => void; onNewSection?: () => void }

export function Suggestion({ density, onNewAgent, onNewGroup, onNewSection }: Props) {
  const { data: agents } = useAgents()
  const groups = useGroupRows()
  // Until groups have loaded, "Start a group" would claim there are none.
  const groupsLoaded = !useGroupSummaries().isPending
  const canGroup = useCanMakeGroups()
  const sections = useSections()
  const [dismissed, setDismissed] = useState(() => ({
    agent: wasDismissed('agent'),
    group: wasDismissed('group'),
    section: wasDismissed('section'),
  }))

  const kind: Kind | null =
    !agents || !groupsLoaded
      ? null
      : agents.length === 1
        ? 'agent'
        : canGroup && onNewGroup && groups.length === 0 && !dismissed.group
          ? 'group'
          : onNewSection && agents.length >= CROWDED && sections.length === 0
            ? 'section'
            : null
  // A group card put away makes room for the next one.
  const shown = kind && !dismissed[kind] ? kind : null

  const dismiss = (k: Kind) => {
    setDismissed((d) => ({ ...d, [k]: true }))
    try {
      localStorage.setItem(KEY(k), '1')
    } catch {}
  }

  // The roster settles first; then the card arrives.
  const roomy = density === 'roomy'
  const faces =
    shown === 'group' || shown === 'section'
      ? agents!.slice(shown === 'section' ? 1 : 0, shown === 'section' ? 4 : 3).map((a) => ({ id: a.id, hue: a.hue }))
      : [TEMPLATES[0], TEMPLATES[1], TEMPLATES[3]].map((t) => ({ id: t.id, hue: t.hue }))
  const names = agents?.slice(0, 2).map((a) => a.name) ?? []

  return (
    <AnimatePresence mode="wait">
      {shown && (
        <motion.div
          key={shown}
          className={roomy ? 'px-5 pt-6' : 'px-2 pt-4'}
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { ...spring, delay: 0.35 } }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } }}
        >
          <div className="group/tip relative overflow-hidden rounded-2xl bg-fill-1 ring-[0.5px] ring-line ring-inset">
            <button
              type="button"
              onClick={shown === 'group' ? onNewGroup : shown === 'section' ? onNewSection : onNewAgent}
              className={cn(
                'pressable relative block w-full text-left transition-colors hover:bg-fill-1',
                roomy ? 'py-4 pr-30 pl-4' : 'py-3 pr-21 pl-3',
              )}
            >
              <span className={cn('block font-semibold tracking-[-0.015em]', roomy ? 'text-body' : 'text-footnote')}>
                {shown === 'group' ? 'Start a group' : shown === 'section' ? 'Sort your agents' : 'Make another agent'}
              </span>
              <span className={cn('mt-0.5 block text-balance text-ink-2', roomy ? 'text-footnote' : 'text-caption')}>
                {shown === 'group'
                  ? `Bring ${names.join(' and ')} into one chat.`
                  : shown === 'section'
                    ? 'File them under names like Clients or Home, and fold away what can wait.'
                    : 'A researcher, a writer, a coach. Each great at its own thing.'}
              </span>
              <Peek faces={faces} small={!roomy} />
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(shown)}
              className={cn(
                // A small mark with a full 44px target around it.
                'pressable absolute grid place-items-center rounded-full text-ink-3 hover:bg-fill-2 hover:text-ink-2',
                "before:absolute before:-inset-1.5 before:content-['']",
                roomy ? 'top-2 right-2 size-8' : 'top-1 right-1 size-7',
              )}
            >
              <X size={roomy ? 15 : 13} strokeWidth={2.25} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A few orbs huddled at the card's bottom edge, peeking up to say hello. */
function Peek({ faces, small }: { faces: { id: string; hue: number }[]; small?: boolean }) {
  const k = small ? 0.72 : 1
  // Biggest in the middle, in front; the others lean in from either side.
  const spots = [
    { size: 44, left: 24, bottom: -7, z: 3 },
    { size: 32, left: 0, bottom: -9, z: 2 },
    { size: 30, left: 60, bottom: -6, z: 1 },
  ]
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-0"
      style={{ right: 16 * k, width: 90 * k, height: 44 * k }}
    >
      {faces.map((f, i) => {
        const s = spots[i]
        return (
          <motion.span
            key={f.id}
            className="absolute block"
            style={{ left: s.left * k, bottom: s.bottom * k, zIndex: s.z }}
            initial={{ y: 36 * k }}
            animate={{ y: 0 }}
            transition={{ type: 'spring', duration: 0.6, bounce: 0.3, delay: 0.55 + i * 0.08 }}
          >
            <span
              className="block transition-transform duration-300 ease-[var(--ease-out)] group-hover/tip:-translate-y-1"
              style={{ transitionDelay: `${i * 40}ms` }}
            >
              <Orb hue={f.hue} size={Math.round(s.size * k)} seed={f.id} />
            </span>
          </motion.span>
        )
      })}
    </span>
  )
}
