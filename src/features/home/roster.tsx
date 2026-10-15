import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'wouter'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, MoreHorizontal, Pencil, PencilLine, Trash2 } from 'lucide-react'
import { Orb, OrbStack } from '@/ui/orb'
import { Button } from '@/ui/button'
import { fetchAgentChats, useAgentChats, useAgents, type Agent } from '@/state/agents'
import { useAgentStatus, useBusyAgents, useChatUnread, useNeedsYou } from '@/state/status'
import { prefetchGroup, useGroupSummaries } from '@/state/groups'
import { useAccessRequests } from '@/state/access'
import { RequestCard } from '@/features/access/request-card'
import { cn } from '@/lib/cn'
import { useGroupRows, type GroupRow } from './groups'
import { shortTime } from './time'
import { Bone } from './bone'
import { menuItem, menuKeys } from './new-menu'
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
}

type Entry = { key: string; at: number } & ({ kind: 'agent'; agent: Agent } | { kind: 'group'; group: GroupRow })

export function Roster({ density, selectedId, openChatId, onEdit, onDelete, onRenameGroup, onDeleteGroup }: RosterProps) {
  const { data: agents, isPending, isError, refetch, isRefetching } = useAgents()
  const groups = useGroupRows()
  const groupsLoaded = !useGroupSummaries().isPending
  const busy = useBusyAgents()
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

  // Most recent conversation first (anyone busy right now counts as now, and
  // a brand-new agent counts from its birth); the main agent wins ties.
  const now = Date.now()
  // Wait for groups too, or ones that were always there would read as new.
  if (groupsLoaded) noteArrivals([...agents.map((a) => a.id), ...groups.map((g) => `group:${g.id}`)])
  const entries: Entry[] = [
    ...agents.map((agent) => ({
      kind: 'agent' as const,
      key: agent.id,
      agent,
      at: busy.includes(agent.id) ? now : Math.max(agent.lastChat?.at ?? 0, Number(agent.botMeta?.created) || 0),
    })),
    ...groups.map((group) => ({
      kind: 'group' as const,
      key: `group:${group.id}`,
      group,
      at: group.live ? now : group.at,
    })),
  ].sort((a, b) => b.at - a.at || Number(isMain(b)) - Number(isMain(a)))

  return (
    <ul className={cn(density === 'compact' && 'space-y-px px-2')}>
      <AnimatePresence initial={false} mode="popLayout">
        {entries.map((entry, i) => (
          <motion.li
            key={entry.key}
            layout="position"
            // Opaque and stacked by rank, so a row climbing the list slides over the ones it passes;
            // a newcomer sits underneath, revealed as the rows part for it.
            className="relative bg-bg"
            style={{ zIndex: arriving(entry.key) ? 0 : entries.length - i }}
            // Arrivals are births: a little lift. Reorders glide.
            transition={{ type: 'spring', duration: 0.55, bounce: 0.22, layout: spring }}
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
          >
            {entry.kind === 'agent' ? (
              <AgentRow
                agent={entry.agent}
                density={density}
                selected={entry.key === selectedId}
                openChatId={entry.key === selectedId ? openChatId : undefined}
                last={i === entries.length - 1}
                fresh={freshArrival(entry.key)}
                onEdit={() => onEdit(entry.agent)}
                onDelete={entry.agent.isDefault ? undefined : () => onDelete(entry.agent)}
              />
            ) : (
              <GroupRowView
                group={entry.group}
                density={density}
                selected={entry.key === selectedId}
                last={i === entries.length - 1}
                fresh={freshArrival(entry.key)}
                onRename={() => onRenameGroup(entry.group)}
                onDelete={() => onDeleteGroup(entry.group)}
              />
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

const isMain = (e: Entry) => e.kind === 'agent' && e.agent.isDefault

// ── Arrivals ────────────────────────────────────────────────────────────────
// Someone new in the roster (made here or in another app) gets a one-time
// halo. Kept outside React so it survives the phone leaving Home and coming
// back: the new row still greets you on return.

const known = new Set<string>()
const arrivedAt = new Map<string, number>()
const greeted = new Set<string>()
let primed = false

function noteArrivals(keys: string[]) {
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
    <>
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
    </>
  )
}

// ── Rows ────────────────────────────────────────────────────────────────────

type Shared = { density: Density; selected?: boolean; last?: boolean; fresh?: boolean }

function AgentRow({
  agent,
  density,
  selected,
  openChatId,
  last,
  fresh,
  onEdit,
  onDelete,
}: Shared & { agent: Agent; openChatId?: string; onEdit: () => void; onDelete?: () => void }) {
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
  // On a phone's Home, an agent with several chats opens on the list of them; with one it opens straight into it.
  const many = (useAgentChats(roomy ? agent.id : undefined).data?.length ?? 0) > 1
  const href =
    status.state === 'waiting' && status.chatId
      ? `/chat/${agent.id}/${status.chatId}`
      : many
        ? `/chats/${agent.id}`
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
            onMore={() => setMenu(true)}
          />
          {!roomy && <NestedChats id={chatsId} agent={agent} open={expanded} openChatId={openChatId} />}
        </div>
      </Popover.Anchor>
      <RowMenu
        open={menu}
        name={agent.name}
        roomy={roomy}
        close={() => setMenu(false)}
        items={[
          { label: 'Edit', icon: <Pencil size={18} strokeWidth={1.85} />, onSelect: onEdit },
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
}: Shared & { group: GroupRow; onRename: () => void; onDelete: () => void }) {
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
          { label: 'Delete', icon: <Trash2 size={18} strokeWidth={1.85} />, onSelect: onDelete, danger: true },
        ]}
      />
    </Popover.Root>
  )
}

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
  /** The row's menu, for mice and keyboards (touch holds the row). */
  onMore: () => void
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
      <button
        type="button"
        onClick={onMore}
        aria-label={`More for ${name}`}
        aria-haspopup="menu"
        className={cn(
          'pressable absolute top-1/2 hidden -translate-y-1/2 place-items-center rounded-full bg-elevated text-ink-2 shadow-float ring-1 ring-line',
          'opacity-0 transition-opacity duration-150 ease-out group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 hover:text-ink data-open:opacity-100',
          '[@media(hover:hover)]:grid',
          roomy ? 'right-5 size-8' : disclosure ? 'right-10 size-7' : 'right-2 size-7',
        )}
        data-open={open || undefined}
      >
        <MoreHorizontal size={roomy ? 18 : 16} strokeWidth={1.85} />
      </button>
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

// ── Context menu ────────────────────────────────────────────────────────────

type MenuItem = { label: string; icon: ReactNode; onSelect: () => void; danger?: boolean }

function RowMenu({
  open,
  name,
  roomy,
  items,
  close,
}: {
  open: boolean
  name: string
  roomy: boolean
  items: MenuItem[]
  close: () => void
}) {
  // Where focus was before the menu (the More button, for keyboards): it goes back there,
  // and a sheet opened from the menu returns it there too.
  const before = useRef<HTMLElement | null>(null)
  const restore = () => before.current?.isConnected && before.current.focus()
  const select = (it: MenuItem) => {
    close()
    // After the menu lets go of focus.
    setTimeout(() => {
      restore()
      it.onSelect()
    })
  }
  return (
    <AnimatePresence>
      {open && (
        <Popover.Portal forceMount>
          <Popover.Content
            forceMount
            asChild
            side="bottom"
            align="start"
            sideOffset={roomy ? -6 : 4}
            alignOffset={roomy ? 20 : 8}
            collisionPadding={12}
            aria-label={`${name} options`}
            onOpenAutoFocus={() => (before.current = document.activeElement as HTMLElement | null)}
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              restore()
            }}
          >
            <motion.div
              role="menu"
              onKeyDown={menuKeys}
              className="z-50 min-w-56 origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-xl bg-elevated shadow-float ring-1 ring-line"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            >
              {items.map((it, i) => (
                <button
                  key={it.label}
                  role="menuitem"
                  className={cn(menuItem, i > 0 && 'hairline-t', it.danger && 'text-danger')}
                  onClick={() => select(it)}
                >
                  {it.label}
                  <span className={cn(!it.danger && 'text-ink-2')}>{it.icon}</span>
                </button>
              ))}
            </motion.div>
          </Popover.Content>
        </Popover.Portal>
      )}
    </AnimatePresence>
  )
}

/** Touch-and-hold (or right-click) opens the menu; the tap that ends a hold doesn't navigate. */
function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const origin = useRef<{ x: number; y: number }>(undefined)
  const fired = useRef(false)
  const cancel = () => clearTimeout(timer.current)
  useEffect(() => cancel, [])
  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false
      if (e.pointerType === 'mouse') return
      origin.current = { x: e.clientX, y: e.clientY }
      timer.current = setTimeout(() => {
        fired.current = true
        navigator.vibrate?.(8)
        onLongPress()
      }, ms)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 8) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClick: (e: React.MouseEvent) => {
      if (fired.current) e.preventDefault()
      fired.current = false
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      cancel()
      onLongPress()
    },
  }
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
