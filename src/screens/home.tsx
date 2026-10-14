import { AnimatePresence, MotionConfig, motion, useScroll, useTransform } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Link, useLocation, useRoute } from 'wouter'
import { ChevronRight, LayoutGrid, Plus, Search, Settings } from 'lucide-react'
import { Button, IconButton } from '@/ui/button'
import { Orb } from '@/ui/orb'
import { ByUmbrel, MurmurWordmark } from '@/ui/brand'
import { useAgents } from '@/state/agents'
import { useIsWide } from '@/lib/use-media'
import { cn } from '@/lib/cn'
import { useAgentActions } from '@/features/home/actions'
import { NewMenu } from '@/features/home/new-menu'
import { NeedsYou, Roster } from '@/features/home/roster'
import { Suggestion } from '@/features/home/suggestion'
import { greeting } from '@/features/home/time'
import { SearchField } from '@/features/search/search-field'
import { SearchResults, resultHref, useResultKeys } from '@/features/search/search-results'
import { searchActions, useChatSearch, useSearchStore } from '@/state/search'
import { HermesSwitcher } from '@/features/connection/switcher'
import { focusSearch, registerSearch } from '@/features/commands/shortcuts'
import { InstallTip, useInstallTip } from '@/features/home/install-tip'
import { WindowControlsGap } from '@/ui/titlebar'

// Home: everyone you can talk to. Phones get a full screen with a large
// title; wide screens keep the list in the sidebar and show a calm prompt.
//
// One grid line per surface. Phone: 20px. The lockup, the greeting, the search
// field, the cards and every Buddy's body start there, and the bar's glyphs
// (not their 44px buttons) sit on it at both ends. Sidebar: containers (field,
// row highlights) at 8px, content (lockup, Buddies, footer) at 24px.

export function HomeScreen() {
  const wide = useIsWide()
  return <MotionConfig reducedMotion="user">{wide ? <WideEmpty /> : <PhoneHome />}</MotionConfig>
}

function PhoneHome() {
  const [, navigate] = useLocation()
  const actions = useAgentActions()
  const title = useRef<HTMLHeadingElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const { active, text } = useSearchStore()
  const collapsed = useScrolledPast(title, active)
  const search = useChatSearch(active ? text : '')
  const installTip = useInstallTip()
  // The roster fades back in after a search, not on every visit.
  const [returning, setReturning] = useState(false)
  // The large title dissolves as it slides under the bar, iOS-style.
  const { scrollY } = useScroll()
  const titleOpacity = useTransform(scrollY, [0, 40], [1, 0])
  const titleScale = useTransform(scrollY, [0, 40], [1, 0.96])

  const startSearch = () => {
    if (active) return
    window.scrollTo({ top: 0 })
    searchActions.open()
  }
  const cancel = () => {
    input.current?.blur()
    setReturning(true)
    searchActions.close()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') cancel()
    // The keyboard's Search key just tucks the keyboard away to show results.
    if (e.key === 'Enter') input.current?.blur()
  }

  return (
    // Tablets keep a phone-width column rather than stretching rows edge to edge.
    <div className="mx-auto min-h-dvh max-w-[640px] bg-bg pb-[max(24px,env(safe-area-inset-bottom))]">
      {!active && (
        <header
          className={cn(
            'sticky top-0 z-20 safe-top transition-[background-color,box-shadow,backdrop-filter] duration-300',
            collapsed && 'glass hairline-b',
          )}
        >
          {/* Measured: these pads put the gear's and the plus's ink (not their 44px buttons) exactly on the 20px lines. */}
          <div className="relative flex h-13 items-center justify-between pr-[5px] pl-[7px] desktop:h-(--titlebar-h)">
            <div className="flex items-center">
              <WindowControlsGap side="start" column={640} />
              <IconButton size="lg" label="Settings" onClick={() => navigate('/settings')}>
                <Settings size={20} strokeWidth={1.85} />
              </IconButton>
            </div>
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-x-16 text-center text-body font-semibold tracking-[-0.015em] transition-[opacity,transform] duration-300 ease-[var(--ease-out)]',
                collapsed ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
              )}
            >
              Murmur
            </span>
            <div className="flex items-center">
              {/* Once the field has scrolled away, search stays one tap off. */}
              <IconButton
                size="lg"
                label="Search"
                onClick={() => input.current?.focus()}
                tabIndex={collapsed ? 0 : -1}
                aria-hidden={!collapsed}
                className={cn(
                  'transition-[opacity,transform] duration-200 ease-[var(--ease-out)]',
                  collapsed ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0',
                )}
              >
                <Search size={20} strokeWidth={1.85} />
              </IconButton>
              <NewMenu size="lg" variant="plain" onNewAgent={actions.newAgent} onNewGroup={actions.newGroup} />
              <WindowControlsGap side="end" column={640} />
            </div>
          </div>
        </header>
      )}

      {!active && (
        <motion.div className="origin-bottom-left px-5 pt-1 pb-4" style={{ opacity: titleOpacity, scale: titleScale }}>
          {/* Back from search, the title settles in above the field as it glides down. */}
          <motion.div
            initial={returning ? { opacity: 0, y: -14 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', duration: 0.38, bounce: 0 }}
          >
            <div className="flex items-center justify-between gap-3 pt-1">
              {/* The lockup is the large title. */}
              <h1 ref={title} className="flex flex-none">
                <MurmurWordmark size={31} />
              </h1>
              {/* With more than one Hermes, which one this is, ending on the 20px line. */}
              <HermesSwitcher className="-my-1 min-w-0" />
            </div>
            <p className="mt-1.5 text-subhead text-ink-2">{greeting()}</p>
          </motion.div>
        </motion.div>
      )}

      {/* One field throughout: it glides up into the bar while searching, so focus and the keyboard never drop. */}
      <motion.div
        layout="position"
        transition={{ type: 'spring', duration: 0.38, bounce: 0 }}
        className={cn('z-20 flex items-center px-5', active ? 'sticky top-0 glass safe-top hairline-b' : 'pb-3')}
      >
        <div className={cn('flex w-full items-center', active && 'py-2 desktop:h-(--titlebar-h) desktop:py-0')}>
          {active && <WindowControlsGap side="start" column={640} />}
          <SearchField
            ref={input}
            value={text}
            onValueChange={searchActions.set}
            onFocus={startSearch}
            onKeyDown={onKeyDown}
            busy={active && search.searching}
          />
          <AnimatePresence initial={false}>
            {active && (
              <motion.button
                key="cancel"
                type="button"
                onClick={cancel}
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ type: 'spring', duration: 0.32, bounce: 0 }}
                className="h-10 flex-none overflow-hidden text-body whitespace-nowrap text-accent"
              >
                <span className="block pl-4">Cancel</span>
              </motion.button>
            )}
          </AnimatePresence>
          {active && <WindowControlsGap side="end" column={640} />}
        </div>
      </motion.div>

      {active ? (
        <SearchResults search={search} text={text} density="roomy" className="animate-fade pt-3" />
      ) : (
        <div className={cn(returning && 'animate-fade')}>
          <InstallTip kind={installTip} />
          <NeedsYou density="roomy" title={<SectionTitle>Needs you</SectionTitle>} />
          {/* Everyone you can talk to, as a gallery, one tap off the list. */}
          <div className="flex items-baseline justify-between px-5">
            <SectionTitle>Chats</SectionTitle>
            <Link
              href="/agents"
              className="pressable -mr-2 -mb-1 flex h-9 items-center gap-0.5 rounded-full pr-1 pl-2.5 text-footnote font-medium text-accent hover:bg-fill-1"
            >
              All agents
              <ChevronRight size={16} strokeWidth={2.25} aria-hidden />
            </Link>
          </div>
          <Roster
            density="roomy"
            onEdit={actions.edit}
            onDelete={actions.remove}
            onRenameGroup={actions.renameGroup}
            onDeleteGroup={actions.removeGroup}
          />
          {/* One nudge at a time. */}
          {!installTip && <Suggestion density="roomy" onNewAgent={actions.newAgent} onNewGroup={actions.newGroup} />}
          <footer className="flex justify-center px-5 pt-12 pb-2">
            <ByUmbrel />
          </footer>
        </div>
      )}
      {actions.sheets}
    </div>
  )
}

function WideEmpty() {
  const actions = useAgentActions()
  const { data: agents } = useAgents()
  const hue = agents?.find((a) => a.isDefault)?.hue ?? 278
  return (
    <div
      className="hue-scope flex h-full flex-col items-center justify-center px-8 pb-[8vh] text-center"
      style={{ '--hue': hue } as CSSProperties}
    >
      <div className="relative grid place-items-center">
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-16 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
        />
        <span>
          <Orb hue={hue} size={112} seed="home" />
        </span>
      </div>
      <h1 className="mt-9 text-title font-semibold tracking-[-0.02em] text-balance">Pick an agent to start chatting</h1>
      <p className="mt-1.5 max-w-80 text-balance text-subhead text-ink-2">
        Or make a new one for something you do often.
      </p>
      <Button variant="secondary" className="mt-7" onClick={actions.newAgent}>
        <Plus size={18} strokeWidth={2} className="-ml-1" />
        New agent
      </Button>
      {actions.sheets}
    </div>
  )
}

/** The list of agents beside the conversation on wide screens. */
export function Sidebar() {
  const [, navigate] = useLocation()
  const [, chat] = useRoute('/chat/:agent/:chat?')
  const [, agentPage] = useRoute('/agent/:agent')
  const [, group] = useRoute('/group/:group')
  const [inSettings] = useRoute('/settings/:section?')
  const [inAgents] = useRoute('/agents')
  const actions = useAgentActions()
  const input = useRef<HTMLInputElement>(null)
  const { text } = useSearchStore()
  const search = useChatSearch(text)
  const keys = useResultKeys(search.results, (r) => navigate(resultHref(r)))
  const searching = text.trim().length > 0
  useFocusShortcut(input)

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (text) searchActions.set('')
      else input.current?.blur()
      return
    }
    keys.onKeyDown(e)
  }

  return (
    <MotionConfig reducedMotion="user">
      <aside data-sidebar="" className="flex h-dvh w-[308px] flex-none flex-col bg-bg">
        {/* Gear before plus, as on the phone, so + is always the trailing control.
            The plus's glyph ends where the rows' times do (8px container + 10px row inset). */}
        {/* On a Mac the traffic lights come first, and the lockup follows them. */}
        <div className="flex h-14 flex-none items-center gap-0.5 pr-2 pl-6 desktop:h-(--titlebar-h) mac:pl-3">
          <WindowControlsGap side="start" flexGap={2} />
          <h1 className="flex flex-1">
            <MurmurWordmark size={24} />
          </h1>
          <IconButton
            size="sm"
            label="Settings"
            onClick={() => navigate('/settings')}
            className={cn(inSettings && 'bg-fill-2 text-ink')}
          >
            <Settings size={18} strokeWidth={1.85} />
          </IconButton>
          <NewMenu size="sm" variant="plain" onNewAgent={actions.newAgent} onNewGroup={actions.newGroup} />
        </div>
        {/* With more than one Hermes: which one this is. Its dot sits on the lockup's 24px line,
            its fill bleeding out to 12px; with one Hermes it draws nothing and takes no room. */}
        <div className="-mt-1 flex-none px-3 pb-2.5 empty:hidden">
          <HermesSwitcher className="max-w-full" />
        </div>
        <div className="flex-none px-2 pb-2">
          <SearchField
            ref={input}
            size="sm"
            value={text}
            onValueChange={searchActions.set}
            onKeyDown={onKeyDown}
            busy={search.searching}
          />
        </div>
        <motion.div layoutScroll className="min-h-0 flex-1 overflow-y-auto pt-1 pb-4">
          {searching ? (
            <SearchResults
              key="results"
              search={search}
              text={text}
              density="compact"
              activeIndex={keys.active}
              selectedChatId={chat?.chat}
              className="animate-fade"
            />
          ) : (
            <div key="roster" className="animate-fade">
              <AllAgentsLink active={inAgents} />
              <NeedsYou
                density="compact"
                title={
                  <SectionTitle className="px-4" compact>
                    Needs you
                  </SectionTitle>
                }
              />
              <Roster
                density="compact"
                selectedId={group ? `group:${group.group}` : (chat?.agent ?? agentPage?.agent)}
                openChatId={chat?.chat}
                onEdit={actions.edit}
                onDelete={actions.remove}
                onRenameGroup={actions.renameGroup}
                onDeleteGroup={actions.removeGroup}
              />
              {/* The empty main pane already offers this; beside a conversation it's the only nudge. */}
              {(chat || group) && (
                <Suggestion density="compact" onNewAgent={actions.newAgent} onNewGroup={actions.newGroup} />
              )}
            </div>
          )}
        </motion.div>
        {/* Signed, quietly, at the foot of the list. */}
        <footer className="flex-none px-6 pt-2 pb-4">
          <ByUmbrel />
        </footer>
        {actions.sheets}
      </aside>
    </MotionConfig>
  )
}

/** The sidebar's way to the gallery of agents: a quiet nav row above the list. */
function AllAgentsLink({ active }: { active: boolean }) {
  return (
    <div className="px-2 pb-2">
      <Link
        href="/agents"
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-9 items-center gap-3 rounded-lg px-2.5 text-subhead font-medium select-none',
          'transition-colors duration-150 active:bg-fill-2',
          active ? 'bg-fill-2 text-ink' : 'text-ink-2 hover:bg-fill-1 hover:text-ink',
        )}
      >
        {/* Centred on the Buddies' 40px column. */}
        <span className="grid w-10 flex-none place-items-center">
          <LayoutGrid size={17} strokeWidth={1.85} aria-hidden />
        </span>
        All agents
      </Link>
    </div>
  )
}

function SectionTitle({ children, className, compact }: { children: string; className?: string; compact?: boolean }) {
  return (
    <h2 className={cn('font-semibold text-ink-2', compact ? 'pb-1.5 text-caption' : 'pb-2 text-footnote', className)}>
      {children}
    </h2>
  )
}

/** ⌘K / Ctrl+K (or "/" when not typing) jumps to search. */
function useFocusShortcut(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const unregister = registerSearch(() => {
      ref.current?.focus()
      ref.current?.select()
    })
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault()
        focusSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      unregister()
      window.removeEventListener('keydown', onKey)
    }
  }, [ref])
}

/** True once `ref` has scrolled up under the sticky header. */
function useScrolledPast(ref: React.RefObject<HTMLElement | null>, remount?: unknown) {
  const [past, setPast] = useState(false)
  // The title unmounts while searching; watch the new one when it's back.
  useEffect(() => {
    const el = ref.current
    if (!el) return setPast(false)
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting), { rootMargin: '-64px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, remount])
  return past
}
