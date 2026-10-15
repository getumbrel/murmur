import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Agent } from '@/state/agents'
import { useRoutines } from '@/state/routines'
import { useMemories } from '@/state/memory'
import { usePairing, useTelegram } from '@/state/telegram'
import { useLinks, useWhatsApp } from '@/state/whatsapp'
import { useAccess } from '@/state/access'
import { Skeleton } from '@/ui/skeleton'
import { IconChip, LookIcon, MemoryIcon, RoutinesIcon } from '@/ui/icons'
import { cn } from '@/lib/cn'
import { TelegramGlyph } from '@/features/telegram'
import { WhatsAppGlyph } from '@/features/whatsapp'
import { AppsGlyph } from '@/features/apps'
import { useAgentApps, useConnections } from '@/state/apps'

// The six things you do with an agent besides talking to it, as tiles that
// each say where things stand: "2 on", "7 saved", "On", or
// "1 waiting" when someone's asking to message it there.

type Props = {
  agent: Agent
  onRoutines: () => void
  onMemory: () => void
  onApps: () => void
  onTelegram: () => void
  onWhatsApp: () => void
  onEdit: () => void
}

export function QuickActions({ agent, onRoutines, onMemory, onApps, onTelegram, onWhatsApp, onEdit }: Props) {
  const routines = useRoutines(agent.id).data
  const memories = useMemories(agent.id)
  const telegram = useTelegram(agent.id)
  const pairing = usePairing(agent.id)?.phase
  const whatsapp = useWhatsApp(agent.id)
  const apps = useAgentApps(agent.id).data
  const appsBusy = useConnections((all) =>
    Object.entries(all).some(([key, c]) => key.startsWith(`${agent.id}\n`) && c.phase !== 'done' && c.phase !== 'failed'),
  )
  const linking = useLinks((s) => s.byAgent[agent.id]?.phase)
  const asking = useAccess(agent.id).data?.pending
  const waiting = (platform: string) => {
    const n = asking?.filter((r) => r.platform === platform).length
    return n ? `${n} waiting` : undefined
  }

  const on = routines?.filter((r) => r.enabled).length ?? 0
  const routineNote = !routines ? undefined : on ? `${on} on` : routines.length ? 'Paused' : 'None yet'
  const memoryNote = memories.isPending
    ? undefined
    : memories.isError
      ? 'Open'
      : memories.data?.length
        ? `${memories.data.length} saved`
        : 'Empty'
  const appsOn = apps?.filter((a) => a.enabled && !a.name.startsWith('umbrel-')) ?? []
  const appsNote = appsBusy ? 'Connecting' : !apps ? undefined : appsOn.length ? `${appsOn.length} on` : apps.length ? 'Off' : 'None yet'
  const live = telegram.data?.state === 'connected'
  const telegramNote =
    pairing === 'waiting' || pairing === 'starting'
      ? 'Waiting'
      : pairing === 'applying' || (!live && telegram.data?.state === 'starting')
        ? 'Connecting'
        : pairing === 'expired' || pairing === 'failed'
          ? 'Didn’t finish'
          : telegram.isPending
            ? undefined
            : live
              ? (waiting('telegram') ?? 'On')
              : 'Off'
  const whatsappLive = whatsapp.data?.state === 'connected'
  const whatsappNote =
    linking === 'starting' || linking === 'installing' || linking === 'waiting'
      ? 'Linking'
      : linking === 'saving' || (!whatsappLive && whatsapp.data?.state === 'starting')
        ? 'Connecting'
        : whatsapp.isPending
          ? undefined
          : whatsappLive
            ? (waiting('whatsapp') ?? 'On')
            : 'Off'

  // Two rows of three on a phone (what it can do, then where you reach it); one row when there's room.
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      <Tile label="Routines" note={routineNote} onClick={onRoutines} icon={<IconChip icon={RoutinesIcon} size={32} radius={10} />} />
      <Tile label="Memory" note={memoryNote} onClick={onMemory} icon={<IconChip icon={MemoryIcon} size={32} radius={10} />} />
      <Tile label="Apps" note={appsNote} onClick={onApps} icon={<AppsGlyph names={appsOn.map((a) => a.name)} />} />
      <Tile
        label="Telegram"
        note={telegramNote}
        live={live}
        onClick={onTelegram}
        icon={
          <TelegramGlyph
            size={32}
            // Its own blue only once it's on; off, a quiet outline of itself like the tiles beside it.
            className={cn(
              '[&_*]:transition-[fill] [&_*]:duration-300',
              !live && '[&_circle]:fill-fill-3 [&_path]:fill-ink-3',
            )}
          />
        }
      />
      <Tile
        label="WhatsApp"
        note={whatsappNote}
        live={whatsappLive}
        onClick={onWhatsApp}
        icon={
          <WhatsAppGlyph
            size={32}
            className={cn(
              '[&_*]:transition-[fill] [&_*]:duration-300',
              !whatsappLive && '[&_circle]:fill-fill-3 [&_path]:fill-ink-3',
            )}
          />
        }
      />
      <Tile label="Edit" note="Name, look" onClick={onEdit} icon={<IconChip icon={LookIcon} size={32} radius={10} />} />
    </div>
  )
}

// A 7px hole around the 10px light (5px radius, 2px ring) at its centre, 3px in from the corner.
const hole = 'radial-gradient(circle at calc(100% - 3px) calc(100% - 3px), transparent 6.5px, #000 7px)'
const cutout: CSSProperties = { maskImage: hole, WebkitMaskImage: hole }

function Tile({
  label,
  note,
  icon,
  live,
  onClick,
}: {
  label: string
  /** Where it stands; undefined while that's loading. */
  note?: string
  icon: ReactNode
  /** A small green light for something switched on and working. */
  live?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={note ? `${label}, ${note}` : label}
      className="pressable flex min-w-0 flex-col items-center rounded-xl bg-fill-1 px-1 pt-3.5 pb-3 select-none hover:bg-fill-2 active:bg-fill-2"
    >
      <span className="relative">
        {/* The light's ring is cut out of the icon, so it's the tile's own colour, hovered or not, in either theme. */}
        <span className="block" style={live ? cutout : undefined}>
          {icon}
        </span>
        {live && <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success" />}
      </span>
      <span className="mt-2 max-w-full truncate text-footnote font-medium tracking-[-0.01em]">{label}</span>
      <span className="relative mt-px flex h-4 max-w-full items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {note ? (
            <motion.span
              key={note}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="block truncate text-caption text-ink-3"
            >
              {note}
            </motion.span>
          ) : (
            <motion.span key="loading" exit={{ opacity: 0, transition: { duration: 0.12 } }} className="flex">
              <Skeleton className="h-2 w-10 rounded-full" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  )
}
