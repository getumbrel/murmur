import { useEffect, useRef } from 'react'
import { animate, useReducedMotion } from 'motion/react'
import { BuddyRow, type BuddyState } from '@/ui/buddy'
import { cn } from '@/lib/cn'
import type { Speaker } from '@/features/chat/types'

// The group's buddies, standing side by side (BuddyRow). Whoever has the
// floor perks up and the others lean in and look at them. Someone you
// @mention hops, like a head turning toward you; while you write, whoever
// you're addressing glances down to listen.

type Props = {
  members: Speaker[]
  size: number
  /** Who's talking, and how. */
  active?: { id: string; state: BuddyState }
  /** Members paying attention to what you're typing. */
  listening?: string[]
  /** Members just @mentioned: each new one gets a hop. */
  mentioned?: string[]
  /** At most this many buddies; the rest become "+n". */
  max?: number
  className?: string
}

export function MemberRow({ members, size, active, listening = [], mentioned = [], max = 4, className }: Props) {
  const shown = pick(members, max, active?.id)
  const extra = members.length - shown.length
  const speaking = active ? shown.findIndex((m) => m.id === active.id) : -1
  const reduce = useReducedMotion()
  const row = useRef<HTMLSpanElement>(null)
  const was = useRef(mentioned)

  useEffect(() => {
    const fresh = mentioned.filter((id) => !was.current.includes(id))
    was.current = mentioned
    if (reduce || !row.current) return
    for (const id of fresh) {
      const slot = row.current.querySelector(`[data-seed="${CSS.escape(id)}"]`)
      if (slot) void animate(slot, { y: [0, -size * 0.16, 0] }, { duration: 0.46, ease: [0.34, 1.4, 0.64, 1] })
    }
    // A new mention is a change in who, not in the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentioned.join(), reduce, size])

  return (
    <span ref={row} className={cn('flex flex-none items-center', className)}>
      <BuddyRow
        size={size}
        speaking={speaking >= 0 ? speaking : undefined}
        members={shown.map((m) => ({
          hue: m.hue,
          seed: m.id,
          state: m.id === active?.id ? active.state : listening.includes(m.id) ? 'listening' : undefined,
        }))}
      />
      {extra > 0 && (
        <span
          className="ml-0.5 grid h-5 min-w-5 flex-none place-items-center self-end rounded-full bg-fill-2 px-1.5 text-caption font-semibold text-ink-2 tabular-nums"
          style={{ marginBottom: size * 0.06 }}
          aria-hidden
        >
          +{extra}
        </span>
      )}
    </span>
  )
}

/** Faces to show: roster order, but whoever is talking is never hidden. */
function pick(members: Speaker[], max: number, activeId?: string) {
  if (members.length <= max) return members
  const room = max - 1
  const head = members.slice(0, room)
  if (!activeId || head.some((m) => m.id === activeId)) return head
  const speaker = members.find((m) => m.id === activeId)
  return speaker ? [...head.slice(0, room - 1), speaker] : head
}
