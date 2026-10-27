import type { CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, Ellipsis } from 'lucide-react'
import { Link } from 'wouter'
import { IconButton } from '@/ui/button'
import type { BuddyState } from '@/ui/buddy'
import { cn } from '@/lib/cn'
import { joinNames } from '@shared/groups.ts'
import type { Group, GroupActivity } from '@/state/groups'
import { WindowControlsGap } from '@/ui/titlebar'
import { MemberRow } from './member-row'

type Props = {
  group?: Group
  active?: GroupActivity
  working: boolean
  /** Stop was pressed; the round is winding down. */
  stopping?: boolean
  /** While you type: who's listening (everyone, or just who you mentioned). */
  listening: string[]
  mentioned: string[]
  showBack: boolean
  /** Messages are scrolled beneath it: frost it and draw the edge. */
  scrolled: boolean
  onOpen: () => void
}

const ORB_STATE: Record<GroupActivity['phase'], BuddyState> = {
  thinking: 'thinking',
  working: 'working',
  replying: 'speaking',
  waiting: 'waiting',
}

export function subtitleFor(
  group: Group | undefined,
  active: GroupActivity | undefined,
  working: boolean,
  mentioned: string[] = [],
  stopping = false,
) {
  if (stopping) return 'Stopping…'
  if (active) {
    const name = active.member.name
    switch (active.phase) {
      case 'waiting':
        return `${name} needs your OK`
      case 'working':
        return `${name} is ${lowerFirst(active.label ?? 'working')}`
      case 'replying':
        return `${name} is replying…`
      case 'thinking':
        return `${name} is thinking…`
    }
  }
  if (working) return 'Talking it over…'
  const count = group?.members.length ?? 0
  // Writing to some of them: say who.
  const asking = group?.members.filter((m) => mentioned.includes(m.id)) ?? []
  if (asking.length && asking.length < count) return `To ${joinNames(asking.map((m) => m.name))}`
  return count ? `${count} agents` : ' '
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export function GroupHeader({
  group,
  active,
  working,
  stopping,
  listening,
  mentioned,
  showBack,
  scrolled,
  onOpen,
}: Props) {
  const subtitle = subtitleFor(group, active, working, mentioned, stopping)
  const live = Boolean(active) || (working && !stopping)
  // The line takes the colour of whoever it's about.
  const addressed = !live && mentioned.length === 1 ? group?.members.find((m) => m.id === mentioned[0]) : undefined
  const hue = active?.member.hue ?? addressed?.hue

  return (
    // Floats over the thread like a one-to-one chat's: glass and an edge only
    // once messages scroll beneath it, and the same column as the thread.
    <header className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20 @container">
      <div
        aria-hidden
        className={cn(
          'glass absolute inset-x-0 top-0 h-[calc(3.5rem+env(safe-area-inset-top))] hairline-b transition-opacity duration-300 desktop:h-(--titlebar-h)',
          !scrolled && 'opacity-0',
        )}
      />
      {/* The same bar as a one-to-one chat's (chat-header.tsx), to the pixel:
          the chevron's stroke and the ellipsis' last dot land on the thread's
          16px (24px) margins, so moving between a chat and a group, nothing
          in the bar shifts. The buttons keep their full 44px. */}
      <div
        className={cn(
          'pointer-events-auto relative mx-auto flex h-14 max-w-[736px] items-center gap-1 pr-0 sm:pr-2 desktop:h-(--titlebar-h)',
          showBack ? 'pl-0 sm:pl-2' : 'pl-2',
        )}
      >
        <WindowControlsGap side="start" column={736} flexGap={4} />
        {showBack && (
          <Link
            href="/"
            aria-label="All agents"
            className="pressable relative z-10 -mr-2.5 flex size-11 flex-none items-center rounded-full pl-1.5 text-accent hover:bg-fill-1"
          >
            <ChevronLeft size={26} strokeWidth={2} aria-hidden />
          </Link>
        )}

        <button
          type="button"
          onClick={onOpen}
          disabled={!group}
          className={cn(
            // In the desktop app it hugs the name, so the rest of the bar drags the window.
            'pressable flex min-w-0 flex-1 items-center gap-2.5 rounded-full py-1 pr-3 text-left select-none desktop:flex-initial',
            !showBack && 'pl-2.5',
          )}
          title={group?.name}
        >
          {group ? (
            <span className="flex flex-none">
              <MemberRow
                members={group.members}
                size={34}
                max={4}
                active={active ? { id: active.member.id, state: ORB_STATE[active.phase] } : undefined}
                listening={listening}
                mentioned={mentioned}
              />
            </span>
          ) : (
            <span className="h-[34px] w-16 flex-none rounded-full bg-fill-2" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-subhead leading-5 font-semibold tracking-[-0.01em]">
              {group?.name ?? ' '}
            </span>
            <span className="relative block h-4 overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={subtitle}
                  // Same roll as a one-to-one chat's line; leaving is quicker than arriving.
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    'block truncate text-caption',
                    live || addressed ? 'hue-scope text-accent' : 'text-ink-3',
                  )}
                  style={hue !== undefined ? ({ '--hue': hue } as CSSProperties) : undefined}
                >
                  {subtitle}
                </motion.span>
              </AnimatePresence>
            </span>
          </span>
        </button>

        <span aria-hidden className="hidden flex-1 desktop:block" />
        <IconButton size="lg" label="Group info" onClick={onOpen} disabled={!group}>
          <Ellipsis size={20} strokeWidth={2.25} aria-hidden />
        </IconButton>
        <WindowControlsGap side="end" column={736} flexGap={4} />
      </div>
    </header>
  )
}
