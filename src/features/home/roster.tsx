import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'wouter'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  FolderInput,
  FolderOutput,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  PencilLine,
  Plus,
  Trash2,
} from 'lucide-react'
import { Orb, OrbStack } from '@/ui/orb'
import { Buddy, BuddyStack } from '@/ui/buddy'
import { Button } from '@/ui/button'
import { fetchAgentChats, useAgentChats, useAgents, type Agent } from '@/state/agents'
import { settledAt, useAgentStatus, useBusyAgents, useChatUnread, useNeedsYou, useUnreadCount } from '@/state/status'
import { sectionOf, setFolded, useFoldedMap, type Section } from '@/state/sections'
import { prefetchGroup, useGroupSummaries } from '@/state/groups'
import { useAccessRequests } from '@/state/access'
import { RequestCard } from '@/features/access/request-card'
import { cn } from '@/lib/cn'
import { useGroupRows, type GroupRow } from './groups'
import { shortTime } from './time'
import { Bone } from './bone'
import { RowMenu, useLongPress, type MenuItem } from './row-menu'
import type { SectionActions } from './actions'
import { setExpanded, useExpanded } from './expanded'
import { NestedChats, useShowsChat } from './nested-chats'

// The roster: one row per agent and per group, newest activity first.
// Roomy rows for the phone home screen, compact ones for the sidebar.

export type Density = 'roomy' | 'compact'

const spring = { type: 'spring', stiffness: 420, damping: 40 } as const
const ease = [0.16, 1, 0.3, 1] as const

type RosterProps = {
  density: Density
  /** An agent id, or `group:<id>`. */
  selectedId?: string
  /** The chat open beside the sidebar: its agent's latest chats show beneath its row, this one highlighted. */
  openChatId?: string
  onEdit: (agent: Agent) => void
  onDelete: (agent: Agent) => void
  onRenameGroup: (group: GroupRow) => void
  onDeleteGroup: (group: GroupRow) => void
  /** Sections, and what can be done with them; without it the list stays one list. */
  sections?: SectionActions
}

type Entry = { key: string; at: number } & ({ kind: 'agent'; agent: Agent } | { kind: 'group'; group: GroupRow })

export function Roster({
  density,
  selectedId,
  openChatId,
  onEdit,
  onDelete,
  onRenameGroup,
  onDeleteGroup,
  sections: shelves,
}: RosterProps) {
  const { data: agents, isPending, isError, refetch, isRefetching } = useAgents()
  const groups = useGroupRows()
  const groupsLoaded = !useGroupSummaries().isPending
  const busy = useBusyAgents()
  const folded = useFoldedMap()
  // Dragging a row onto a section files it there (wide screens; phones hold a row for its menu).
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  // Folded sections a drag sprang open on its way: they fold again unless it lands in one.
  const sprung = useRef<string[]>([])
  useTick(30_000)

  if (isPending) return <RosterSkeleton density={density} />
  if (isError || !agents) {
    return (
      <div
        className={cn(
          'flex animate-rise flex-col items-center text-center',
          density === 'roomy' ? 'px-10 pt-16' : 'px-4 pt-10',
        )}
      >
        <Orb hue={278} size={density === 'roomy' ? 52 : 40} state="offline" seed="murmur" />
        <p className={cn('mt-4 font-semibold tracking-[-0.015em]', density === 'roomy' ? 'text-body' : 'text-subhead')}>
          Can’t reach Hermes
        </p>
        <p
          className={cn(
            'mt-1 max-w-72 text-balance text-ink-2',
            density === 'roomy' ? 'text-subhead' : 'text-footnote',
          )}
        >
          Check that it’s running, then try again.
        </p>
        <Button variant="secondary" size="sm" className="mt-5" loading={isRefetching} onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  // Most recent conversation first (an agent at work stays where it was until
  // it replies, and a brand-new one counts from its birth); the main agent wins ties.
  const now = Date.now()
  // Wait for groups too, or ones that were always there would read as new.
  if (groupsLoaded) noteArrivals([...agents.map((a) => a.id), ...groups.map((g) => `group:${g.id}`)])
  const entries: Entry[] = [
    ...agents.map((agent) => ({
      kind: 'agent' as const,
      key: agent.id,
      agent,
      at: agentAt(agent, busy),
    })),
    ...groups.map((group) => ({
      kind: 'group' as const,
      key: `group:${group.id}`,
      group,
      at: group.live ? now : group.at,
    })),
  ].sort((a, b) => b.at - a.at || Number(isMain(b)) - Number(isMain(a)))

  // With sections: the agents on none first, as the list always was, then each
  // section under its name, everyone in it still newest first.
  const sections = shelves?.sections ?? []
  const listed = new Set(sections.map((sec) => sec.id))
  const placeOf = (e: Entry) => {
    const id = e.kind === 'agent' ? sectionOf(e.agent) : sections.find((sec) => sec.groups?.includes(e.group.id))?.id
    return id && listed.has(id) ? id : LOOSE
  }
  const items: Item[] = entries.filter((e) => placeOf(e) === LOOSE).map((e) => ({ ...e, place: LOOSE }))
  // Everything filed: a row carried out of its section needs somewhere to land, so the top makes room.
  const carried = dragging ? entries.find((e) => e.key === dragging) : undefined
  const from = carried && sections.find((sec) => sec.id === placeOf(carried))
  if (from && !items.length) items.push({ kind: 'out', key: 'out', from, place: LOOSE })
  for (const section of sections) {
    const members = entries.filter((e) => placeOf(e) === section.id)
    items.push({ kind: 'section', key: `section:${section.id}`, section, members, place: section.id })
    // Folded, it still shows the one that's open beside it, so you never lose your place.
    const shown = members.filter((e) => !folded[section.id] || e.key === selectedId)
    if (!members.length && !folded[section.id])
      items.push({ kind: 'empty', key: `empty:${section.id}`, place: section.id })
    items.push(...shown.map((e) => ({ ...e, place: section.id })))
  }
  const rows = items.filter((it): it is Entry & { place: string } => it.kind === 'agent' || it.kind === 'group')
  const draggable = density === 'compact' && sections.length > 0 && !!shelves
  const keyOf = (key: string) => (key.startsWith('group:') ? { group: key.slice('group:'.length) } : { agent: key })
  const springOpen = (id: string) => {
    sprung.current.push(id)
    setFolded(id, false)
  }
  const refold = (keep?: string) => {
    for (const id of sprung.current) if (id !== keep) setFolded(id, true)
    sprung.current = []
  }
  const drop = (place: string) => {
    const row = rows.find((r) => r.key === dragging)
    setDragging(null)
    setOver(null)
    refold(place)
    if (!row || !shelves || row.place === place) return
    void shelves.file(keyOf(row.key), place === LOOSE ? null : sections.find((sec) => sec.id === place)!)
  }
  // An empty section says how to fill it, the way this screen moves things.
  const things = groups.length ? 'an agent or group' : 'an agent'
  const moveItem = (e: Entry & { place: string }): MenuItem => {
    const item = keyOf(e.key)
    if (!sections.length) {
      return {
        label: 'New section…',
        icon: <FolderPlus size={18} strokeWidth={1.85} />,
        onSelect: () => shelves!.create(item),
      }
    }
    const here = sections.find((sec) => sec.id === e.place)
    return {
      label: 'Move to section',
      icon: <FolderInput size={18} strokeWidth={1.85} />,
      submenu: {
        title: 'Move to',
        items: [
          ...sections.map((sec) => ({
            key: sec.id,
            label: sec.name,
            current: sec.id === e.place,
            icon:
              sec.id === e.place ? (
                <Check size={18} strokeWidth={2.25} />
              ) : (
                <Faces members={entries.filter((x) => placeOf(x) === sec.id)} size={18} max={3} />
              ),
            onSelect: () => void shelves!.file(item, sec),
          })),
          {
            label: 'New section…',
            icon: <Plus size={18} strokeWidth={1.85} />,
            divider: true,
            onSelect: () => shelves!.create(item),
          },
          ...(here
            ? [
                {
                  label: `Take out of ${here.name}`,
                  icon: <FolderOutput size={18} strokeWidth={1.85} />,
                  onSelect: () => void shelves!.file(item, null),
                },
              ]
            : []),
        ],
      },
    }
  }

  return (
    <ul
      className={cn(density === 'compact' && 'space-y-px px-2')}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((entry, i) => {
          const next = items[i + 1]
          const last = !next || next.kind === 'section'
          // The section a dragged row would land on lights up, its header and its rows.
          const lit = !!dragging && over === entry.place && rows.find((r) => r.key === dragging)?.place !== entry.place
          // Arrivals are births: a little lift. Rows a section unfolds (or a drag makes room for) just appear.
          const born = entry.kind === 'section' || arriving(entry.key)
          return (
            <motion.li
              key={entry.key}
              layout="position"
              // Opaque and stacked by rank, so a row climbing the list slides over the ones it passes;
              // a newcomer sits underneath, revealed as the rows part for it.
              className="relative bg-bg"
              style={{
                zIndex: arriving(entry.key) ? 0 : items.length - i,
                // One lit shape: the header's pill runs on down through its rows, the hairlines between them filled in.
                ...(lit &&
                  entry.kind !== 'out' && {
                    background:
                      entry.kind === 'section'
                        ? 'linear-gradient(to top, var(--accent-soft) 1px, transparent 1px), var(--bg)'
                        : 'linear-gradient(var(--accent-soft), var(--accent-soft)), var(--bg)',
                    ...(entry.kind !== 'section' && { borderRadius: last ? '0 0 8px 8px' : 0 }),
                    ...(!last && { marginBottom: 0, paddingBottom: 1 }),
                  }),
              }}
              // Reorders glide.
              transition={
                born
                  ? { type: 'spring', duration: 0.55, bounce: 0.22, layout: spring }
                  : { duration: 0.2, ease, layout: spring }
              }
              initial={born ? { opacity: 0, scale: 0.95, y: -8 } : { opacity: 0 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
            >
              <div
                // The row being carried stays behind as a ghost of itself.
                className={cn('transition-opacity duration-150', dragging === entry.key && 'opacity-35')}
                {...(draggable && {
                  onDragStart: (e: React.DragEvent) => {
                    if (entry.kind !== 'agent' && entry.kind !== 'group') return
                    // The row itself, not a chat listed under it (that's a link of its own to drag).
                    const row = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-nav]')
                    if (!row?.contains(e.target as Node)) return
                    e.dataTransfer.setData(DRAG_TYPE, entry.key)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setDragImage(row, 32, row.offsetHeight / 2)
                    setDragging(entry.key)
                  },
                  onDragOver: (e: React.DragEvent) => {
                    if (!dragging) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (over !== entry.place) setOver(entry.place)
                  },
                  onDrop: (e: React.DragEvent) => {
                    e.preventDefault()
                    drop(entry.place)
                  },
                  onDragEnd: () => {
                    setDragging(null)
                    setOver(null)
                    refold()
                  },
                })}
              >
                {entry.kind === 'section' ? (
                  <SectionHead
                    section={entry.section}
                    members={entry.members}
                    density={density}
                    folded={!!folded[entry.section.id]}
                    lit={lit}
                    first={i === 0}
                    shelves={shelves!}
                    onSpring={() => springOpen(entry.section.id)}
                  />
                ) : entry.kind === 'empty' ? (
                  <p
                    className={cn(
                      'text-ink-3',
                      density === 'roomy' ? 'px-5 pb-2 text-footnote' : 'px-4 pt-0.5 pb-2 text-caption',
                    )}
                  >
                    {/* Touch holds a row for its menu; a mouse drags it in the sidebar, or right-clicks it on a narrow window. */}
                    <span className="[@media(pointer:coarse)]:hidden">
                      {density === 'roomy' ? `Right-click ${things} to move it here.` : `Drag ${things} here.`}
                    </span>
                    <span className="hidden [@media(pointer:coarse)]:inline">Hold {things} to move it here.</span>
                  </p>
                ) : entry.kind === 'out' ? (
                  <p
                    className={cn(
                      'my-0.5 flex h-10 items-center gap-2.5 rounded-lg border-[1.5px] border-dashed px-3 text-footnote',
                      'transition-colors duration-150',
                      lit ? 'border-transparent bg-accent-soft text-accent' : 'border-line-strong text-ink-3',
                    )}
                  >
                    <FolderOutput size={16} strokeWidth={1.85} aria-hidden className="flex-none" />
                    <span className="truncate">Take out of {entry.from.name}</span>
                  </p>
                ) : entry.kind === 'agent' ? (
                  <AgentRow
                    agent={entry.agent}
                    density={density}
                    selected={entry.key === selectedId}
                    openChatId={entry.key === selectedId ? openChatId : undefined}
                    alone={entries.length === 1}
                    last={last}
                    fresh={freshArrival(entry.key)}
                    onEdit={() => onEdit(entry.agent)}
                    onDelete={entry.agent.isDefault ? undefined : () => onDelete(entry.agent)}
                    move={shelves && entries.length > 1 ? moveItem(entry) : undefined}
                  />
                ) : (
                  <GroupRowView
                    group={entry.group}
                    density={density}
                    selected={entry.key === selectedId}
                    last={last}
                    fresh={freshArrival(entry.key)}
                    onRename={() => onRenameGroup(entry.group)}
                    onDelete={() => onDeleteGroup(entry.group)}
                    move={shelves ? moveItem(entry) : undefined}
                  />
                )}
              </div>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}

const LOOSE = 'loose'
/** Its own type, so a row dropped on the composer is not a valid payload there. */
const DRAG_TYPE = 'application/x-murmur-roster-row'

type Item =
  | (Entry & { place: string })
  | { kind: 'section'; key: string; section: Section; members: Entry[]; place: string }
  | { kind: 'empty'; key: string; place: string }
  /** While a row is carried and nothing is loose: drop it here for no section. */
  | { kind: 'out'; key: string; from: Section; place: string }

const isMain = (e: Entry) => e.kind === 'agent' && e.agent.isDefault

/** When an agent last had its say, for ordering: held while it's at work, so it moves when the reply lands. */
export const agentAt = (agent: Agent, busy: string[]) =>
  settledAt(
    `agent:${agent.id}`,
    Math.max(agent.lastChat?.at ?? 0, Number(agent.botMeta?.created) || 0),
    busy.includes(agent.id),
  )

// ── Arrivals ────────────────────────────────────────────────────────────────
// Someone new in the roster (made here or in another app) gets a one-time
// halo. Kept outside React so it survives the phone leaving Home and coming
// back: the new row still greets you on return.

const known = new Set<string>()
const arrivedAt = new Map<string, number>()
const greeted = new Set<string>()
let primed = false

/** Notes who's in the roster; anyone not seen before arrives with a halo. */
export function noteArrivals(keys: string[]) {
  if (!primed) {
    keys.forEach((k) => known.add(k))
    primed = true
    return
  }
  for (const k of keys) {
    if (known.has(k)) continue
    known.add(k)
    arrivedAt.set(k, Date.now())
  }
}

const arriving = (key: string) => Date.now() - (arrivedAt.get(key) ?? 0) < 1500
const freshArrival = (key: string) => !greeted.has(key) && Date.now() - (arrivedAt.get(key) ?? 0) < 90_000

/** A soft ring that blooms once around a newcomer's orb. */
function Halo({ id }: { id: string }) {
  useEffect(() => {
    greeted.add(id)
  }, [id])
  return (
    // Its own presence, so it blooms even in a roster that's just appeared
    // (whose rows skip their entrance), as when a second agent ends Home's solo.
    <AnimatePresence>
      {[0, 1].map((n) => (
        <motion.span
          key={n}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-accent"
          initial={{ scale: 0.92, opacity: 0.7 }}
          animate={{ scale: 1.75, opacity: 0 }}
          transition={{ duration: 1.1, ease, delay: 0.25 + n * 0.22 }}
        />
      ))}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -inset-3 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: [0, 1, 0], scale: [0.8, 1.25, 1.4] }}
        transition={{ duration: 1.4, ease, delay: 0.2, times: [0, 0.35, 1] }}
      />
    </AnimatePresence>
  )
}

// ── Rows ────────────────────────────────────────────────────────────────────

type Shared = { density: Density; selected?: boolean; last?: boolean; fresh?: boolean }

function AgentRow({
  agent,
  density,
  selected,
  openChatId,
  alone,
  last,
  fresh,
  onEdit,
  onDelete,
  move,
}: Shared & {
  agent: Agent
  openChatId?: string
  alone?: boolean
  onEdit: () => void
  onDelete?: () => void
  move?: MenuItem
}) {
  const status = useAgentStatus(agent.id)
  const [menu, setMenu] = useState(false)
  const press = useLongPress(() => setMenu(true))
  const [halo] = useState(fresh)
  const roomy = density === 'roomy'
  // The sidebar's agents fold open to their latest chats (the one you're in opens itself).
  const expanded = useExpanded(agent.id, !!selected) && !roomy
  const chatsId = useId()
  const qc = useQueryClient()
  const warm = () => void qc.prefetchQuery({ queryKey: ['chats', agent.id], queryFn: () => fetchAgentChats(agent.id), staleTime: 10_000 })
  // With the open chat listed beneath, the highlight belongs to it rather than the agent.
  const showsChat = useShowsChat(agent.id, expanded, openChatId)
  // On a phone's Home, an agent with several chats opens on the list of them; with one it opens straight
  // into it. What a routine found, when the row shows it, is one of them: the list gives it a line.
  const conversations = useAgentChats(roomy ? agent.id : undefined).data?.length ?? 0
  const routine = agent.lastChat?.routine ? agent.lastChat.id : undefined
  const href =
    status.state === 'waiting' && status.chatId
      ? `/chat/${agent.id}/${status.chatId}`
      : conversations + (routine ? 1 : 0) > 1
        ? `/chats/${agent.id}`
        : routine
          ? `/chat/${agent.id}/${routine}`
          : `/chat/${agent.id}`
  const active = Boolean(status.activity && status.state !== 'idle' && status.state !== 'done')
  const unread = useChatUnread(agent.lastChat?.id, agent.lastChat?.at) && !active

  const subtitle = active ? (
    <span className={cn(status.state === 'waiting' ? 'font-medium text-accent' : 'text-shimmer')}>
      {status.activity}
    </span>
  ) : expanded ? (
    // Its latest chat is listed just below; say what it's for instead (in the card's and the page's words).
    <span className={cn(!agent.role && 'text-ink-3')}>{agent.role || (agent.isDefault ? 'Your main agent' : 'Your agent')}</span>
  ) : (
    <span className={cn(!agent.lastChat && 'text-ink-3')}>
      {agent.lastChat?.title ?? (agent.role || 'No chats yet')}
    </span>
  )

  return (
    <Popover.Root open={menu} onOpenChange={setMenu} modal>
      <Popover.Anchor asChild>
        <div className="hue-scope" data-nav-agent="" style={{ '--hue': agent.hue } as CSSProperties}>
          <RowLink
            nav="agent"
            href={href}
            press={press}
            open={menu}
            roomy={roomy}
            selected={selected && !showsChat}
            unread={unread}
            label={unread ? `${agent.name}, new messages` : undefined}
            disclosure={
              roomy
                ? undefined
                : {
                    open: expanded,
                    controls: chatsId,
                    onToggle: () => setExpanded(agent.id, !expanded),
                    onWarm: warm,
                  }
            }
            face={
              <span className={cn('relative flex-none', roomy && 'my-2.5')}>
                {halo && <Halo id={agent.id} />}
                <Orb hue={agent.hue} size={roomy ? 52 : 40} state={status.state} seed={agent.id} />
              </span>
            }
            name={agent.name}
            time={agent.lastChat ? shortTime(agent.lastChat.at) : ''}
            subtitleKey={active ? status.activity! : expanded ? 'role' : 'title'}
            subtitle={subtitle}
            last={last}
            newChat={`/chat/${agent.id}/new`}
          />
          {!roomy && (
            <NestedChats id={chatsId} agent={agent} open={expanded} openChatId={openChatId} fill={alone} />
          )}
        </div>
      </Popover.Anchor>
      <RowMenu
        open={menu}
        name={agent.name}
        roomy={roomy}
        close={() => setMenu(false)}
        items={[
          { label: 'Edit', icon: <Pencil size={18} strokeWidth={1.85} />, onSelect: onEdit },
          ...(move ? [move] : []),
          ...(onDelete
            ? [{ label: 'Delete', icon: <Trash2 size={18} strokeWidth={1.85} />, onSelect: onDelete, danger: true }]
            : []),
        ]}
      />
    </Popover.Root>
  )
}

function GroupRowView({
  group,
  density,
  selected,
  last,
  fresh,
  onRename,
  onDelete,
  move,
}: Shared & { group: GroupRow; onRename: () => void; onDelete: () => void; move?: MenuItem }) {
  const [menu, setMenu] = useState(false)
  const press = useLongPress(() => setMenu(true))
  const [halo] = useState(fresh)
  const roomy = density === 'roomy'
  const size = roomy ? 52 : 40
  const unread = group.unread && !group.live
  // Start loading on press, so the conversation is there when the screen is.
  const warm = () => prefetchGroup(group.id)

  const subtitle = group.live ? (
    <span className="text-shimmer">Talking it over</span>
  ) : (
    <span className={cn(!group.subtitle && 'text-ink-3')}>{group.subtitle ?? `${group.memberIds.length} agents`}</span>
  )

  return (
    <Popover.Root open={menu} onOpenChange={setMenu} modal>
      <Popover.Anchor asChild>
        <div>
          <RowLink
            nav="group"
            href={`/group/${group.id}`}
            press={{
              ...press,
              onPointerDown: (e) => {
                warm()
                press.onPointerDown(e)
              },
              onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && warm(),
            }}
            open={menu}
            roomy={roomy}
            selected={selected}
            unread={unread}
            label={unread ? `${group.name}, new messages` : undefined}
            face={
              <span className={cn('relative flex-none [&_.buddy]:block', roomy && 'my-2.5')}>
                {halo && <Halo id={`group:${group.id}`} />}
                <OrbStack hues={group.memberHues} seeds={group.memberIds} size={size} />
              </span>
            }
            name={group.name}
            time={group.live ? 'now' : shortTime(group.at)}
            subtitleKey={group.live ? 'live' : 'line'}
            subtitle={subtitle}
            last={last}
            onMore={() => setMenu(true)}
          />
        </div>
      </Popover.Anchor>
      <RowMenu
        open={menu}
        name={group.name}
        roomy={roomy}
        close={() => setMenu(false)}
        items={[
          { label: 'Rename', icon: <PencilLine size={18} strokeWidth={1.85} />, onSelect: onRename },
          ...(move ? [move] : []),
          { label: 'Delete', icon: <Trash2 size={18} strokeWidth={1.85} />, onSelect: onDelete, danger: true },
        ]}
      />
    </Popover.Root>
  )
}

// ── Sections ────────────────────────────────────────────────────────────────

/**
 * A section's name over its rows. Tap it to fold the section away; folded, the
 * name keeps its members' faces beside it, still alive (one at work still hops),
 * and a dot if any of them has something new.
 */
function SectionHead({
  section,
  members,
  density,
  folded,
  lit,
  first,
  shelves,
  onSpring,
}: {
  section: Section
  members: Entry[]
  density: Density
  folded: boolean
  /** A dragged row would land here. */
  lit: boolean
  first: boolean
  shelves: SectionActions
  /** Held over while folded: open up for the row. */
  onSpring: () => void
}) {
  const roomy = density === 'roomy'
  const [menu, setMenu] = useState(false)
  const press = useLongPress(() => setMenu(true))
  const agents = members.flatMap((e) => (e.kind === 'agent' ? [e.agent] : []))
  const unread =
    useUnreadCount(agents.flatMap((a) => (a.lastChat ? [{ id: a.lastChat.id, at: a.lastChat.at }] : []))) +
    members.filter((e) => e.kind === 'group' && e.group.unread && !e.group.live).length
  const at = shelves.sections.findIndex((s) => s.id === section.id)
  const count = shelves.sections.length
  const toggle = () => setFolded(section.id, !folded)

  // Held over a folded section, a dragged row springs it open.
  const open = useRef(onSpring)
  open.current = onSpring
  useEffect(() => {
    if (!lit || !folded) return
    const t = setTimeout(() => open.current(), 650)
    return () => clearTimeout(t)
  }, [lit, folded])

  return (
    <Popover.Root open={menu} onOpenChange={setMenu} modal>
      <Popover.Anchor asChild>
        <div className={cn('group/row relative', roomy ? (first ? 'pt-1' : 'pt-4') : first ? 'pt-0.5' : 'pt-3')}>
          {/* A heading, so a screen reader can step from section to section. */}
          <h3>
            <button
              type="button"
              {...press}
              onClick={(e) => {
                press.onClick(e)
                if (!e.defaultPrevented) toggle()
              }}
              aria-expanded={!folded}
              data-open={menu || undefined}
              data-nav="section"
              className={cn(
                'relative flex w-full items-center gap-2 text-left select-none [-webkit-touch-callout:none]',
                'transition-colors duration-150',
                roomy
                  ? 'h-11 pr-5 pl-5 active:bg-fill-1 data-open:bg-fill-1'
                  : 'h-8 rounded-lg pr-2 pl-4 focus-visible:-outline-offset-2 hover:bg-fill-1 active:bg-fill-2 data-open:bg-fill-2',
                lit && 'bg-accent-soft text-accent hover:bg-accent-soft',
                lit && !folded && 'rounded-b-none',
              )}
            >
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-semibold',
                  roomy ? 'text-footnote' : 'text-caption',
                  lit ? 'text-accent' : 'text-ink-2',
                )}
              >
                {section.name}
              </span>
              <AnimatePresence initial={false}>
                {folded && (
                  <motion.span
                    key="faces"
                    className={cn('flex flex-none items-center gap-1.5', !roomy && makesWay)}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8, transition: { duration: 0.12 } }}
                    transition={{ type: 'spring', duration: 0.4, bounce: 0.2 }}
                  >
                    <span aria-hidden className="flex">
                      <Faces members={members} size={roomy ? 22 : 18} max={roomy ? 5 : 4} />
                    </span>
                    {unread > 0 && (
                      <>
                        <span
                          aria-hidden
                          className={cn('flex-none rounded-full bg-accent', roomy ? 'size-2.5' : 'size-2')}
                        />
                        <span className="sr-only">, {unread} new</span>
                      </>
                    )}
                  </motion.span>
                )}
              </AnimatePresence>
              {/* Open, the chevron waits for the pointer, as in a Mac's sidebar; folded, it stays to say so. */}
              <span
                className={cn(
                  'grid flex-none place-items-center text-ink-3 transition-opacity duration-150',
                  roomy ? '-mr-1 size-5' : 'size-7',
                  !roomy &&
                    !folded &&
                    '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-has-[:focus-visible]/row:opacity-100',
                )}
              >
                <ChevronRight
                  size={roomy ? 16 : 14}
                  strokeWidth={2.25}
                  aria-hidden
                  className={cn('transition-transform duration-250 ease-[var(--ease-out)]', !folded && 'rotate-90')}
                />
              </span>
            </button>
          </h3>
          {!roomy && (
            <button
              type="button"
              onClick={() => setMenu(true)}
              aria-label={`More for ${section.name}`}
              aria-haspopup="menu"
              data-open={menu || undefined}
              className={cn(quick(false, true), 'top-[calc(50%+6px)]', first && 'top-[calc(50%+1px)]')}
            >
              <MoreHorizontal size={16} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
      </Popover.Anchor>
      <RowMenu
        open={menu}
        name={section.name}
        roomy={roomy}
        close={() => setMenu(false)}
        items={[
          {
            label: 'Edit section',
            icon: <Pencil size={18} strokeWidth={1.85} />,
            onSelect: () => shelves.edit(section),
          },
          ...(at > 0
            ? [
                {
                  label: 'Move up',
                  icon: <ArrowUp size={18} strokeWidth={1.85} />,
                  onSelect: () => void shelves.move(section, -1),
                },
              ]
            : []),
          ...(at < count - 1
            ? [
                {
                  label: 'Move down',
                  icon: <ArrowDown size={18} strokeWidth={1.85} />,
                  onSelect: () => void shelves.move(section, 1),
                },
              ]
            : []),
          {
            label: 'Delete section',
            icon: <Trash2 size={18} strokeWidth={1.85} />,
            danger: true,
            divider: true,
            onSelect: () => void shelves.remove(section),
          },
        ]}
      />
    </Popover.Root>
  )
}

/** Who's in a section, shoulder to shoulder, as their live selves: its agents, then its groups' huddles. */
function Faces({ members, size, max }: { members: Entry[]; size: number; max: number }) {
  const shown = [...members.filter((e) => e.kind === 'agent'), ...members.filter((e) => e.kind === 'group')].slice(
    0,
    max,
  )
  const more = members.length - shown.length
  return (
    <span className="flex flex-none items-center">
      <span className="flex items-end [&_.buddy-group]:mx-px" style={{ gap: size > 20 ? 1 : 0 }}>
        {shown.map((e) =>
          e.kind === 'agent' ? (
            <Face key={e.key} agent={e.agent} size={size} />
          ) : (
            <BuddyStack key={e.key} hues={e.group.memberHues} seeds={e.group.memberIds} size={size} />
          ),
        )}
      </span>
      {more > 0 && <span className="ml-1 text-caption font-medium text-ink-3 tabular-nums">+{more}</span>}
    </span>
  )
}

function Face({ agent, size }: { agent: Agent; size: number }) {
  const status = useAgentStatus(agent.id)
  return <Buddy hue={agent.hue} size={size} state={status.state} seed={agent.id} />
}

/**
 * The button that shows on hover, drawn as the chevron is: a plain glyph on
 * the row, filling only under the pointer.
 */
const quick = (roomy: boolean, disclosure: boolean) =>
  cn(
    'pressable absolute top-1/2 hidden -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-fill-2 hover:text-ink',
    'opacity-0 transition-opacity duration-150 ease-out group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 group-has-[[data-open]]/row:opacity-100 focus-visible:opacity-100',
    '[@media(hover:hover)]:grid',
    roomy ? 'right-5 size-8' : disclosure ? 'right-10 size-7' : 'right-2 size-7',
  )

// The row's time and unread dot step aside for the More button (pointer screens only).
const makesWay =
  '[@media(hover:hover)]:group-hover/row:opacity-0 [@media(hover:hover)]:group-has-[:focus-visible]/row:opacity-0 [@media(hover:hover)]:group-has-[[data-open]]/row:opacity-0'

// While the More button shows, the lines under it end short of it, so text
// never runs beneath it (selected rows have no unread dot to hold the room).
// Compact: the 28px button ends 8px in, so text stops 8px before its 36px
// edge; roomy: 32px, 20px in. The subtitle line already has its dot's 8px gap.
const clearsMore = (roomy: boolean, line: 'name' | 'subtitle') =>
  roomy
    ? line === 'name'
      ? '[@media(hover:hover)]:group-hover/row:pr-10 [@media(hover:hover)]:group-has-[:focus-visible]/row:pr-10 [@media(hover:hover)]:group-has-[[data-open]]/row:pr-10'
      : '[@media(hover:hover)]:group-hover/row:pr-8 [@media(hover:hover)]:group-has-[:focus-visible]/row:pr-8 [@media(hover:hover)]:group-has-[[data-open]]/row:pr-8'
    : line === 'name'
      ? '[@media(hover:hover)]:group-hover/row:pr-8.5 [@media(hover:hover)]:group-has-[:focus-visible]/row:pr-8.5 [@media(hover:hover)]:group-has-[[data-open]]/row:pr-8.5'
      : '[@media(hover:hover)]:group-hover/row:pr-6.5 [@media(hover:hover)]:group-has-[:focus-visible]/row:pr-6.5 [@media(hover:hover)]:group-has-[[data-open]]/row:pr-6.5'

type Press = ReturnType<typeof useLongPress> & { onPointerEnter?: (e: React.PointerEvent) => void }

/** The sidebar's fold-open control for an agent's chats. */
type Disclosure = { open: boolean; controls: string; onToggle: () => void; onWarm?: () => void }

// With a disclosure, the More button sits one step in from the edge, so the
// chevron can keep the edge (and its place) whether the row is open or not.
const clearsBoth = {
  name: '[@media(hover:hover)]:group-hover/row:pr-16.5 [@media(hover:hover)]:group-has-[:focus-visible]/row:pr-16.5 [@media(hover:hover)]:group-has-[[data-open]]/row:pr-16.5',
  subtitle:
    '[@media(hover:hover)]:group-hover/row:pr-14.5 [@media(hover:hover)]:group-has-[:focus-visible]/row:pr-14.5 [@media(hover:hover)]:group-has-[[data-open]]/row:pr-14.5',
}

// Touch-only screens (an iPad on its side) show the chevron all the time, so
// the time and the dot always end short of it, as they do while it's open.
const chevronStays = { name: '[@media(hover:none)]:pr-8.5', subtitle: '[@media(hover:none)]:pr-6.5' }

/** The row itself: a face, a name with its time, and a line that crossfades as it changes. */
function RowLink({
  nav,
  href,
  press,
  open,
  roomy,
  selected,
  unread,
  label,
  face,
  name,
  time,
  subtitleKey,
  subtitle,
  last,
  newChat,
  onMore,
  disclosure,
}: {
  /** For ⌥↑/⌥↓, which walk the sidebar's chats (src/features/commands/shortcuts.tsx). */
  nav: 'agent' | 'group'
  href: string
  press: Press
  open: boolean
  roomy: boolean
  selected?: boolean
  unread: boolean
  label?: string
  face: ReactNode
  name: string
  time: string
  subtitleKey: string
  subtitle: ReactNode
  last?: boolean
  /** On hover, beside the chevron: a new chat with the agent (its menu is a right-click or a hold away)… */
  newChat?: string
  /** …or a group's menu, for mice and keyboards (touch holds the row). */
  onMore?: () => void
  disclosure?: Disclosure
}) {
  const unfolded = disclosure?.open
  // While open, the chevron holds the time's place.
  const shownTime = unfolded ? '' : time
  return (
    <div className="group/row relative">
      <Link
        href={href}
        {...press}
        onKeyDown={
          disclosure &&
          ((e) => {
            // Right opens the agent's chats, left folds them away, as in any tree.
            if ((e.key === 'ArrowRight' && !disclosure.open) || (e.key === 'ArrowLeft' && disclosure.open)) {
              e.preventDefault()
              disclosure.onToggle()
            }
          })
        }
        data-open={open || undefined}
        data-nav={nav}
        aria-current={selected ? 'page' : undefined}
        aria-label={label}
        className={cn(
          'relative isolate flex w-full items-center text-left select-none [-webkit-touch-callout:none]',
          'transition-[background-color,transform] duration-200 ease-[var(--ease-out)]',
          // pl-3: a 52px Buddy's body starts ~9px into its box, so it lands on the 20px line.
          roomy
            ? 'gap-3.5 pl-3 hover:bg-fill-1 active:bg-fill-2 data-open:bg-fill-2'
            : cn(
                // The ring sits inside: the rows around it are opaque and would cover it.
                'gap-3 rounded-lg px-2.5 py-2 focus-visible:-outline-offset-2 active:bg-fill-2 data-open:bg-fill-2',
                !selected && 'hover:bg-fill-1',
              ),
        )}
      >
        {/* The selection glides from row to row in the sidebar. */}
        {selected && !roomy && (
          <motion.span
            layoutId="roster-selection"
            aria-hidden
            className="absolute inset-0 -z-10 rounded-lg bg-accent-soft"
            transition={{ type: 'spring', duration: 0.38, bounce: 0.12 }}
          />
        )}
        {face}
        <span
          className={cn(
            'flex min-w-0 flex-1 flex-col justify-center self-stretch',
            roomy && 'pr-5',
            roomy && !last && 'hairline-b',
          )}
        >
          {/* With a time, the time's own room keeps the name clear. */}
          <span
            className={cn(
              'flex items-baseline gap-2',
              disclosure ? cn(unfolded ? 'pr-8.5' : chevronStays.name, clearsBoth.name) : !time && clearsMore(roomy, 'name'),
            )}
          >
            <span
              className={cn(
                'min-w-0 flex-1 truncate font-semibold tracking-[-0.015em]',
                roomy ? 'text-body' : 'text-subhead',
              )}
              title={name}
            >
              {name}
            </span>
            {shownTime && (
              <span
                className={cn(
                  'flex-none tabular-nums transition-[color,opacity] duration-300',
                  makesWay,
                  roomy ? 'text-footnote' : 'text-caption',
                  unread ? 'font-medium text-accent' : 'text-ink-3',
                )}
              >
                {shownTime}
              </span>
            )}
          </span>
          <span
            className={cn(
              'flex items-center gap-2',
              disclosure ? cn(unfolded ? 'pr-6.5' : chevronStays.subtitle, clearsBoth.subtitle) : clearsMore(roomy, 'subtitle'),
            )}
          >
            <span
              className={cn(
                'relative block min-w-0 flex-1 truncate transition-colors duration-300',
                roomy ? 'text-subhead' : 'text-footnote',
                unread ? 'text-ink' : 'text-ink-2',
              )}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={subtitleKey}
                  className="block truncate"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.28, ease }}
                >
                  {subtitle}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className={cn('flex flex-none transition-opacity', makesWay, unfolded && 'hidden')}>
              <AnimatePresence initial={false}>
                {unread && (
                  <motion.span
                    key="unread"
                    aria-hidden
                    className={cn('flex-none rounded-full bg-accent', roomy ? 'size-2.5' : 'size-2')}
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.16 } }}
                    transition={{ type: 'spring', duration: 0.4, bounce: 0.35 }}
                  />
                )}
              </AnimatePresence>
            </span>
          </span>
        </span>
      </Link>
      {newChat ? (
        <Link href={newChat} aria-label={`New chat with ${name}`} title="New chat" className={quick(roomy, !!disclosure)}>
          <Plus size={roomy ? 18 : 16} strokeWidth={2} aria-hidden />
        </Link>
      ) : (
        <button
          type="button"
          onClick={onMore}
          aria-label={`More for ${name}`}
          aria-haspopup="menu"
          className={quick(roomy, !!disclosure)}
          data-open={open || undefined}
        >
          <MoreHorizontal size={roomy ? 18 : 16} strokeWidth={2} aria-hidden />
        </button>
      )}
      {disclosure && (
        <button
          type="button"
          onClick={disclosure.onToggle}
          onPointerEnter={disclosure.onWarm}
          onFocus={disclosure.onWarm}
          aria-expanded={disclosure.open}
          aria-controls={disclosure.controls}
          aria-label={`${disclosure.open ? 'Hide' : 'Show'} ${name}’s chats`}
          title={disclosure.open ? 'Hide chats' : 'Show chats'}
          className={cn(
            'pressable absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-fill-2 hover:text-ink',
            'transition-opacity duration-150 ease-out',
            !disclosure.open &&
              'opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        >
          <ChevronRight
            size={16}
            strokeWidth={2}
            aria-hidden
            className={cn('transition-transform duration-200 ease-[var(--ease-out)]', disclosure.open && 'rotate-90')}
          />
        </button>
      )}
    </div>
  )
}

// ── Needs you ───────────────────────────────────────────────────────────────

export function NeedsYou({ density, title }: { density: Density; title?: ReactNode }) {
  const items = useNeedsYou()
  const { data: agents } = useAgents()
  const rows = items.flatMap((item) => {
    const agent = agents?.find((a) => a.id === item.agentId)
    return agent ? [{ ...item, agent }] : []
  })
  // People asking to message an agent from Telegram or WhatsApp wait here too.
  const requests = useAccessRequests().flatMap((request) => {
    const agent = agents?.find((a) => a.id === request.agentId)
    return agent ? [{ request, agent }] : []
  })
  const roomy = density === 'roomy'
  return (
    <AnimatePresence initial={false}>
      {rows.length + requests.length > 0 && (
        <motion.section
          key="needs-you"
          // The space opens under the title, then the cards drop into it.
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0, transition: { duration: 0.26, ease: [0.32, 0.72, 0, 1] } }}
          transition={{ type: 'spring', duration: 0.42, bounce: 0 }}
          className="overflow-hidden"
        >
          <div className={cn(roomy ? 'px-5 pb-5' : 'px-2 pb-3')}>
            {title}
            <ul className="space-y-2">
              <AnimatePresence initial={false} mode="popLayout">
                {rows.map(({ chatId, agent, text }, i) => (
                  <motion.li
                    key={chatId}
                    layout="position"
                    className="hue-scope origin-top"
                    style={{ '--hue': agent.hue } as CSSProperties}
                    initial={{ opacity: 0, y: -14, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
                    transition={{ type: 'spring', duration: 0.5, bounce: 0.18, delay: 0.06 + i * 0.05 }}
                  >
                    <Link
                      href={`/chat/${agent.id}/${chatId}`}
                      className={cn(
                        'pressable flex items-center rounded-xl bg-accent-soft text-left hover:brightness-[1.03]',
                        roomy ? 'gap-3 p-3' : 'gap-2.5 p-2.5',
                      )}
                    >
                      <Orb hue={agent.hue} size={roomy ? 40 : 32} state="waiting" seed={agent.id} />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block truncate font-semibold tracking-[-0.01em]',
                            roomy ? 'text-subhead' : 'text-footnote',
                          )}
                        >
                          {agent.name}
                        </span>
                        <span
                          className={cn('line-clamp-2 break-words text-ink-2', roomy ? 'text-footnote' : 'text-caption')}
                        >
                          {text}
                        </span>
                      </span>
                      <ChevronRight size={roomy ? 18 : 16} className="flex-none text-accent" />
                    </Link>
                  </motion.li>
                ))}
                {requests.map(({ request, agent }, i) => (
                  <motion.li
                    key={request.requestId}
                    layout="position"
                    className="hue-scope origin-top"
                    style={{ '--hue': agent.hue } as CSSProperties}
                    initial={{ opacity: 0, y: -14, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
                    transition={{ type: 'spring', duration: 0.5, bounce: 0.18, delay: 0.06 + (rows.length + i) * 0.05 }}
                  >
                    <RequestCard request={request} agent={agent} density={density} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  )
}

// ── Bits ────────────────────────────────────────────────────────────────────

function RosterSkeleton({ density }: { density: Density }) {
  const roomy = density === 'roomy'
  return (
    <ul
      aria-busy="true"
      aria-label="Loading agents"
      className={cn('animate-fade [animation-delay:120ms]', !roomy && 'px-2')}
    >
      {[0.62, 0.48, 0.55].map((w, i) => (
        <li key={i} className={cn('flex items-center', roomy ? 'gap-3.5 py-2.5 pr-5 pl-3' : 'gap-3 px-2.5 py-2')}>
          <Bone className={cn('flex-none rounded-full', roomy ? 'size-13' : 'size-10')} />
          <span className="flex-1 space-y-2">
            <Bone className="h-3 rounded-full" style={{ width: `${w * 70}%` }} />
            <Bone className="h-2.5 rounded-full opacity-60" style={{ width: `${w * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Re-render every `ms` so relative times stay true. */
function useTick(ms: number) {
  const [, set] = useState(0)
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}
