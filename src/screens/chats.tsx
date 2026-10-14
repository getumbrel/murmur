import { useEffect, type CSSProperties } from 'react'
import { Link, useLocation } from 'wouter'
import { MotionConfig } from 'motion/react'
import { ChevronRight, SquarePen } from 'lucide-react'
import { IconButton } from '@/ui/button'
import { Orb } from '@/ui/orb'
import { useIsWide } from '@/lib/use-media'
import { cn } from '@/lib/cn'
import { useAgents } from '@/state/agents'
import { useAgentStatus } from '@/state/status'
import { NotFound } from '@/features/chat-screen/not-found'
import { ChatList } from '@/features/agent-page/chat-list'
import { PageBar } from '@/features/agent-page/page-bar'
import { usePageScroll } from '@/features/agent-page/scroll'
import { useAgentChatList, useDeleteChat } from '@/features/agent-page/chats'

// One agent's chats and nothing else, for a phone's Home: tap an agent with
// more than one chat and pick which, as in Messages. Its name leads to the
// agent's own page (routines, memory, Telegram, its look); wide screens list
// chats in the sidebar instead, so they go there.

export function ChatsScreen({ agentId }: { agentId: string }) {
  const agents = useAgents()
  const agent = agents.data?.find((a) => a.id === agentId)
  const [, navigate] = useLocation()
  const wide = useIsWide()
  const status = useAgentStatus(agentId)
  const chats = useAgentChatList(agent)
  const deleteChat = useDeleteChat(agentId)
  const { page, title, scrolled, under, onScroll } = usePageScroll<HTMLHeadingElement>(`chats:${agentId}`)

  useEffect(() => {
    if (wide) navigate(`/agent/${agentId}`, { replace: true })
  }, [wide, agentId, navigate])

  if (agents.isSuccess && !agent)
    return (
      <div className="grid h-dvh place-items-center bg-bg">
        <NotFound
          title="This agent isn’t here anymore"
          body="It may have been deleted. Pick another agent to keep chatting."
          action="All agents"
          onAction={() => navigate('/agents', { replace: true })}
        />
      </div>
    )
  if (!agent) return <div className="h-dvh bg-bg" />

  const busy = Boolean(status.activity && status.state !== 'idle' && status.state !== 'done')

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={page}
        onScroll={onScroll}
        className="hue-scope relative h-dvh overflow-y-auto overscroll-contain bg-bg"
        style={{ '--hue': agent.hue } as CSSProperties}
      >
        <PageBar
          title={agent.name}
          scrolled={scrolled}
          under={under}
          back={{ href: '/', label: 'Back' }}
          trailing={
            <IconButton size="lg" label="New chat" onClick={() => navigate(`/chat/${agentId}/new`)}>
              <SquarePen size={20} strokeWidth={1.85} />
            </IconButton>
          }
        />

        <div className="mx-auto w-full max-w-[40rem] px-5 pt-1 pb-[max(40px,env(safe-area-inset-bottom))]">
          {/* Who these chats are with; tapping it opens the agent itself. */}
          <Link
            href={`/agent/${agentId}`}
            aria-label={`${agent.name}, agent details`}
            className="pressable -mx-2 mb-6 flex items-center gap-3.5 rounded-2xl p-2 hover:bg-fill-1"
          >
            <Orb hue={agent.hue} size={52} state={status.state} seed={agent.id} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-0.5">
                <h1
                  ref={title}
                  className="truncate text-large font-semibold tracking-[-0.025em] [overflow-wrap:anywhere]"
                >
                  {agent.name}
                </h1>
                <ChevronRight size={20} strokeWidth={2.25} aria-hidden className="mt-0.5 flex-none text-ink-3" />
              </span>
              <span
                className={cn(
                  'block truncate text-subhead',
                  busy ? (status.state === 'waiting' ? 'font-medium text-accent' : 'text-shimmer') : 'text-ink-2',
                )}
              >
                {busy ? status.activity : agent.role || (agent.isDefault ? 'Your main agent' : 'Your agent')}
              </span>
            </span>
          </Link>

          <ChatList
            agent={agent}
            chats={chats.data}
            pending={chats.isPending}
            failed={chats.isError}
            onRetry={() => void chats.refetch()}
            onDelete={deleteChat}
            heading={false}
          />
        </div>
      </div>
    </MotionConfig>
  )
}
