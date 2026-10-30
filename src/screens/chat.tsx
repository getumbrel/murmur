import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useLocation } from 'wouter'
import { MotionConfig } from 'motion/react'
import { Gauge } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Thread } from '@/features/chat/thread'
import { RunHeader, useRunItems } from '@/features/routines/run-view'
import { useChatName } from '@/features/chat-screen/chat-name'
import { Composer, useKeyboardInset, type ComposerHandle } from '@/features/chat/composer'
import { DropZone } from '@/features/chat-screen/drop-zone'
import type { MediaContext } from '@/features/media/context'
import type { ChatItem } from '@/features/chat/types'
import { ChatHeader } from '@/features/chat-screen/chat-header'
import { EmptyState } from '@/features/chat-screen/empty-state'
import { takeOpeningLine } from '@/features/chat-screen/opening-line'
import { NotFound } from '@/features/chat-screen/not-found'
import { ThreadSkeleton } from '@/features/chat-screen/thread-skeleton'
import { useOrbState } from '@/features/chat-screen/use-orb-state'
import { GoalChip } from '@/features/chat-screen/goal-chip'
import { useLoved } from '@/features/chat-screen/hearts'
import { BackBadge, backHint, useElsewhere } from '@/features/chat-screen/elsewhere'
import { ChatMenu, ChatMenuButton, useChatMenu } from '@/features/chat-screen/chat-menu'
import { ChatInfoSheet, ContextRing } from '@/features/chat-screen/chat-info'
import { useAgentChatList, useArchivedChats, useChatActions, type AgentChat } from '@/features/agent-page/chats'
import { chatOptions } from '@/features/agent-page/chat-list'
import { RenameChatSheet } from '@/features/agent-page/rename-chat'
import { transcript } from '@/features/chat-screen/transcript'
import { ModelChip } from '@/features/model/model-chip'
import { EFFORT, thinkingOf, type Thinking } from '@/features/model/names'
import { useThinkingDefault, type ModelPick } from '@/features/model/use-models'
import { commandList, isCurated, type CommandName } from '@/features/commands/commands'
import { useCatalog } from '@/features/commands/use-catalog'
import { useUmbrelKey } from '@/features/chat/umbrel-key'
import { ChatConnectCard } from '@/features/chat/connect-card'
import { AppsSheet } from '@/features/apps'
import { useAppsPlusItem } from '@/features/apps/plus-item'
import { VaultSheet } from '@/features/vault'
import { useVaultPlusItems } from '@/features/vault/plus-items'
import { stopSpeaking, useSpeech } from '@/features/voice/speech'
import { useConnection } from '@/hermes/gateway'
import { useChatUsage } from '@/state/insights'
import { useRunOf } from '@/state/routines'
import type { VaultKind } from '@/state/vault'
import { useFinePointer, useIsWide } from '@/lib/use-media'
import { useUpFrom } from '@/lib/transitions'
import {
  answerApproval,
  answerQuestion,
  answerSecret,
  askAside,
  attachmentsOf,
  continueHere,
  createChat,
  dismissItem,
  getChat,
  editableMessage,
  leaveChat,
  loadOlder,
  openChat,
  readUnread,
  react,
  regenerate,
  renameChat,
  resend,
  resetChatReasoning,
  runSlash,
  send,
  sendHidden,
  setChatModel,
  setChatReasoning,
  stop,
  stopHelper,
  titleTaken,
  undo,
  useChats,
} from '@/state/chats'
import {
  speakerOf,
  useAgentChats,
  useAgents,
  type Agent,
} from '@/state/agents'

// One agent, one conversation. /chat/:agent opens the latest chat (or a new
// one), /chat/:agent/new is a blank chat that Hermes only creates on the first
// message, and /chat/:agent/:id is a stored chat.

export function ChatScreen({ agentId, chatId }: { agentId: string; chatId?: string }) {
  const agents = useAgents()
  const agent = agents.data?.find((a) => a.id === agentId)
  const [, navigate] = useLocation()
  const wide = useIsWide()
  const fine = useFinePointer()
  const inset = useKeyboardInset()

  // No chat in the URL: pick up where you left off, or start fresh.
  const recent = useAgentChats(chatId ? undefined : agentId)
  useEffect(() => {
    if (chatId || !recent.isFetched) return
    const latest = recent.data?.[0]
    navigate(`/chat/${agentId}/${latest ? latest.id : 'new'}`, { replace: true })
  }, [chatId, recent.isFetched, recent.data, agentId, navigate])

  const isDraft = chatId === 'new'
  const id = chatId && !isDraft ? chatId : undefined
  const chat = useChats((s) => (id ? s.chats[id] : undefined))
  const [openError, setOpenError] = useState(false)

  useEffect(() => {
    setOpenError(false)
    if (!id || !agent) return
    openChat(id, agentId, speakerOf(agent)).catch(() => setOpenError(true))
  }, [id, agentId, agent])
  useEffect(() => (id ? () => leaveChat(id) : undefined), [id])

  // A blank chat keeps its model choice locally until Hermes creates it.
  const [draftPick, setDraftPick] = useState<ModelPick>()
  const [draftEffort, setDraftEffort] = useState<string>()
  const [starting, setStarting] = useState<ChatItem | null>(null)
  const born = useRef<string>(undefined)
  useEffect(() => {
    if (!isDraft) return
    setDraftPick(undefined)
    setDraftEffort(undefined)
  }, [isDraft, agentId])

  const status = chat?.status ?? (starting ? 'thinking' : 'idle')
  const busy = status === 'thinking' || status === 'working' || status === 'waiting'
  // A routine's run reads as a report, under what the routine is.
  const runOfChat = useRunOf(agentId, id)
  const run = useRunItems(runOfChat, useSolo(chat?.items ?? (starting ? [starting] : [])))
  const items = run.items
  const online = useConnection((s) => s.state === 'open' || !s.everOpened)
  const [typing, setTyping] = useState(false)
  const speaking = useSpeech((s) => s.profile === agentId && s.phase === 'playing')
  const mood = useOrbState(online ? status : 'offline', { typing, speaking })
  // You said something sweet: a happy hop under the hearts.
  const loved = useLoved(chat?.vibes)
  const orb = loved && online ? 'done' : mood
  const pick =
    chat?.model && chat.provider ? { model: chat.model, provider: chat.provider } : (draftPick ?? agentPick(agent))
  const effort = chat ? chat.reasoning : draftEffort

  // What this chat's about rests under the name, busy or not: the reply's own line says what
  // the agent's doing, and its face here shows it. The model has a chip of its own by the composer.
  const name = useChatName(agentId, id, chat, { fresh: !!id && id === born.current })
  const subtitle = isDraft ? 'New chat' : name

  // Stop pressed while the chat is still being made: stop it as soon as it exists.
  const stopEarly = useRef(false)
  const start = async (text: string, files: File[]) => {
    if (!agent || starting) return
    const attachments = attachmentsOf(files)
    const local: ChatItem = {
      kind: 'user',
      id: `start-${Date.now()}`,
      text,
      at: Date.now(),
      attachments: attachments.length ? attachments : undefined,
    }
    stopEarly.current = false
    setStarting(local)
    try {
      const newId = await createChat(agentId, {
        speaker: speakerOf(agent),
        ...draftPick,
        reasoning: draftEffort,
      })
      // Same component, new URL: the thread carries on without a flash.
      born.current = newId
      navigate(`/chat/${agentId}/${newId}`, { replace: true })
      await send(newId, text, files, { itemId: local.id, attachments })
      if (stopEarly.current) void stop(newId)
    } catch {
      attachments.forEach((a) => a.kind === 'image' && a.url && URL.revokeObjectURL(a.url))
      toast.error('Can’t start a chat right now. Check that Hermes is running, then try again.')
    } finally {
      setStarting(null)
    }
  }

  const composer = useRef<ComposerHandle>(null)
  const fill = (text: string) => {
    composer.current?.setText(text)
    composer.current?.focus()
  }
  // A pasted umbrelOS key: connect every agent here instead of sending it (umbrel-key.tsx).
  const umbrelKey = useUmbrelKey({ agent, agents: agents.data ?? [], onConnected: fill })

  // Edit and resend: your last message goes back in the composer.
  const editable = useChats((s) => (id ? editableMessage(s.chats[id]) : undefined))
  const [rewrite, setRewrite] = useState<string | null>(null)
  if (rewrite && editable?.id !== rewrite) setRewrite(null)
  const onEditMessage = useCallback((item: { id: string; text: string }) => {
    setRewrite(item.id)
    composer.current?.setText(item.text)
    composer.current?.focus()
  }, [])
  const cancelRewrite = () => {
    setRewrite(null)
    composer.current?.setText('')
  }

  // This chat as one of the agent's: pinned, archived, or the main one.
  const listed = useAgentChatList(id ? agentId : undefined)
  const shelved = useArchivedChats(id && listed.filing ? agentId : undefined).data
  const stored = id ? (listed.data?.find((c) => c.id === id) ?? shelved?.find((c) => c.id === id)) : undefined
  const act = useChatActions(agentId)
  const [renaming, setRenaming] = useState<AgentChat | null>(null)

  const post = (text: string, files: File[] = []) => {
    // Talking in an archived chat again brings it back among the rest.
    if (stored?.archived) void act.unarchive(stored)
    return id ? send(id, text, files) : start(text, files)
  }
  // A question asked from elsewhere (the Apps sheet) opens this blank chat as if typed.
  const opening = isDraft && agent && !starting
  useEffect(() => {
    if (!opening) return
    const text = takeOpeningLine(agentId)
    if (text) void post(text)
    // Only when the blank chat first shows for this agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, agentId])

  // The agent's apps, passwords and cards, from the composer's +: each opens over the chat, and an app's
  // question to try is asked here. Apps' "Add a login" opens Passwords over the chat too.
  const [appsSheet, setAppsSheet] = useState(false)
  const appsItem = useAppsPlusItem(agent, () => setAppsSheet(true))
  const [vaultSheet, setVaultSheet] = useState(false)
  const [adding, setAdding] = useState<{ kind: VaultKind; site?: string }>()
  const vaultItems = useVaultPlusItems(agent, (start) => {
    if (start) setAdding({ kind: start })
    setVaultSheet(true)
  })
  const ask = (question: string) => (busy ? fill(question) : void post(question))

  const onSend = (text: string, files: File[]) => {
    if (rewrite && id && !files.length) {
      setRewrite(null)
      resend(id, rewrite, text).catch(() => {
        toast.error('Couldn’t send your edit. Try again.')
        fill(text)
      })
      return
    }
    setRewrite(null)
    return post(text, files)
  }

  // Slash commands.
  const catalog = useCatalog(agent ? agentId : undefined)
  const commands = useMemo(
    () =>
      commandList(
        id
          ? (['new', 'btw', 'model', 'think', 'retry', 'undo', 'rename', 'goal', 'stop'] satisfies CommandName[])
          : (['new', 'model', 'think'] satisfies CommandName[]),
      ),
    [id],
  )
  const [modelSheet, setModelSheet] = useState(false)
  // How full this chat is and what it's cost: a ring once it's past half, a sheet from it or the menu.
  const usage = useChatUsage(chat).data
  const [info, setInfo] = useState(false)
  const thinkingDefault = useThinkingDefault(agentId).data
  const thinking = thinkingOf(effort, thinkingDefault)
  const qc = useQueryClient()

  const onCommand = (raw: string, arg: string): boolean | void => {
    const name = raw.toLowerCase()
    const later = () => {
      toast(`Send a message first, then try /${name}.`)
      return false
    }
    const oops = (fallback: string) => (e: unknown) =>
      toast.error(e instanceof Error && /wait for/i.test(e.message) ? e.message : fallback)
    if (isCurated(name)) {
      switch (name) {
        case 'new':
          return newChat()
        case 'model':
          return setModelSheet(true)
        case 'think': {
          const level = (['auto', 'quick', 'deep', 'max'] as const).find((t) => t === arg.toLowerCase())
          if (level) return onThinking(level)
          if (arg) toast('Try /think quick, deep, max or auto.')
          fill('/think ')
          return false
        }
        case 'stop':
          if (!id) return later()
          return void stop(id)
        case 'retry':
          if (!id) return later()
          if (busy) return void toast('Wait for the reply to finish, then try again.')
          return void regenerate(id).catch(oops('Couldn’t try again. Try once more in a moment.'))
        case 'undo':
          if (!id) return later()
          setRewrite(null)
          return void undo(id).then((text) => {
            if (text === undefined) return void toast('Nothing to undo yet.')
            if (text) fill(text)
            toast('Took back your last message.')
          }, oops('Couldn’t undo that. Try again.'))
        case 'rename':
          if (!id) return later()
          if (!arg) {
            toast('Add a title after /rename.')
            return false
          }
          return void renameChat(id, arg).then(
            () => {
              void qc.invalidateQueries({ queryKey: ['chats', agentId] })
              toast.success(`Renamed to “${arg}”`)
            },
            (e) =>
              titleTaken(e)
                ? toast.error(`Another chat is already called “${arg}”.`)
                : oops('Couldn’t rename this chat. Try again.')(e),
          )
        case 'btw':
          if (!id) return later()
          if (!arg) {
            toast('Add your question after /btw.')
            return false
          }
          return void askAside(id, arg)
        case 'goal':
          if (!id) return later()
          return void runSlash(id, `/goal ${arg}`.trim())
      }
    }
    // Anything else goes to Hermes as typed, if it knows the command.
    const known = catalog.data?.canon.get(name)
    if (catalog.data && !known) {
      toast.error(`There’s no /${name} command. Type / to see what you can do.`)
      return false
    }
    if (known && catalog.data?.elsewhere.has(known)) {
      toast(`/${name} isn’t available in Murmur.`)
      return false
    }
    if (!id) return later()
    void runSlash(id, `/${name}${arg ? ` ${arg}` : ''}`).then((r) => r.prefill && fill(r.prefill))
  }

  const onGoal = (action: 'pause' | 'resume' | 'clear') => {
    if (!id) return
    runSlash(id, `/goal ${action}`, { quiet: true }).then(
      () =>
        toast(action === 'clear' ? 'Goal cleared.' : action === 'pause' ? 'Goal paused.' : 'Back to work on the goal.'),
      () => toast.error('Couldn’t change the goal. Try again.'),
    )
  }

  // Reading a reply aloud stops when you leave its chat.
  useEffect(
    () => () => {
      if (useSpeech.getState().key?.startsWith(`${id ?? ''}:`)) stopSpeaking()
    },
    [id],
  )

  // Files and widgets in the thread load from this chat's agent; widgets
  // talk back through hidden turns.
  const turns = chat?.turns
  const media = useMemo<MediaContext>(
    () => ({
      sessionId: id,
      profile: agentId,
      revision: turns ?? 0,
      onWidgetSend: id ? (prompt) => sendHidden(id, prompt) : undefined,
    }),
    [id, agentId, turns],
  )

  const onPick = (next: ModelPick) => {
    if (!id) return setDraftPick(next)
    setChatModel(id, next.model, next.provider).catch(() => toast.error('Couldn’t switch models. Try again.'))
  }
  const onThinking = (t: Thinking) => {
    if (!id) return setDraftEffort(t === 'auto' ? undefined : EFFORT[t])
    const task = t === 'auto' ? resetChatReasoning(id) : setChatReasoning(id, EFFORT[t])
    task.catch(() => toast.error('Couldn’t change thinking. Try again.'))
  }

  const speaker = useMemo(() => agent && speakerOf(agent), [agent])
  const root = useRef<HTMLDivElement>(null)
  const scrolled = useScrolled(root, id)

  // Esc stops the reply (listed as "Stop reply" in src/features/commands/shortcuts.tsx),
  // unless it's closing something first: a sheet, a menu, the palette, an edit, dictation.
  const stopNow = useRef<() => void>(undefined)
  stopNow.current = busy ? (id ? () => void stop(id) : starting ? () => (stopEarly.current = true) : undefined) : undefined
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !stopNow.current) return
      // (Where the key was pressed: something elsewhere may have just let go of focus.)
      const at = e.target instanceof Node ? e.target : null
      if (at && at !== document.body && at !== document.documentElement && !root.current?.contains(at)) return
      if (document.querySelector('[data-sheet][data-state="open"], [role="menu"], [role="dialog"], [role="listbox"]')) return
      e.preventDefault()
      stopNow.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const newChat = () => navigate(`/chat/${agentId}/new`)
  // The agent's own page holds its other chats, routines, memory and settings.
  const openAgent = () => navigate(`/agent/${agentId}`)
  const goal = chat?.goal
  // What's going on in the rest of Murmur while you're in here, as far as
  // Back leads: Home, or this agent's page when the chat was opened from it.
  const [location] = useLocation()
  const up = useUpFrom(location)
  const backToAgent = up !== '/'
  const elsewhere = useElsewhere(id, backToAgent ? agentId : undefined)

  // Copy or share the whole chat.
  const hasMessages = items.some((i) => i.kind === 'user' || i.kind === 'assistant')
  // Then pin, rename, archive or delete it, as from its line in the lists. Archived or
  // deleted, it's left for the list it was in (on a wide screen, the agent's main chat).
  const options = stored
    ? chatOptions(stored, act, {
        filing: listed.filing,
        rename: setRenaming,
        leave: () => navigate(wide ? act.away(stored) : up),
      }).menu
    : []
  const menu = useChatMenu(
    () => {
      if (!agent || !hasMessages) return
      const all = id ? (getChat(id)?.items ?? items) : items
      const title = name || `Chat with ${agent.name}`
      return { title, text: transcript(all, { title, agent: agent.name }) }
    },
    id
      ? [
          { label: 'Chat info', icon: Gauge, onSelect: () => setInfo(true) },
          ...options.map((o, i) => ({
            label: o.label,
            icon: o.icon,
            onSelect: o.run,
            danger: o.danger,
            section: i === 0,
          })),
        ]
      : [],
  )

  if (agents.isSuccess && !agent)
    return (
      <div className="grid h-dvh place-items-center bg-bg">
        <NotFound
          title="This agent isn’t here anymore"
          body="It may have been deleted. Pick another agent to keep chatting."
          action="All agents"
          onAction={() => navigate('/', { replace: true })}
        />
      </div>
    )

  return (
    // Under reduced motion, everything in the chat crossfades instead of moving.
    <MotionConfig reducedMotion="user">
      <div
        ref={root}
        className="hue-scope relative flex h-dvh flex-col overflow-hidden bg-bg"
        style={{ '--hue': agent?.hue ?? 278, height: inset ? `calc(100dvh - ${inset}px)` : undefined } as CSSProperties}
      >
        {/* The agent's colour, barely there, behind the header. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,var(--accent-soft),transparent)] opacity-80 transition-opacity duration-700"
        />

        {/* The screen's heading, for finding your way by headings; the header shows the name.
            (A chat that's gone has its own.) */}
        {!openError && <h1 className="sr-only">{agent ? `Chat with ${agent.name}` : 'Chat'}</h1>}

        <ChatHeader
          agent={agent}
          orb={orb}
          subtitle={subtitle}
          showBack={!wide}
          scrolled={scrolled}
          onNewChat={newChat}
          onOpenAgent={openAgent}
          vibes={chat?.vibes}
          below={<GoalChip goal={goal} onAction={onGoal} />}
          backBadge={<BackBadge unread={elsewhere.unread} waiting={elsewhere.waiting} />}
          backHint={backHint(elsewhere.unread, elsewhere.waiting)}
          menu={wide && hasMessages && <ChatMenuButton menu={menu} />}
          titleProps={hasMessages ? menu.hold : undefined}
        />

        <Thread
          // A fresh thread per chat, except the one just started here: it carries on in place.
          key={id && id !== born.current ? id : 'new'}
          items={items}
          busy={busy}
          agent={speaker}
          onOlder={id && chat?.older ? () => loadOlder(id) : undefined}
          lead={
            id && agent && runOfChat ? (
              <RunHeader
                agent={agent}
                chatId={id}
                routineId={runOfChat.routineId}
                title={chat?.title}
                ranAt={run.ranAt}
              />
            ) : undefined
          }
          media={media}
          // The header floats over the messages; they scroll up beneath it.
          className={
            goal
              ? 'flex-1 [&_[role=log]]:pt-[calc(6rem+env(safe-area-inset-top))]'
              : 'flex-1 [&_[role=log]]:pt-[calc(3.5rem+env(safe-area-inset-top))]'
          }
          emptyState={
            openError ? (
              <NotFound
                hue={agent?.hue}
                title="This chat isn’t here anymore"
                body="It may have been deleted. You can start a new one."
                action="New chat"
                onAction={newChat}
              />
            ) : agent && (isDraft || (chat?.ready && !busy)) ? (
              <EmptyState agent={agent} orb={typing ? 'listening' : 'idle'} onStart={(prompt) => post(prompt)} />
            ) : id && !chat?.ready ? (
              <ThreadSkeleton stalled={chat?.stalled} onRetry={readUnread} />
            ) : null
          }
          onApprove={(requestId, choice) => id && answerApproval(id, requestId, choice)}
          onAnswer={(requestId, answers) => id && answerQuestion(id, requestId, answers)}
          onSecret={(requestId, value) => id && answerSecret(id, requestId, value)}
          // A fresh reply to the message Hermes already saved, rather than a second copy of it.
          onRetry={id ? () => void regenerate(id).catch(() => toast.error('Couldn’t try again. Try once more in a moment.')) : undefined}
          onErrorAction={(action) => {
            if (action === 'models') return navigate('/settings/models')
            if (action === 'continue-here' && id) {
              return void continueHere(id)
                .then((copy) => copy && navigate(`/chat/${agentId}/${copy}`, { replace: true }))
                .catch(() => toast.error('Couldn’t copy this chat. Try again.'))
            }
            newChat()
          }}
          editableId={editable?.id}
          editingId={rewrite ?? undefined}
          onEdit={onEditMessage}
          onDismiss={id ? (itemId) => dismissItem(id, itemId) : undefined}
          onReact={id ? (itemId, emoji) => void react(id, itemId, emoji).catch(() => toast.error('Couldn’t react to that. Try again.')) : undefined}
          onStopHelper={id ? (helper) => void stopHelper(id, helper).catch(() => toast.error('Couldn’t stop that helper. Try again.')) : undefined}
          footer={
            <Composer
              handle={composer}
              files
              onSend={onSend}
              onStop={id ? () => void stop(id) : starting ? () => (stopEarly.current = true) : undefined}
              busy={busy}
              disabled={!agent || openError}
              placeholder={agent ? `Message ${clip(agent.name)}` : 'Message'}
              draftKey={id ?? `${agentId}:new`}
              // Ready to type on arrival, at any window size; on a phone, the keyboard waits for a tap.
              autoFocus={fine}
              commands={commands}
              extraCommands={id ? catalog.data?.commands : undefined}
              onCommand={onCommand}
              commandCurrent={{ think: thinking }}
              editing={!!rewrite}
              onCancelEdit={cancelRewrite}
              onTypingChange={setTyping}
              voice={agentId}
              above={(text) => (
                <>
                  {agent && <ChatConnectCard runtimeId={chat?.runtimeId} agent={agent} />}
                  {umbrelKey.above(text)}
                </>
              )}
              onBeforeSend={umbrelKey.beforeSend}
              more={appsItem && [appsItem, ...vaultItems]}
              accessory={
                agent && (
                  <>
                    <ModelChip
                      agent={agent}
                      pick={pick}
                      effort={effort}
                      onPick={onPick}
                      onThinking={onThinking}
                      open={modelSheet}
                      onOpenChange={setModelSheet}
                    />
                    <ContextRing usage={usage} onClick={() => setInfo(true)} />
                  </>
                )
              }
            />
          }
        />

        <ChatMenu menu={menu} />
        {agent && (
          <RenameChatSheet
            agent={agent}
            chat={renaming}
            onClose={() => setRenaming(null)}
            onRename={(title) => act.rename(renaming!, title)}
          />
        )}
        {agent && <ChatInfoSheet open={info} onOpenChange={setInfo} agent={agent} usage={usage} runtimeId={chat?.runtimeId} />}
        {agent && (
          <AppsSheet
            agent={agent}
            open={appsSheet}
            onOpenChange={setAppsSheet}
            onAddLogin={(site) => {
              setAppsSheet(false)
              setAdding({ kind: 'login', site })
              setVaultSheet(true)
            }}
            onAsk={ask}
          />
        )}
        {agent && <VaultSheet agent={agent} open={vaultSheet} onOpenChange={setVaultSheet} adding={adding} />}

        <DropZone
          disabled={!agent || !!starting}
          label={agent ? `Send to ${agent.name}` : 'Drop to attach'}
          onFiles={(files) => composer.current?.addFiles(files)}
        />

      </div>
    </MotionConfig>
  )
}

/** Whether the thread (inside `root`) has content scrolled beneath the header. */
function useScrolled(root: RefObject<HTMLElement | null>, key?: string) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const log = root.current?.querySelector('[role=log]')
    if (!log) return
    const update = () => setScrolled(log.scrollTop > 2)
    update()
    log.addEventListener('scroll', update, { passive: true })
    return () => log.removeEventListener('scroll', update)
  }, [root, key])
  return scrolled
}

/**
 * The store tags items with who said them (for groups); one-to-one, the name
 * would just repeat. Each item keeps its untagged copy, so while a reply
 * streams only the item that changed is new and the rest of the thread stays put.
 */
const untagged = new WeakMap<ChatItem, ChatItem>()
function solo(i: ChatItem) {
  if (!('speaker' in i) || !i.speaker) return i
  let out = untagged.get(i)
  if (!out) untagged.set(i, (out = { ...i, speaker: undefined }))
  return out
}
function useSolo(items: ChatItem[]) {
  return useMemo(() => items.map(solo), [items])
}

/** Short enough for one line of the composer's placeholder (textareas can't ellipsize it). */
const clip = (name: string) => (name.length > 22 ? `${name.slice(0, 21).trimEnd()}…` : name)

const agentPick = (agent?: Agent): ModelPick | undefined =>
  agent?.model && agent.provider ? { model: agent.model, provider: agent.provider } : undefined
