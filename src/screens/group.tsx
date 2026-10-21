import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useLocation } from 'wouter'
import { MotionConfig } from 'motion/react'
import { Thread } from '@/features/chat/thread'
import { useKeyboardInset } from '@/features/chat/use-keyboard-inset'
import { GroupHeader } from '@/features/group/group-header'
import { GroupComposer } from '@/features/group/group-composer'
import { GroupEmpty } from '@/features/group/group-empty'
import { GroupSheet } from '@/features/group/group-sheet'
import { Button } from '@/ui/button'
import { BuddyStack } from '@/ui/buddy'
import { Skeleton } from '@/ui/skeleton'
import { useFinePointer, useIsWide } from '@/lib/use-media'
import { cn } from '@/lib/cn'
import { approveInGroup, deleteGroup, renameGroup, retryGroup, sendToGroup, stopGroup, useGroup } from '@/state/groups'

// A group chat: like talking to one agent, except several take turns.

const HUE = 278

export function GroupScreen({ groupId }: { groupId: string }) {
  const { group, items, loaded, missing, working, stopping, active } = useGroup(groupId)
  const wide = useIsWide()
  const fine = useFinePointer()
  const inset = useKeyboardInset()
  const [, navigate] = useLocation()
  const root = useRef<HTMLDivElement>(null)
  const scrolled = useScrolled(root)
  const [sheet, setSheet] = useState(false)
  const [draft, setDraft] = useState<{ mentioned: string[]; typing: boolean }>({ mentioned: [], typing: false })

  const onDraftChange = useCallback((d: { mentioned: string[]; typing: boolean }) => setDraft(d), [])
  // Opened before the conversation arrived: it fades in over the placeholder.
  const [coldStart] = useState(!loaded)

  if (missing) return <Gone />

  const members = group?.members ?? []
  // While you type, whoever you're addressing looks down to listen.
  const listening =
    draft.typing && !working ? (draft.mentioned.length ? draft.mentioned : members.map((m) => m.id)) : []
  const send = (text: string) => void sendToGroup(groupId, text)

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={root}
        className="hue-scope relative h-dvh overflow-hidden bg-bg"
        // The keyboard takes its share of the screen, as in a one-to-one chat.
        style={{ '--hue': HUE, height: inset ? `calc(100dvh - ${inset}px)` : undefined } as CSSProperties}
      >
        <Wash hues={members.map((m) => m.hue)} />
        {/* The screen's heading, for finding your way by headings; the header shows the name. */}
        <h1 className="sr-only">{group?.name ?? 'Group chat'}</h1>

        <GroupHeader
          group={group}
          active={active}
          working={working}
          stopping={stopping}
          listening={listening}
          mentioned={draft.mentioned}
          showBack={!wide}
          scrolled={scrolled}
          onOpen={() => setSheet(true)}
        />

        <Thread
          // Messages start below the header and scroll under its glass.
          className={cn(
            '[&>[role=log]>div]:pt-[calc(3.5rem+env(safe-area-inset-top))]',
            coldStart && loaded && '[&>[role=log]>div>div:first-child]:animate-fade',
          )}
          items={loaded ? items : []}
          busy={working && Boolean(active)}
          agent={active?.member}
          emptyState={
            loaded && group ? (
              <GroupEmpty group={group} listening={listening} mentioned={draft.mentioned} onStart={send} />
            ) : !loaded ? (
              <GroupSkeleton hues={group?.members.map((m) => m.hue) ?? []} />
            ) : undefined
          }
          onApprove={(requestId, choice) => void approveInGroup(groupId, requestId, choice)}
          onAnswer={() => {}}
          onRetry={() => void retryGroup(groupId)}
          footer={
            <GroupComposer
              members={members}
              onSend={send}
              onStop={() => void stopGroup(groupId)}
              busy={working}
              disabled={!group}
              hue={active?.member.hue}
              draftKey={`group:${groupId}`}
              onDraftChange={onDraftChange}
              autoFocus={fine}
            />
          }
        />

        {group && (
          <GroupSheet
            open={sheet}
            onOpenChange={setSheet}
            group={group}
            onRename={(name) => renameGroup(groupId, name)}
            onDelete={async () => {
              await deleteGroup(groupId)
              setSheet(false)
              navigate('/', { replace: true })
            }}
            onOpenMember={(id) => {
              setSheet(false)
              navigate(`/chat/${encodeURIComponent(id)}`)
            }}
          />
        )}
      </div>
    </MotionConfig>
  )
}

/**
 * Everyone's colour, barely there, behind the header: a one-to-one chat's
 * wash (screens/chat.tsx), one soft pool per member, side by side.
 */
function Wash({ hues }: { hues: number[] }) {
  const shown = hues.slice(0, 4)
  const n = shown.length
  if (!n) return null
  // Narrower pools as the room fills, so together they cover what one does.
  const width = n === 1 ? 60 : 36 + 24 / n
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 opacity-80">
      {shown.map((hue, i) => (
        <div
          key={i}
          className="hue-scope absolute inset-0"
          style={
            {
              '--hue': hue,
              backgroundImage: `radial-gradient(${width}% 100% at ${n === 1 ? 50 : 18 + (64 * i) / (n - 1)}% 0%, var(--accent-soft), transparent)`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

/** Whether the thread (inside `root`) has messages scrolled beneath the header. */
function useScrolled(root: RefObject<HTMLElement | null>) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const log = root.current?.querySelector('[role=log]')
    if (!log) return
    const update = () => setScrolled(log.scrollTop > 2)
    update()
    log.addEventListener('scroll', update, { passive: true })
    return () => log.removeEventListener('scroll', update)
  }, [root])
  return scrolled
}

/** The shape of a conversation while it loads; quick loads never see it. */
function GroupSkeleton({ hues }: { hues: number[] }) {
  const a = hues[0] ?? HUE
  const b = hues[1] ?? hues[0] ?? HUE
  // A speaker's line, as the thread draws it: a small face, a name, then text.
  const speaker = (hue: number, widths: number[]) => (
    <div className="flex flex-col items-start gap-2.5">
      <div className="flex h-6 items-center gap-2">
        <span className="size-5 rounded-full" style={{ background: `oklch(0.7 0.13 ${hue} / 0.28)` }} />
        <Skeleton className="h-2.5 w-16 rounded-full" />
      </div>
      {widths.map((w, i) => (
        <Skeleton key={i} className="h-3 rounded-full" style={{ width: `${w}%` }} />
      ))}
    </div>
  )
  return (
    <div
      aria-busy="true"
      aria-label="Loading the conversation"
      className="mb-auto flex w-full animate-fade flex-col gap-8 self-stretch [animation-delay:180ms]"
    >
      <div className="flex justify-end">
        <Skeleton className="h-11 w-[46%] rounded-[22px]" />
      </div>
      {speaker(a, [88, 72, 40])}
      {speaker(b, [64, 30])}
    </div>
  )
}

/** A link to a group that's been deleted: two sleepy buddies and a way home. */
function Gone() {
  const [, navigate] = useLocation()
  return (
    <div className="grid h-dvh place-items-center bg-bg">
      <div role="alert" className="flex animate-rise flex-col items-center px-8 text-center">
        <BuddyStack hues={[HUE, 28]} seeds={['gone-a', 'gone-b']} states={['offline', 'offline']} size={72} />
        <h1 className="mt-5 text-title font-semibold tracking-[-0.02em] text-balance">This group isn’t here anymore</h1>
        <p className="mt-1 max-w-80 text-subhead text-balance text-ink-2">
          It may have been deleted on another device.
        </p>
        <Button className="mt-7" variant="secondary" onClick={() => navigate('/', { replace: true })}>
          Back to chats
        </Button>
      </div>
    </div>
  )
}
