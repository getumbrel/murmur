import { Hand } from 'lucide-react'
import { motion } from 'motion/react'
import type { Group } from '@/state/groups'
import { joinNames } from '@/state/groups'
import { MemberRow } from './member-row'

type Props = {
  group: Group
  listening: string[]
  mentioned: string[]
  onStart: (text: string) => void
}

const PAD = 56

/** A brand-new group: everyone's here, waiting for the first word. */
export function GroupEmpty({ group, listening, mentioned, onStart }: Props) {
  const count = group.members.length
  const size = count <= 3 ? 76 : count === 4 ? 64 : 54
  // A soft glow behind each buddy, in its own colour. The aura box overhangs
  // the row by PAD on every side, so each glow is centred on its buddy's slot.
  const aura = group.members
    .map((m, i) => {
      const x = `calc(${PAD}px + (100% - ${PAD * 2}px) * ${(i + 0.5) / count})`
      const y = `${PAD + size * 0.56}px`
      return `radial-gradient(circle ${Math.round(size * 0.95)}px at ${x} ${y}, oklch(0.7 0.16 ${m.hue} / 0.2), transparent)`
    })
    .join(',')

  return (
    <div className="flex w-full flex-col items-center pb-10 text-center">
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute animate-fade"
          style={{ inset: -PAD, background: aura }}
        />
        {/* Everyone steps up together, standing side by side. */}
        <motion.div
          className="relative origin-bottom"
          initial={{ opacity: 0, y: 10, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', duration: 0.6, bounce: 0.25, delay: 0.06 }}
        >
          <MemberRow members={group.members} size={size} max={6} listening={listening} mentioned={mentioned} />
        </motion.div>
      </div>
      <p className="mt-6 max-w-[21rem] animate-rise text-footnote text-balance text-ink-3 [animation-delay:200ms]">
        {joinNames(group.members.map((m) => m.name))} are here
      </p>
      <h2 className="mt-1 animate-rise text-title font-semibold tracking-[-0.02em] [animation-delay:240ms]">
        Start the conversation
      </h2>
      <p className="mt-1 max-w-[21rem] animate-rise text-subhead text-balance text-ink-2 [animation-delay:280ms]">
        Mention someone with @ to ask just them.
      </p>
      <button
        type="button"
        onClick={() => onStart('Introduce yourselves, one line each.')}
        className="pressable mt-8 flex h-11 animate-rise items-center gap-2 rounded-full bg-fill-1 pr-4 pl-3.5 text-subhead text-ink ring-[0.5px] ring-line ring-inset select-none [animation-delay:340ms] hover:bg-fill-2"
      >
        <Hand size={17} strokeWidth={1.85} aria-hidden className="text-accent" />
        Introduce yourselves
      </button>
    </div>
  )
}
