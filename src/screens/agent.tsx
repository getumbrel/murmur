import { useState, type CSSProperties } from 'react'
import { useLocation } from 'wouter'
import { MotionConfig } from 'motion/react'
import { SquarePen } from 'lucide-react'
import { toast } from 'sonner'
import { Button, IconButton } from '@/ui/button'
import { useIsWide } from '@/lib/use-media'
import { cn } from '@/lib/cn'
import { useUpFrom } from '@/lib/transitions'
import { speakerOf, useAgents } from '@/state/agents'
import { useAgentStatus } from '@/state/status'
import { createChat, send } from '@/state/chats'
import { useAgentActions } from '@/features/home/actions'
import { MemorySheet, rememberMessage } from '@/features/memory'
import { TelegramSheet } from '@/features/telegram'
import { WhatsAppSheet } from '@/features/whatsapp'
import { AppsSheet } from '@/features/apps'
import { VaultSheet } from '@/features/vault'
import { RoutineDetailSheet, RoutineNewsList, RoutinesSheet } from '@/features/routines'
import { NotFound } from '@/features/chat-screen/not-found'
import { AgentHero } from '@/features/agent-page/hero'
import { QuickActions } from '@/features/agent-page/quick-actions'
import { ChatList } from '@/features/agent-page/chat-list'
import { AgentModelSheet } from '@/features/agent-page/model-sheet'
import { PageBar } from '@/features/agent-page/page-bar'
import { WeekCard } from '@/features/agent-page/week'
import { usePageScroll } from '@/features/agent-page/scroll'
import { useAgentChatList, useDeleteChat } from '@/features/agent-page/chats'

// An agent's home: who it is, a way to start talking, what it can do besides
// (routines, memory, apps, passwords, Telegram and WhatsApp; its look is Edit,
// up in the corner), and every chat you've had with it.
// Phones reach it from a chat's header and go back to that chat; wide screens
// show it beside the sidebar.

type Sheet = 'model' | 'routines' | 'memory' | 'apps' | 'passwords' | 'telegram' | 'whatsapp'

export function AgentScreen({ agentId }: { agentId: string }) {
  const agents = useAgents()
  const agent = agents.data?.find((a) => a.id === agentId)
  const [location, navigate] = useLocation()
  const wide = useIsWide()
  const status = useAgentStatus(agentId)
  // What its routines found has its own place here, From routines.
  const chats = useAgentChatList(agent, { results: false })
  const deleteChat = useDeleteChat(agentId)
  const actions = useAgentActions()
  const { page, title, scrolled, under, onScroll } = usePageScroll<HTMLHeadingElement>(`agent:${agentId}`)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  // A routine opened from what it found, showing that result.
  const [news, setNews] = useState<{ id: string; runId?: string } | null>(null)
  const [newsShown, setNewsShown] = useState(news)
  if (news && news !== newsShown) setNewsShown(news)
  // Pressing "New chat": the Buddy looks up to listen.
  const [perk, setPerk] = useState(false)
  const up = useUpFrom(location)

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

  const newChat = () => navigate(`/chat/${agentId}/new`)
  const open = (s: Sheet) => () => setSheet(s)
  const sheetProps = (s: Sheet) => ({ open: sheet === s, onOpenChange: (on: boolean) => setSheet(on ? s : null) })

  // "Tell it something to remember" starts a quiet chat of its own; the
  // Buddy shows it working, and the memory list watches for the result.
  const remember = async (text: string) => {
    try {
      const id = await createChat(agentId, { speaker: speakerOf(agent) })
      await send(id, rememberMessage(text))
    } catch {
      toast.error('Couldn’t reach Hermes. Check that it’s running, then try again.')
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={page}
        onScroll={onScroll}
        className="hue-scope relative h-dvh overflow-y-auto overscroll-contain bg-bg"
        style={{ '--hue': agent.hue } as CSSProperties}
      >
        {/* The agent's colour, barely there, behind the top of its page. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(60%_100%_at_50%_0%,var(--accent-soft),transparent)] opacity-80"
        />
        <PageBar
          title={agent.name}
          scrolled={scrolled}
          under={under}
          back={wide ? undefined : { href: up, label: 'Back' }}
          wideTrailing
          trailing={
            <>
              {/* New chat joins once the big button has scrolled away; Edit holds the corner. */}
              <IconButton
                size="lg"
                label="New chat"
                onClick={newChat}
                tabIndex={under ? 0 : -1}
                aria-hidden={!under}
                className={cn(
                  'transition-[opacity,transform] duration-200 ease-[var(--ease-out)]',
                  under ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0',
                )}
              >
                <SquarePen size={20} strokeWidth={1.85} />
              </IconButton>
              <button
                type="button"
                onClick={() => actions.edit(agent)}
                aria-label={`Edit ${agent.name}`}
                className="pressable touch-target flex h-11 items-center rounded-full px-3.5 text-body text-accent hover:bg-fill-1"
              >
                Edit
              </button>
            </>
          }
        />

        <div className="relative mx-auto w-full max-w-[40rem] pt-2 pb-[max(40px,env(safe-area-inset-bottom))] md:pt-8">
          <AgentHero
            agent={agent}
            status={status}
            perk={perk}
            titleRef={title}
            onModel={open('model')}
          />

          <div className="mt-7 space-y-8 px-5">
            <div className="flex justify-center">
              <Button
                variant="accent"
                size="lg"
                onClick={newChat}
                onPointerEnter={() => setPerk(true)}
                onPointerLeave={() => setPerk(false)}
                onFocus={() => setPerk(true)}
                onBlur={() => setPerk(false)}
                className="sm:w-auto sm:min-w-64"
              >
                <SquarePen size={18} strokeWidth={2} aria-hidden />
                New chat
              </Button>
            </div>

            <QuickActions
              agent={agent}
              onRoutines={open('routines')}
              onMemory={open('memory')}
              onApps={open('apps')}
              onPasswords={open('passwords')}
              onTelegram={open('telegram')}
              onWhatsApp={open('whatsapp')}
            />

            <RoutineNewsList agent={agent} onOpen={(id, runId) => setNews({ id, runId })} />

            <WeekCard agent={agent} />

            <ChatList
              agent={agent}
              chats={chats.data}
              pending={chats.isPending}
              failed={chats.isError}
              onRetry={() => void chats.refetch()}
              onDelete={deleteChat}
            />
          </div>
        </div>

        <AgentModelSheet agent={agent} {...sheetProps('model')} />
        <RoutinesSheet
          agent={agent}
          {...sheetProps('routines')}
          onOpenRun={(runId) => {
            setSheet(null)
            navigate(`/chat/${agentId}/${runId}`)
          }}
        />
        <RoutineDetailSheet
          agent={agent}
          // Kept while it closes, so it doesn't empty as it goes.
          routineId={newsShown?.id}
          openRunId={newsShown?.runId}
          open={news !== null}
          onOpenChange={(on) => !on && setNews(null)}
          onOpenRun={(runId) => {
            setNews(null)
            navigate(`/chat/${agentId}/${runId}`)
          }}
        />
        <MemorySheet agent={agent} {...sheetProps('memory')} onRemember={(text) => void remember(text)} />
        <AppsSheet agent={agent} {...sheetProps('apps')} />
        <VaultSheet agent={agent} {...sheetProps('passwords')} />
        <TelegramSheet agent={agent} {...sheetProps('telegram')} />
        <WhatsAppSheet agent={agent} {...sheetProps('whatsapp')} />
        {actions.sheets}
      </div>
    </MotionConfig>
  )
}
