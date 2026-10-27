import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { Route, Router, Switch, useLocation } from 'wouter'
import { Toaster } from 'sonner'
import { MotionConfig, motion, useReducedMotion } from 'motion/react'
import { create } from 'zustand'
import { MurmurMark } from '@/ui/brand'
import { startGateway } from '@/hermes/gateway'
import { wireChats } from '@/state/chats'
import { wireSessionLists } from '@/state/sync'
import { markWelcomed, useReadiness } from '@/state/readiness'
import { useAgents, useFreshAgents } from '@/state/agents'
import { usePicturesSync } from '@/state/pictures'
import { useUmbrelContextSync } from '@/state/umbrel-context'
import { useDesktopToolsSync } from '@/state/toolsets'
import { wireNotices } from '@/features/chat/notices'
import { useUmbrelMcpSync } from '@/state/umbrel-mcp'
import { ensureTimezone } from '@/state/timezone'
import { useGroupSummaries } from '@/state/groups'
import { clearUnread, useChats } from '@/state/chats'
import { markChatSeen, setViewingChat, useUnreadCount } from '@/state/status'
import { SIDEBAR_WIDTH, useIsWide } from '@/lib/use-media'
import { handoff, setMainAgent, useTransitionLocation, useUpFrom } from '@/lib/transitions'
import { SwipeBack } from '@/lib/swipe-back'
import { lazyComponent, preloadWhenIdle } from '@/lib/lazy'
import { Markdown } from '@/features/chat/lazy-markdown'
import { Sidebar } from '@/screens/home'
import { HomeScreen } from '@/screens/home'
import { ChatScreen } from '@/screens/chat'
import { ConnectionBanner } from '@/screens/connection-banner'
import { HermesGate } from '@/features/connection/gate'
import { ShortcutsSheet, useShortcuts } from '@/features/commands/shortcuts'
import { retryUnlessMissing } from '@/hermes/compat'
import { setDesktopBadge } from '@/lib/desktop'
import { NotificationOffer, useNotifier } from '@/features/notifications/notify'

// Screens most visits never open load on the side, so the first open is quick.
const GroupScreen = lazyComponent(() => import('@/screens/group').then((m) => m.GroupScreen))
const SettingsScreen = lazyComponent(() => import('@/screens/settings').then((m) => m.SettingsScreen))
const OnboardingScreen = lazyComponent(() => import('@/screens/onboarding').then((m) => m.OnboardingScreen))
const AgentScreen = lazyComponent(() => import('@/screens/agent').then((m) => m.AgentScreen))
const ChatsScreen = lazyComponent(() => import('@/screens/chats').then((m) => m.ChatsScreen))
const AgentsScreen = lazyComponent(() => import('@/screens/agents').then((m) => m.AgentsScreen))

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: retryUnlessMissing, refetchOnWindowFocus: true } },
})

export function App() {
  useEffect(() => {
    wireChats()
    wireNotices()
    wireSessionLists(queryClient)
    // Split out of the main bundle and fetched once the first screen is up, so
    // they don't compete with it: markdown first (chats are what people open),
    // then the other screens. Markdown comes at once only when the app opens
    // straight into a chat, where the first messages need it.
    if (/^\/(chat|group)\//.test(location.pathname)) void Markdown.preload().catch(() => {})
    preloadWhenIdle(Markdown, AgentScreen, AgentsScreen, GroupScreen, SettingsScreen, OnboardingScreen)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      {/* With Reduce Motion on, every motion component keeps its fades and drops its movement. */}
      <MotionConfig reducedMotion="user">
        {/* Every move between screens goes through a view transition. */}
        <Router hook={useTransitionLocation}>
          {/* Standalone installs pick their Hermes first; on Umbrel it's preset. */}
          <HermesGate>
            <Dial />
            <Gate>
              <Background />
              <ShortcutsSheet />
              <Shell>
                <Suspense>
                  <Switch>
                    <Route path="/chat/:agent/:chat?">
                      {(p) => (
                        <Pushed>
                          <ChatScreen agentId={p.agent} chatId={p.chat} />
                        </Pushed>
                      )}
                    </Route>
                    <Route path="/agent/:agent">
                      {(p) => (
                        <Pushed>
                          <AgentScreen agentId={p.agent} />
                        </Pushed>
                      )}
                    </Route>
                    <Route path="/chats/:agent">
                      {(p) => (
                        <Pushed>
                          <ChatsScreen agentId={p.agent} />
                        </Pushed>
                      )}
                    </Route>
                    <Route path="/agents">
                      <Pushed>
                        <AgentsScreen />
                      </Pushed>
                    </Route>
                    <Route path="/group/:group">
                      {(p) => (
                        <Pushed>
                          <GroupScreen groupId={p.group} />
                        </Pushed>
                      )}
                    </Route>
                    <Route path="/settings/:section?">{(p) => <SettingsScreen section={p.section} />}</Route>
                    <Route path="/welcome/:step?">{(p) => <OnboardingScreen step={p.step} />}</Route>
                    <Route>
                      <HomeScreen />
                    </Route>
                  </Switch>
                </Suspense>
              </Shell>
            </Gate>
          </HermesGate>
          <Overlays />
        </Router>
      </MotionConfig>
    </QueryClientProvider>
  )
}

/**
 * The socket dials once there's a Hermes to dial: not while "Connect to
 * Hermes" is up, when it could only keep failing against a Hermes that isn't
 * set up (the umbrelOS default, on a desktop).
 */
function Dial() {
  useEffect(() => startGateway(), [])
  return null
}

/** True until the app is first drawn (the connection form or the splash is showing). */
const useBooting = create(() => ({ booting: true }))

/** First run (or no model yet) goes to onboarding; everyone else straight in. */
function Gate({ children }: { children: ReactNode }) {
  const readiness = useReadiness()
  const [location, navigate] = useLocation()
  // Settings → Hermes stays open during setup: it's how you leave a Hermes that has no model yet.
  const onboarding = location.startsWith('/welcome') || location === '/settings/hermes'
  // Hold for the roster too, so the app arrives whole and the splash mark has somewhere to land.
  // Groups are part of it (or they'd push rows down a beat later), but never worth a long wait.
  const agents = useAgents()
  // The welcome is for someone new to Murmur. A Hermes already in use (set up
  // on another device, or in Hermes's own apps) goes straight in here too.
  const inUse = agents.data && (agents.data.length > 1 || agents.data.some((a) => a.lastChat))
  useEffect(() => {
    if (readiness === 'needs-welcome' && inUse) markWelcomed()
  }, [readiness, inUse])
  const welcome = readiness === 'needs-welcome' && agents.data !== undefined && !inUse
  const away = (readiness === 'needs-setup' || welcome) && !onboarding
  useEffect(() => {
    if (away) navigate('/welcome', { replace: true })
  }, [away, navigate])
  const groups = useGroupSummaries()
  const [groupsLate, setGroupsLate] = useState(false)
  useEffect(() => {
    if (agents.isPending) return
    const t = setTimeout(() => setGroupsLate(true), 1500)
    return () => clearTimeout(t)
  }, [agents.isPending])
  const roster = agents.isPending || (groups.isPending && !groupsLate)
  const waiting = ((readiness === 'loading' || (roster && readiness !== 'unknown')) && !onboarding) || away
  // The splash lingers until the app is drawn, so its mark can settle into the header's.
  const [splash, setSplash] = useState(waiting)
  useLayoutEffect(() => {
    if (waiting) setSplash(true)
    else if (splash) onboarding ? setSplash(false) : handoff(() => setSplash(false))
  }, [waiting])
  const booting = splash || waiting
  useLayoutEffect(() => useBooting.setState({ booting }), [booting])
  if (booting) return <Splash />
  return <>{children}</>
}

/** Phones: a pushed page can be dragged back from the left edge to the page beneath. */
function Pushed({ children }: { children: ReactNode }) {
  const wide = useIsWide()
  const [location] = useLocation()
  // Kept current: a page beneath that's since been deleted shows what replaced it.
  const up = useUpFrom(location)
  // Always wrapped, the gesture just off when wide: crossing 900px (an iPad
  // turning) must not remount the page, or its open sheets and edits go with it.
  return (
    <SwipeBack off={wide} under={wide ? null : <Beneath path={up} />}>
      {children}
    </SwipeBack>
  )
}

/** The page "back" would land on, as it looks (see upFrom in src/lib/transitions.ts). */
function Beneath({ path }: { path: string }) {
  const [, kind, id, sub] = /^\/(chat|chats|agent)\/([^/]+)(?:\/([^/]+))?/.exec(path) ?? []
  if (kind === 'agent') return <AgentScreen agentId={decodeURIComponent(id)} />
  if (kind === 'chats') return <ChatsScreen agentId={decodeURIComponent(id)} />
  if (kind === 'chat') return <ChatScreen agentId={decodeURIComponent(id)} chatId={sub && decodeURIComponent(sub)} />
  if (path === '/agents') return <AgentsScreen />
  return <HomeScreen />
}

/** Wide screens keep the agent list beside the conversation (not on the welcome). */
function useSidebar() {
  const wide = useIsWide()
  const [location] = useLocation()
  return wide && !location.startsWith('/welcome')
}

// One tree either way, so the screen inside keeps its state (open sheets,
// half-typed edits) as the window crosses 900px: without the sidebar the two
// wrappers are display: contents, there for React but not for layout.
function Shell({ children }: { children: ReactNode }) {
  const sidebar = useSidebar()
  return (
    <div className={sidebar ? 'flex h-dvh' : 'contents'}>
      {sidebar && <Sidebar />}
      <div
        role={sidebar ? 'main' : undefined}
        className={sidebar ? 'relative min-w-0 flex-1 [view-transition-name:pane]' : 'contents'}
      >
        {/* The divider rides above the pane's own (opaque, sticky) surfaces, which
            would otherwise paint over it, and below its sheets' scrim. */}
        {sidebar && <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-[35] w-px hairline-l" />}
        {children}
      </div>
    </div>
  )
}

/** The connection pill and toasts float over the conversation, so they centre on its pane. */
function Overlays() {
  // Until the app is drawn there's no sidebar, and nothing the pill should talk over.
  const booting = useBooting((s) => s.booting)
  const inset = useSidebar() && !booting ? SIDEBAR_WIDTH : 0
  return (
    <>
      <ConnectionBanner inset={inset} hold={booting} />
      <NotificationOffer inset={inset} />
      <Toaster
        position="top-center"
        toastOptions={{ className: 'murmur-toast' }}
        style={inset ? { left: inset, width: 'auto' } : undefined}
      />
    </>
  )
}

/** Upkeep that runs on every screen once we're in. */
function Background() {
  const agents = useAgents().data
  useFreshAgents()
  // New agents (here or from other apps) get "Let agents make pictures" too.
  usePicturesSync(agents?.map((a) => a.id))
  // On an Umbrel, every agent knows it runs there, not just the main one.
  useUmbrelContextSync(agents?.map((a) => a.id))
  useUmbrelMcpSync(agents?.map((a) => a.id))
  // Hermes Desktop's tips and tours off, reactions on (src/state/toolsets.ts).
  useDesktopToolsSync(agents?.map((a) => a.id))
  useEffect(() => setMainAgent(agents?.find((a) => a.isDefault)?.id), [agents])
  useSeenTracking()
  useDocumentTitle()
  // Notifications on this device: kept signed up, told where you are, opened where they point.
  useNotifier()
  // ⌘⇧O, ⌥↑/⌥↓, ⌘, and "?" (src/features/commands/shortcuts.tsx); not during the welcome.
  useShortcuts(!useLocation()[0].startsWith('/welcome'))
  // Routines fire on the person's clock, not the server's UTC.
  useEffect(() => {
    if (agents) ensureTimezone().catch(() => {})
  }, [Boolean(agents)])
  return null
}

const visible = () => document.visibilityState === 'visible'

/** The open chat counts as read while you can see it. */
function useSeenTracking() {
  const [location] = useLocation()
  const match = /^\/chat\/([^/]+)\/([^/]+)/.exec(location)
  const profile = match ? decodeURIComponent(match[1]) : undefined
  const chatId = match && match[2] !== 'new' ? decodeURIComponent(match[2]) : undefined
  // Re-mark as the reply comes in, so finishing on screen doesn't read as new.
  const pulse = useChats((s) => (chatId ? `${s.chats[chatId]?.status}:${s.chats[chatId]?.items.length}` : ''))
  // Hermes only has a row once a message is stored: not for a chat born a moment ago, nor a bad link.
  const stored = useChats((s) => !!chatId && !!s.chats[chatId]?.items.some((i) => i.kind === 'user' && i.rowId != null))

  useEffect(() => {
    if (!chatId) return
    const look = () => {
      setViewingChat(visible() ? chatId : undefined)
      if (visible()) markChatSeen(chatId)
    }
    look()
    document.addEventListener('visibilitychange', look)
    return () => {
      document.removeEventListener('visibilitychange', look)
      if (visible()) markChatSeen(chatId)
      setViewingChat(undefined)
    }
  }, [chatId, profile])

  useEffect(() => {
    if (chatId && visible()) markChatSeen(chatId)
  }, [chatId, pulse])

  // Hermes Desktop keeps its own unread flag; clear it there too.
  useEffect(() => {
    if (chatId && profile && stored) clearUnread(chatId, profile).catch(() => {})
  }, [chatId, profile, stored])
}

/**
 * "Atlas · Murmur" for the tab and history, with "(2) " in front in a background
 * tab when something new came in. The desktop app shows the count on its dock
 * or taskbar icon, whether or not it's in front, as Mail and Messages do.
 */
function useDocumentTitle() {
  const [location] = useLocation()
  const agents = useAgents().data
  const groups = useGroupSummaries().data
  const chats = (agents ?? []).flatMap((a) => (a.lastChat ? [{ id: a.lastChat.id, at: a.lastChat.at }] : []))
  const count = useUnreadCount(chats) + (groups?.filter((g) => g.unread).length ?? 0)
  const [, kind, id] = /^\/(chat|agents|agent|group|settings)(?:\/([^/]+))?/.exec(location) ?? []
  const key = id && decodeURIComponent(id)
  const place =
    kind === 'chat' || kind === 'agent'
      ? agents?.find((a) => a.id === key)?.name
      : kind === 'group'
        ? groups?.find((g) => g.id === key)?.name
        : kind === 'settings' || kind === 'agents'
          ? kind[0].toUpperCase() + kind.slice(1)
          : undefined
  const title = place ? `${place} · Murmur` : 'Murmur'
  useEffect(() => setDesktopBadge(count), [count])
  useEffect(() => {
    const update = () => {
      document.title = !visible() && count > 0 ? `(${count}) ${title}` : title
    }
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [count, title])
}

/** Quick loads see nothing; slow ones see the mark rise in, breathing and blinking. */
function Splash() {
  // Reduced motion: no rise, just a quick fade.
  const reduce = useReducedMotion()
  return (
    // A touch above centre, where the eye rests.
    <div className="grid h-dvh place-items-center bg-bg pb-[6vh]" role="status" aria-busy="true" aria-label="Loading Murmur">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 0.35, duration: reduce ? 0.15 : 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <MurmurMark size={48} breathe label="" />
      </motion.div>
    </div>
  )
}
