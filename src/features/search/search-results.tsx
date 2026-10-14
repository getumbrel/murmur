import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Link } from 'wouter'
import { Search, SearchX } from 'lucide-react'
import { Button } from '@/ui/button'
import { Orb } from '@/ui/orb'
import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import { shortTime } from '@/features/home/time'
import { MIN_QUERY, type ChatSearch, type SearchResult } from '@/state/search'

// What a search found: one row per chat, newest first. The orb says whose chat
// it is, the words you searched for glow in that agent's colour.

export type Density = 'roomy' | 'compact'

export const resultHref = (r: SearchResult) => `/chat/${r.agent.id}/${r.chatId}`
const keyOf = (r: SearchResult) => `${r.agent.id}/${r.chatId}`

type Props = {
  search: ChatSearch
  /** What's in the field right now (the search itself is debounced). */
  text: string
  density: Density
  /** Keyboard-highlighted row. */
  activeIndex?: number
  /** The chat that's open, on wide screens. */
  selectedChatId?: string
  onOpen?: (r: SearchResult) => void
  className?: string
}

export function SearchResults({ search, text, density, activeIndex = -1, selectedChatId, onOpen, className }: Props) {
  const roomy = density === 'roomy'
  const typed = text.trim()

  if (typed.length < MIN_QUERY) {
    return roomy ? (
      <Hint key="hint" icon={<Search size={22} strokeWidth={1.85} />} title="Search your chats" body="Find anything you or your agents have said." />
    ) : (
      <p key="hint" className="animate-fade px-4 pt-3 text-footnote text-ink-3">Type to search every chat.</p>
    )
  }

  if (search.failed) {
    return (
      <div className={cn('flex animate-fade flex-col items-center text-center', roomy ? 'px-8 pt-16' : 'px-4 pt-8')}>
        <p className={cn('max-w-72 text-balance text-ink-2', roomy ? 'text-subhead' : 'text-footnote')}>Can’t search right now. Check that Hermes is running, then try again.</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={search.retry}>
          Try again
        </Button>
      </div>
    )
  }

  if (!search.results.length) {
    if (search.searching) return <ResultsSkeleton density={density} />
    return roomy ? (
      <Hint key={`none-${search.query}`} icon={<SearchX size={22} strokeWidth={1.85} />} title="No results" body={`Nothing in your chats matches “${search.query}”.`} />
    ) : (
      <p key={`none-${search.query}`} className="animate-fade px-4 pt-3 text-footnote text-ink-3">
        Nothing matches “{search.query}”.
      </p>
    )
  }

  return (
    <div className={className}>
      {roomy && (
        <h2 className="px-5 pb-1.5 text-footnote font-semibold text-ink-2">
          {search.results.length === 1 ? '1 chat' : `${search.results.length} chats`}
        </h2>
      )}
      <ul className={cn(!roomy && 'space-y-px px-2')} role="listbox" aria-label="Search results">
        {search.results.map((r, i) => (
          <li key={keyOf(r)} className="animate-fade" role="option" aria-selected={i === activeIndex}>
            <ResultRow
              result={r}
              query={search.query}
              density={density}
              active={i === activeIndex}
              selected={r.chatId === selectedChatId}
              last={i === search.results.length - 1}
              onOpen={onOpen}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function ResultRow({
  result: r,
  query,
  density,
  active,
  selected,
  last,
  onOpen,
}: {
  result: SearchResult
  query: string
  density: Density
  active?: boolean
  selected?: boolean
  last?: boolean
  onOpen?: (r: SearchResult) => void
}) {
  const roomy = density === 'roomy'
  const ref = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div className="hue-scope" style={{ '--hue': r.agent.hue } as CSSProperties}>
      <Link
        ref={ref}
        href={resultHref(r)}
        onClick={() => onOpen?.(r)}
        data-active={active || undefined}
        aria-current={selected ? 'page' : undefined}
        className={cn(
          'flex w-full items-start text-left transition-colors duration-150',
          roomy
            ? 'gap-3.5 pl-3 hover:bg-fill-1 active:bg-fill-2'
            : 'gap-3 rounded-lg px-2.5 py-2 hover:bg-fill-1 active:bg-fill-2 data-active:bg-fill-2',
          selected && 'bg-accent-soft hover:bg-accent-soft',
        )}
      >
        {/* Named only where the row doesn't print the name (the sidebar's), so it's never read twice. */}
        <Orb
          hue={r.agent.hue}
          size={roomy ? 44 : 32}
          seed={r.agent.id}
          label={roomy ? undefined : r.agent.name}
          className={cn(roomy ? 'mt-3' : 'mt-0.5')}
        />
        <span className={cn('min-w-0 flex-1', roomy && 'py-2.5 pr-5', roomy && !last && 'hairline-b')}>
          <span className="flex items-baseline gap-2">
            <span
              title={r.title}
              className={cn('min-w-0 flex-1 truncate font-semibold tracking-[-0.015em]', roomy ? 'text-body' : 'text-subhead')}
            >
              <Marked text={r.title} query={query} />
            </span>
            {/* Whose chat it is, in words (two agents can share a colour). A long name gives way; the time never
                does. The narrow sidebar keeps just the time and lets the snippet name the speaker instead. */}
            <span className={cn('flex max-w-[50%] min-w-0 flex-none items-baseline text-ink-3', roomy ? 'text-footnote' : 'text-caption')}>
              {roomy && <span className="min-w-0 truncate font-medium text-ink-2">{r.agent.name}</span>}
              <span className="flex-none whitespace-nowrap tabular-nums">{roomy ? `\u00a0·\u00a0${shortTime(r.at)}` : shortTime(r.at)}</span>
            </span>
          </span>
          <Snippet result={r} named={roomy} className={cn('text-ink-2', roomy ? 'mt-0.5 text-subhead leading-5' : 'text-footnote leading-[1.05rem]')} />
        </span>
      </Link>
    </div>
  )
}

const markClass = 'rounded-[4px] bg-accent-soft px-[2px] font-semibold text-accent [box-decoration-break:clone]'

function Snippet({ result: r, named, className }: { result: SearchResult; named?: boolean; className?: string }) {
  if (!r.snippet.length) return null
  const speaker = r.from === 'you' ? 'You' : r.from === 'agent' && !named ? r.agent.name : null
  return (
    <span className={cn('line-clamp-2 break-words', className)}>
      {/* When the agent is named above, only your own words need a speaker. */}
      {speaker && <span className="font-medium text-ink">{speaker}: </span>}
      {r.snippet.map((part, i) =>
        part.match ? (
          <mark key={i} className={markClass}>
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  )
}

/** `text` with the first place `query` appears lit up. */
function Marked({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className={cn(markClass, 'px-0')}>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  )
}

function Hint({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex animate-rise flex-col items-center px-10 pt-20 text-center">
      <span className="grid size-13 place-items-center rounded-full bg-fill-2 text-ink-2">{icon}</span>
      <p className="mt-4 text-body font-semibold tracking-[-0.015em] text-balance">{title}</p>
      <p className="mt-1 max-w-72 text-balance text-subhead text-ink-2">{body}</p>
    </div>
  )
}

function ResultsSkeleton({ density }: { density: Density }) {
  const roomy = density === 'roomy'
  return (
    <ul aria-busy="true" aria-label="Searching" className={cn('animate-fade [animation-delay:150ms]', !roomy && 'px-2')}>
      {[0.7, 0.5, 0.62].map((w, i) => (
        <li key={i} className={cn('flex items-start', roomy ? 'gap-3.5 py-3 pr-5 pl-3' : 'gap-3 px-2.5 py-2')}>
          <Skeleton className={cn('flex-none rounded-full', roomy ? 'size-11' : 'size-8')} />
          <span className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3 rounded-full" style={{ width: `${w * 70}%` }} />
            <Skeleton className="h-2.5 rounded-full opacity-60" style={{ width: `${Math.min(100, w * 100 + 20)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Up/Down move through results, Enter opens one; for the search field. */
export function useResultKeys(results: SearchResult[], open: (r: SearchResult) => void) {
  const [active, setActive] = useState(-1)
  const sig = results.map(keyOf).join('|')
  const [lastSig, setLastSig] = useState(sig)
  if (sig !== lastSig) {
    setLastSig(sig)
    setActive(-1)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      open(results[Math.max(0, active)])
    }
  }
  return { active, onKeyDown }
}
