import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { useLocation } from 'wouter'
import { Buddy, BuddyStack } from '@/ui/buddy'
import { useAgents } from '@/state/agents'
import { useChats } from '@/state/chats'
import { useGroupLive, useGroupSummaries } from '@/state/groups'
import { useNeedsYou, useUnreadCount } from '@/state/status'

// Inside a chat, the rest of Murmur is out of sight. Two quiet signals keep it
// in mind, the way Messages does: the back chevron counts the chats that moved
// since you looked (with an amber dot when an agent is waiting on you), and a
// small toast drops in the moment another agent or group starts waiting.

type Waiting = {
  /** Unique per request, so each one is announced once. */
  key: string
  href: string
  name: string
  hue: number
  seed: string
  /** A group's faces, instead of one buddy. */
  group?: { hues: number[]; seeds: string[] }
  ask: 'approval' | 'question' | 'unknown'
}

/** Agents and groups waiting on you, other than the chat on screen. */
function useWaitingElsewhere(chatId: string | undefined): Waiting[] {
  const agents = useAgents().data
  const groups = useGroupSummaries().data
  const needs = useNeedsYou()
  // Groups only know about approvals while they're being watched (recently open).
  const groupAsks = useGroupLive(
    useShallow((s) =>
      Object.entries(s.rooms).flatMap(([id, room]) =>
        room.approvals.filter((a) => a.status === 'pending').map((a) => `${id}|${a.requestId}`),
      ),
    ),
  )
  return useMemo(() => {
    const { chats } = useChats.getState()
    const out: Waiting[] = []
    for (const n of needs) {
      if (n.chatId === chatId) continue
      const agent = agents?.find((a) => a.id === n.agentId)
      if (!agent) continue
      const pending = chats[n.chatId]?.items.findLast(
        (i) => (i.kind === 'approval' || i.kind === 'clarify') && i.status === 'pending',
      )
      out.push({
        key: `${n.chatId}:${pending && 'requestId' in pending ? pending.requestId : n.text}`,
        href: `/chat/${agent.id}/${n.chatId}`,
        name: agent.name,
        hue: agent.hue,
        seed: agent.id,
        ask: pending?.kind === 'approval' ? 'approval' : pending?.kind === 'clarify' ? 'question' : 'unknown',
      })
    }
    for (const entry of groupAsks) {
      const [id, requestId] = entry.split('|')
      const group = groups?.find((g) => g.id === id)
      if (!group) continue
      out.push({
        key: `${id}:${requestId}`,
        href: `/group/${id}`,
        name: group.name,
        hue: group.memberHues[0] ?? 278,
        seed: group.memberIds[0] ?? id,
        group: { hues: group.memberHues, seeds: group.memberIds },
        ask: 'approval',
      })
    }
    return out
  }, [needs, groupAsks, agents, groups, chatId])
}

/**
 * What the back chevron carries: chats that moved elsewhere, and whether
 * anyone is waiting. It counts only what the page Back leads to shows: all of
 * Home, or (`agentId`) just that agent's page. Arrivals are announced either way.
 */
export function useElsewhere(chatId: string | undefined, agentId?: string) {
  const agents = useAgents().data
  const groups = useGroupSummaries().data
  // (Hermes only says when each agent's newest chat moved, as the roster shows it.)
  const latest = useMemo(
    () =>
      (agents ?? []).flatMap((a) =>
        a.lastChat && a.lastChat.id !== chatId && (!agentId || a.id === agentId)
          ? [{ id: a.lastChat.id, at: a.lastChat.at }]
          : [],
      ),
    [agents, chatId, agentId],
  )
  const groupsUnread = agentId ? 0 : (groups?.filter((g) => g.unread && !g.live).length ?? 0)
  const unread = useUnreadCount(latest) + groupsUnread
  const waiting = useWaitingElsewhere(chatId)
  useAnnounce(waiting)
  const there = agentId ? waiting.filter((w) => w.href.startsWith(`/chat/${agentId}/`)) : waiting
  return { unread, waiting: there.length > 0 }
}

// Announced requests, across chats: moving from one chat to another never repeats one.
const announced = new Set<string>()

const TITLE: Record<Waiting['ask'], string> = {
  approval: 'needs your OK',
  question: 'has a question',
  unknown: 'needs you',
}

/** A toast the moment someone new starts waiting. What was already waiting is left to the dot. */
function useAnnounce(waiting: Waiting[]) {
  const [, navigate] = useLocation()
  const go = useRef(navigate)
  go.current = navigate
  const primed = useRef(false)
  useEffect(() => {
    const now = new Set(waiting.map((w) => w.key))
    // Answered ones can be announced again if they come back.
    for (const key of announced) if (!now.has(key)) announced.delete(key)
    const fresh = waiting.filter((w) => !announced.has(w.key))
    fresh.forEach((w) => announced.add(w.key))
    if (!primed.current) {
      primed.current = true
      return
    }
    for (const w of fresh) {
      toast(`${w.name} ${TITLE[w.ask]}`, {
        id: `needs-${w.key}`,
        duration: 5000,
        icon: w.group ? (
          <BuddyStack hues={w.group.hues} seeds={w.group.seeds} size={20} />
        ) : (
          <Buddy hue={w.hue} size={20} seed={w.seed} state="waiting" />
        ),
        action: { label: 'View', onClick: () => go.current(w.href) },
        // The button takes the colour of whoever is asking.
        className: 'murmur-toast hue-scope',
        style: { '--hue': w.hue } as CSSProperties,
      })
    }
  }, [waiting])
}

/**
 * The count beside the back chevron, iOS Messages style, and an amber dot
 * when another agent is waiting on you.
 */
export function BackBadge({ unread, waiting }: { unread: number; waiting: boolean }) {
  const label = unread > 99 ? '99+' : String(unread)
  return (
    <span className="relative -ml-1 flex h-5 items-center">
      <AnimatePresence initial={false}>
        {unread > 0 && (
          <motion.span
            key="count"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', duration: 0.36, bounce: 0.25 }}
            className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-caption leading-none font-semibold text-accent-ink tabular-nums"
          >
            {/* A new count swaps in place: no motion on a number that ticks. */}
            {label}
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {waiting && (
          <motion.span
            key="dot"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.4, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', duration: 0.36, bounce: 0.3 }}
            className={
              unread > 0
                ? 'absolute -top-1 -right-1 size-2.5 rounded-full bg-warning ring-2 ring-bg'
                : 'size-2.5 rounded-full bg-warning'
            }
          />
        )}
      </AnimatePresence>
    </span>
  )
}

export function backHint(unread: number, waiting: boolean) {
  const parts = [unread ? `${unread} unread` : '', waiting ? 'someone needs you' : ''].filter(Boolean)
  return parts.length ? `, ${parts.join(', ')}` : ''
}
