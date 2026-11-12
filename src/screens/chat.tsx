import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useLocation } from 'wouter'
import { MotionConfig } from 'motion/react'
import { Info } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Thread } from '@/features/chat/thread'
import { RunHeader, useRunItems } from '@/features/routines/run-view'
import { useChatName } from '@/features/chat-screen/chat-name'
import { Composer, type ComposerHandle } from '@/features/chat/composer'
import { newChatDraft } from '@/features/chat/use-draft'
import { DropZone } from '@/features/chat-screen/drop-zone'
import type { MediaContext } from '@/features/media/context'
import type { ChatItem } from '@/features/chat/types'
import { ChatHeader } from '@/features/chat-screen/chat-header'
import { EmptyState } from '@/features/chat-screen/empty-state'
import { ContinuedFrom } from '@/features/chat-screen/continued'
import { splitQuote } from '@/features/media/parse'
import { takeOpeningLine } from '@/features/chat-screen/opening-line'
import { CantOpen, LastSeen, NotFound } from '@/features/chat-screen/not-found'
import { ThreadSkeleton } from '@/features/chat-screen/thread-skeleton'
import { useOrbState } from '@/features/chat-screen/use-orb-state'
import { GoalChip } from '@/features/chat-screen/goal-chip'
import { StillRunning } from '@/features/chat-screen/still-running'
import { useLoved } from '@/features/chat-screen/hearts'
import { BackBadge, backHint, useElsewhere } from '@/features/chat-screen/elsewhere'
import { ChatMenu, ChatMenuButton, useChatMenu } from '@/features/chat-screen/chat-menu'
import { ChatInfoSheet } from '@/features/chat-screen/chat-info'
import { FindBar, useFind, type Spot } from '@/features/chat-screen/find-bar'
import { useAgentChatList, useArchivedChats, useChatActions, type AgentChat } from '@/features/agent-page/chats'
import { chatOptions } from '@/features/agent-page/chat-list'
import { RenameChatSheet } from '@/features/agent-page/rename-chat'
import { transcript } from '@/features/chat-screen/transcript'
import { ModelChip } from '@/features/model/model-chip'
import { EFFORT, thinkingOf, type Thinking } from '@/features/model/names'
import { useThinkingDefault, type ModelPick } from '@/features/model/use-models'
import { commandList, isCurated, type CommandName } from '@/features/commands/commands'
import { isMac } from '@/features/commands/shortcuts'
import { useCatalog } from '@/features/commands/use-catalog'
import { useUmbrelKey } from '@/features/chat/umbrel-key'
import { ChatConnectCard } from '@/features/chat/connect-card'
import { AppsSheet } from '@/features/apps'
import { useAppsPlusItem } from '@/features/apps/plus-item'
import { VaultSheet } from '@/features/vault'
import { useVaultPlusItems } from '@/features/vault/plus-items'
import { stopSpeaking, useSpeech } from '@/features/voice/speech'
import { TalkCall } from '@/features/talk/call'
import { endCall, setMinimized, startCall, switchVoice, useTalk, type CallPlan } from '@/features/talk/talk'
import { micSupported } from '@/features/talk/mic'
import { SecureSheet } from '@/features/talk/secure-sheet'
import { CallButton } from '@/features/talk/call-button'
import { VoiceSheet } from '@/features/talk/voice-sheet'
import {
  VOICE_NAMES,
  agentLanguage,
  chooseVoice,
  engineOf,
  pickVoice,
  useVoice,
  useVoiceRefresh,
  type AutoVoice,
  type Voice,
} from '@/features/talk/voice-setup'
import { useConnection } from '@/hermes/gateway'
import { useAway } from '@/state/reach'
import { useChatUsage } from '@/state/insights'
import { useRunOf } from '@/state/routines'
import { placeFindings, useChatFindings } from '@/state/findings'
import type { VaultKind } from '@/state/vault'
import { useFinePointer, useIsWide } from '@/lib/use-media'
import { useArrival, useUpFrom } from '@/lib/transitions'
import {
  answerApproval,
  answerQuestion,
  answerSecret,
  askAside,
  attachmentsOf,
  canContinue,
  ContinueError,
  continueFrom,
  continueHere,
  createChat,
  dismissItem,
  getChat,
  editableMessage,
  heldBack,
  leaveChat,
  loadOlder,
  loadWhole,
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
  stopRunning,
  titleTaken,
  undo,
  useChats,
  watchRunning,
} from '@/state/chats'
import {
  BOT_CHAT,
  MAIN_CHAT,
  readable,
  speakerOf,
  useAgentChats,
  useAgentGone,
  useAgents,
  type Agent,
} from '@/state/agents'
import { doneSeeking, findOlder, findRead, matchOf, seekSaid, useSeek } from '@/state/seek'

const NONE: ChatItem[] = []
/** How long the thread takes to settle on the reply a chat is carried on from (CUT_MS in thread.tsx), and a breath. */
const SETTLE_MS = 360

/** Why a chat couldn't be carried on in a new one, said plainly. */
function cantContinue(e: unknown) {
  const why = e instanceof ContinueError ? e.why : 'failed'
  if (why === 'summarized') return 'That part of the chat has been summarized, so a new chat can’t pick up from it. Try a later reply.'
  if (why === 'large') return 'This chat is too long to carry into a new one.'
  return 'Couldn’t continue in a new chat. Check that Hermes is running, then try again.'
}

// One agent, one conversation. /chat/:agent opens the latest chat (or a new
// one), /chat/:agent/new is a blank chat that Hermes only creates on the first
// message, and /chat/:agent/:id is a stored chat.


export function ChatScreen({ agentId, chatId }: { agentId: string; chatId?: string }) {
  const agents = useAgents()
  const agent = agents.data?.find((a) => a.id === agentId)
  const gone = useAgentGone(agentId)
  const [, navigate] = useLocation()
  const wide = useIsWide()
  const fine = useFinePointer()

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
  // What the agent started and left going is kept current while its chat is on screen.
  useEffect(() => (id ? watchRunning(id) : undefined), [id])

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
  // A routine's run reads as a report, under what the routine is.
  const runOfChat = useRunOf(agentId, id)
  const run = useRunItems(runOfChat, useSolo(chat?.items ?? (starting ? [starting] : [])))
  // Asleep while nothing of the agent can be reached (state/reach.ts).
  const away = useAway()
  const online = useConnection((s) => s.state === 'open' || !s.everOpened) && !away
  // Your message is waiting for the connection: Hermes hasn't got it, so nothing's thinking about it yet.
  const connected = useConnection((s) => s.state === 'open')
  const held = !connected && !!run.items.findLast((i) => i.kind === 'user' && i.pending)
  const busy = (status === 'thinking' || status === 'working' || status === 'waiting') && !held
  // What the routines set up here have found since, each where it came in.
  const findings = useChatFindings(
    agentId,
    runOfChat === null ? id : undefined,
    useMade(chat?.items),
    chat?.older ? (chat.items.find((i) => i.kind === 'user')?.at ?? 0) : 0,
  )
  const items = useMemo(() => placeFindings(run.items, findings, busy), [run.items, findings, busy])
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

  // Ready to type whenever you arrive, at any window size; on a phone, the keyboard waits
  // for a tap. Arriving is the cue, not a fresh composer: New chat from a blank chat, or
  // from one just started (which carries on in place), keeps the composer it has.
  const arrival = useArrival()
  // Hermes has the chat but won't open it yet: it's being tried again, and says so meanwhile.
  const shut = !!chat?.ready && !!chat.stalled
  const typable = !!agent && !openError && !shut
  useEffect(() => {
    if (fine && typable) composer.current?.focus()
  }, [arrival, fine, typable])

  // Messages still waiting on Hermes when this page last closed never got
  // there: their words come back in the box, ahead of anything typed since.
  const ready = !!chat?.ready
  useEffect(() => {
    if (!id || !ready) return
    const back = heldBack(id)
    if (!back.length) return
    const box = composer.current
    box?.setText([...back.map((m) => m.text), box.text()].filter((t) => t.trim()).join('\n\n'))
    const files = back.flatMap((m) => m.files ?? [])
    const names = files.length > 1 ? `${files.slice(0, -1).join(', ')} and ${files.at(-1)}` : files[0]
    const said = back.length > 1 ? 'Your messages didn’t reach Hermes. They’re' : 'Your message didn’t reach Hermes. It’s'
    toast(`${said} ready to send again.`, {
      description: names && `Attach ${names} again to send ${files.length > 1 ? 'them' : 'it'} too.`,
    })
  }, [id, ready])

  // A search result opens at the message it was found in, once the chat is
  // read, with the words it was found by marked. One further back waits
  // behind the skeleton while it's read to.
  const wanted = useSeek(id)
  const [focus, setFocus] = useState<{ chat?: string; id: string; at: number; words?: string[]; spot?: Spot }>()
  if (focus && focus.chat !== id) setFocus(undefined)
  const [seeking, setSeeking] = useState<string>()
  useLayoutEffect(() => {
    if (!id || !ready || !wanted) return
    doneSeeking(id)
    const words = matchOf(wanted)
    const read = findRead(id, wanted)
    if (read.id) setFocus({ chat: id, id: read.id, at: Date.now(), words })
    if (!read.more) return
    setSeeking(id)
    void findOlder(id, wanted).then((found) => {
      if (found) setFocus({ chat: id, id: found, at: Date.now(), words })
      setSeeking((s) => (s === id ? undefined : s))
    })
  }, [id, ready, wanted])
  const reading = !!id && seeking === id

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
  /** A message back in the box: the passage it answers above, its words under it. */
  const refill = (message: string) => {
    const { quote, text } = splitQuote(message)
    composer.current?.setQuote(quote ?? '')
    composer.current?.setText(text)
    composer.current?.focus()
  }
  const onEditMessage = useCallback((item: { id: string; text: string }) => {
    setRewrite(item.id)
    const { quote, text } = splitQuote(item.text)
    composer.current?.setQuote(quote ?? '')
    composer.current?.setText(text)
    composer.current?.focus()
  }, [])
  const cancelRewrite = () => {
    setRewrite(null)
    composer.current?.setQuote('')
    composer.current?.setText('')
  }
  // Reply to a part of what the agent said: the passage waits above the box for your words.
  const onQuote = useCallback((passage: string) => {
    composer.current?.setQuote(passage)
    composer.current?.focus()
  }, [])

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
        refill(text)
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
  // What the agent remembers of this chat and what it's cost, in a sheet from the menu.
  const usage = useChatUsage(chat).data
  const [info, setInfo] = useState(false)
  // From the chat itself: Hermes's own count (`compressions`) goes up for a summary it then refuses.
  const summarized = useMemo(
    () => !!chat?.summarized || items.some((i) => i.kind === 'compaction' && i.status === 'done'),
    [chat?.summarized, items],
  )
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
            if (text) refill(text)
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

  // Continue in a new chat, under a reply: the chat up to there becomes one of its own, and
  // you're in it. While it's made, what came after the reply falls away; if it can't be, it
  // all comes back and you're where you were. Offered where this Hermes can do it, and not in
  // a routine's run, which is a report.
  const canCarryOn = useQuery({ queryKey: ['can-continue-chats'], queryFn: canContinue, staleTime: Infinity, retry: false }).data
  const [cut, setCut] = useState<{ chat: string; item: string }>()
  /** The chat made that way just now: its "Continued from" line opens into place. */
  const [continued, setContinued] = useState<string>()
  const carryOn = (itemId: string) => {
    if (!id || cut) return
    setCut({ chat: id, item: itemId })
    const settled = new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    continueFrom(id, itemId)
      .then(async (copy) => {
        await settled
        setContinued(copy)
        void qc.invalidateQueries({ queryKey: ['chats', agentId] })
        navigate(`/chat/${agentId}/${copy}`)
      })
      .catch((e) => toast.error(cantContinue(e)))
      .finally(() => setCut(undefined))
  }
  // Where this chat was carried on from, and the way back: to that chat, at the reply it left from.
  const from = chat?.from
  const backToOrigin = () => {
    if (!from) return
    const left = chat.items.findLast((i) => i.kind === 'assistant' && i.at < from.at)
    if (left?.kind === 'assistant') seekSaid(from.id, { at: left.at, text: left.text })
    navigate(`/chat/${agentId}/${from.id}`)
  }

  // A call with the agent, over this chat. Every turn lands in the thread.
  // (A call started in a blank chat carries on into the chat its first turn makes.)
  const ours = (s: { chatId?: string; profile?: string }) =>
    s.profile === agentId &&
    (s.chatId ? s.chatId === id || s.chatId === born.current : isDraft || (!!id && id === born.current))
  const talkOpen = useTalk((s) => s.open && !s.minimized && ours(s))
  const inCall = useTalk((s) => s.open && ours(s))
  const [secure, setSecure] = useState(false)
  const talkVoice = useVoice(agent ? agentId : undefined)
  const [voiceSheet, setVoiceSheet] = useState<'start' | 'change' | null>(null)
  const refreshVoice = useVoiceRefresh()
  /** How a call with this voice listens and speaks; null when a voice someone chose can't speak. */
  const planFor = (v: Voice): CallPlan | null => {
    // Nobody has picked a voice (or Murmur did): the best this Hermes already has, saved as it connects.
    if (v.unset || v.auto) {
      const [choice, ...rest] = pickVoice(v, agent?.provider)
      // Nothing here can talk yet: the sheet says what's missing.
      if (!choice) return null
      const save = async (c: AutoVoice) => {
        if (c === 'own') return
        await chooseVoice(agentId, c, { auto: true, language: agentLanguage(v) }).catch(() => {})
        void refreshVoice(agentId)
      }
      // (Already this voice: nothing to save.)
      const setup = choice === v.choice && v.ready ? Promise.resolve() : save(choice)
      return {
        engine: engineOf(choice),
        stream: choice === 'local' && !!v.plugin,
        fallbackStream: !!v.plugin,
        keeps: !!v.plugin,
        fallbacks: rest.map(engineOf),
        // After the first choice's own save, so the fallback is the one Hermes keeps.
        onFallback: (engine) => setup.then(() => save(rest.find((c) => engineOf(c) === engine)!)),
        setup,
      }
    }
    return v.ready ? { engine: engineOf(v.choice), stream: v.choice === 'local' && !!v.plugin, keeps: !!v.plugin } : null
  }
  const onCall = (from: { x: number; y: number }) => {
    if (!agent) return
    // Browsers only lend the microphone to secure pages.
    if (!micSupported()) return setSecure(true)
    const v = talkVoice.data
    // Hermes hasn't said yet how this agent talks (it's slow just after it starts): the call opens
    // now, since the tap is what lets it make sound, and finds its voice when the answer's in.
    if (!v)
      return call(
        from,
        talkVoice.refetch().then(({ data }) => {
          const plan = data ? planFor(data) : null
          if (!plan) setVoiceSheet('start')
          return plan
        }),
      )
    const plan = planFor(v)
    // A voice someone chose that can't speak asks for another.
    if (!plan) return setVoiceSheet('start')
    call(from, plan)
  }
  const call = (from: { x: number; y: number }, plan: CallPlan | Promise<CallPlan | null>) => {
    if (!agent) return
    startCall({
      ...(plan instanceof Promise ? { plan } : plan),
      chatId: id,
      profile: agentId,
      origin: from,
      name: agent.name,
      newChat: id
        ? undefined
        : async () => {
            const newId = await createChat(agentId, { speaker: speakerOf(agent), ...draftPick, reasoning: draftEffort })
            born.current = newId
            navigate(`/chat/${agentId}/${newId}`, { replace: true })
            return newId
          },
    })
  }
  // Leaving the chat hangs up (and lets go of the microphone).
  const mine = useRef(ours)
  mine.current = ours
  useEffect(
    () => () => {
      const s = useTalk.getState()
      if (s.open && mine.current(s)) endCall()
    },
    [agentId],
  )
  useEffect(() => {
    const s = useTalk.getState()
    if (s.open && s.chatId && s.chatId !== id && s.chatId !== born.current) endCall()
  }, [id])
  // Reopened over HTTPS from the sheet: one tap from the call.
  const [resumed, setResumed] = useState(false)
  useEffect(() => {
    if (window.location.hash !== '#talk' || !agent) return
    history.replaceState(null, '', window.location.pathname + window.location.search)
    if (micSupported()) setResumed(true)
  }, [agent])
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
  // A long chat is read a page at a time: finding in it, or taking it with you, reads the rest.
  const whole = useMemo(() => (id && chat?.older ? () => loadWhole(id) : undefined), [id, chat?.older])
  // Find in chat: each place comes into sight in the thread, which marks nothing itself.
  const asked = useRef(0)
  const find = useFind({
    chat: `${agentId}/${id && id !== born.current ? id : 'new'}`,
    items,
    root,
    whole,
    show: (itemId, spot) => {
      // (Asked again, even within the same millisecond, it's asked anew.)
      asked.current = Math.max(Date.now(), asked.current + 1)
      setFocus({ chat: id, id: itemId, at: asked.current, spot })
    },
  })
  const doneFinding = () => {
    find.done()
    if (fine) composer.current?.focus()
  }
  const menu = useChatMenu({
    text: () => {
      if (!agent || !hasMessages) return
      const all = id ? (getChat(id)?.items ?? items) : items
      const title = name || `Chat with ${agent.name}`
      return { title, text: transcript(all, { title, agent: agent.name }) }
    },
    whole,
    find: find.start,
    more: id
      ? [
          { label: 'Chat info', icon: Info, onSelect: () => setInfo(true) },
          ...options.map((o, i) => ({
            label: o.label,
            icon: o.icon,
            onSelect: o.run,
            danger: o.danger,
            section: i === 0,
          })),
        ]
      : [],
  })

  // ⌘F finds in the chat, since the browser's own Find only reads the messages drawn near where
  // you are. Pressed again from the field it's the browser's after all. ⌘G and ⇧⌘G step, as Enter
  // does, and Esc puts it away (before it would stop a reply).
  const finding = useRef({ find, hasMessages, doneFinding })
  finding.current = { find, hasMessages, doneFinding }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const { find, hasMessages, doneFinding } = finding.current
      // (A sheet or a menu that's up has the keys.)
      const over = () =>
        !!document.querySelector(
          '[data-sheet][data-state="open"], [role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]',
        )
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      const key = e.key.toLowerCase()
      if (key === 'escape' && find.open && !mod && !over()) {
        e.preventDefault()
        doneFinding()
      } else if (mod && !e.altKey && !e.shiftKey && key === 'f') {
        if (!hasMessages || (find.open && document.activeElement === find.input.current) || over()) return
        e.preventDefault()
        find.start()
      } else if (mod && !e.altKey && key === 'g' && find.open && !over()) {
        e.preventDefault()
        if (e.shiftKey) find.newer()
        else find.older()
      }
    }
    // (Ahead of the page's own keys: Esc here isn't Stop.)
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (gone)
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
        // With the keyboard up, the chat is what's left above it.
        className="hue-scope relative flex h-dvh flex-col overflow-hidden bg-bg talk-under keyboard:h-[calc(100dvh-var(--keyboard))]"
        data-talk={talkOpen || undefined}
        style={{ '--hue': agent?.hue ?? 278 } as CSSProperties}
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
          call={agent && <CallButton name={agent.name} live={inCall} disabled={openError} onCall={onCall} />}
          titleProps={hasMessages ? menu.hold : undefined}
          find={find.open && <FindBar find={find} onDone={doneFinding} />}
        />

        <Thread
          // A fresh thread per chat, except the one just started here: it carries on in place.
          key={id && id !== born.current ? id : 'new'}
          items={reading ? NONE : items}
          busy={busy && !reading}
          focus={focus?.chat === id ? focus : undefined}
          agent={speaker}
          onOlder={id && chat?.older ? () => loadOlder(id) : undefined}
          waiting={!connected}
          lead={
            id && agent && runOfChat ? (
              <RunHeader
                agent={agent}
                chatId={id}
                routineId={runOfChat.routineId}
                title={chat?.title}
                ranAt={run.ranAt}
              />
            ) : id && from && runOfChat === null ? (
              <ContinuedFrom
                name={from.title === BOT_CHAT ? MAIN_CHAT : readable(from.title, { files: false })}
                fresh={id === continued}
                onOpen={backToOrigin}
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
            reading ? (
              <ThreadSkeleton />
            ) : openError ? (
              <NotFound
                hue={agent?.hue}
                title="This chat isn’t here anymore"
                body="It may have been deleted. You can start a new one."
                action="New chat"
                onAction={newChat}
              />
            ) : shut ? (
              <NotFound
                hue={agent?.hue}
                title="Can’t open this chat right now"
                body="Something got in the way. Try again in a moment."
                action="Try again"
                onAction={readUnread}
              />
            ) : agent && (isDraft || (chat?.ready && !busy)) ? (
              <EmptyState agent={agent} orb={!online ? 'offline' : typing ? 'listening' : 'idle'} onStart={(prompt) => post(prompt)} />
            ) : id && away && chat?.unkept && !chat.ready ? (
              // Out of reach, and not one this device kept: nothing to try, it comes by itself.
              <NotFound
                hue={agent?.hue}
                title="This chat isn’t on this device"
                body={`It’ll be here as soon as ${agent ? clip(agent.name) : 'your agent'} is back in reach.`}
              />
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
          onContinue={id && canCarryOn && runOfChat === null ? carryOn : undefined}
          cut={cut && cut.chat === id ? cut.item : undefined}
          onQuote={typable ? onQuote : undefined}
          footer={
            <Composer
              handle={composer}
              files
              onSend={onSend}
              onStop={id ? () => void stop(id) : starting ? () => (stopEarly.current = true) : undefined}
              busy={busy}
              disabled={!typable}
              placeholder={agent ? `Message ${clip(agent.name)}` : 'Message'}
              draftKey={id ?? newChatDraft(agentId)}
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
                  {shut && !!chat?.items.length && <CantOpen onRetry={readUnread} />}
                  <StillRunning
                    // While it's replying the agent is plainly at work; this is for after. Out of reach, it can't be told or stopped.
                    running={busy || away ? undefined : chat?.running}
                    stopping={chat?.stopping}
                    onStop={() => id && void stopRunning(id).catch(() => toast.error('Couldn’t stop that. Try again.'))}
                  />
                  {!!chat?.asOf && <LastSeen at={chat.asOf} />}
                  {agent && <ChatConnectCard runtimeId={chat?.runtimeId} agent={agent} />}
                  {umbrelKey.above(text)}
                </>
              )}
              onBeforeSend={umbrelKey.beforeSend}
              more={appsItem && [appsItem, ...vaultItems]}
              accessory={
                agent && (
                  <ModelChip
                    agent={agent}
                    pick={pick}
                    effort={effort}
                    onPick={onPick}
                    onThinking={onThinking}
                    open={modelSheet}
                    onOpenChange={setModelSheet}
                  />
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
        {agent && (
          <ChatInfoSheet
            open={info}
            onOpenChange={setInfo}
            agent={agent}
            usage={usage}
            summarized={summarized}
            runtimeId={chat?.runtimeId}
          />
        )}
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

        {agent && inCall && (
          <TalkCall
            name={agent.name}
            hue={agent.hue}
            seed={agent.id}
            media={media}
            onType={() => {
              setMinimized(true)
              composer.current?.focus()
            }}
            local={talkVoice.data?.local}
            voice={talkVoice.data?.choice}
            onSetup={() => {
              setMinimized(true)
              setVoiceSheet('change')
            }}
          />
        )}
        {agent && (
          <VoiceSheet
            open={!!voiceSheet}
            onOpenChange={(open) => !open && setVoiceSheet(null)}
            profile={agentId}
            name={agent.name}
            hue={agent.hue}
            provider={agent.provider}
            onChosen={
              inCall
                ? (choice) => {
                    const plugin = !!talkVoice.data?.plugin
                    switchVoice({ engine: engineOf(choice), stream: choice === 'local' && plugin, fallbackStream: plugin, keeps: plugin }, choice === 'local' ? 'Local' : VOICE_NAMES[choice])
                  }
                : undefined
            }
            onStart={voiceSheet === 'start' ? (from, choice) => call(from, { engine: engineOf(choice), stream: choice === 'local' && !!talkVoice.data?.plugin, keeps: !!talkVoice.data?.plugin }) : undefined}
          />
        )}
        <SecureSheet
          open={secure || resumed}
          ready={resumed}
          onOpenChange={(open) => (setSecure(open), !open && setResumed(false))}
          name={agent?.name ?? 'your agent'}
          onStart={(from) => {
            setResumed(false)
            onCall(from)
          }}
        />

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

/** The routines the agent set up in this chat. */
function useMade(items: ChatItem[] | undefined) {
  const made = (items ?? []).flatMap((i) => (i.kind === 'tool' && i.routineId ? [i.routineId] : []))
  const key = made.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => made, [key])
}

/** Short enough for one line of the composer's placeholder (textareas can't ellipsize it). */
const clip = (name: string) => (name.length > 22 ? `${name.slice(0, 21).trimEnd()}…` : name)

const agentPick = (agent?: Agent): ModelPick | undefined =>
  agent?.model && agent.provider ? { model: agent.model, provider: agent.provider } : undefined
