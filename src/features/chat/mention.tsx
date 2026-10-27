import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useAgents } from '@/state/agents'
import { mentionRanges, type Mentionable } from '@shared/mentions.ts'
import { MentionCard } from './mention-card'
import './mention.css'

// @mentions in messages: "@Atlas" (or Hermes's own "@atlas") reads as a small
// chip in that agent's colour, and a tap shows who it is. The words stay
// words, so selecting and copying a message still gives "@Atlas".

export type MentionMember = Mentionable & { hue: number }

type Directory = {
  members: MentionMember[]
  byId: Map<string, MentionMember>
  /** Changes whenever anyone's name, handle or colour does. */
  key: string
}

const EMPTY: Directory = { members: [], byId: new Map(), key: '' }
const Context = createContext<Directory>(EMPTY)

export const useMentions = () => useContext(Context)

/**
 * Everyone who can be mentioned, built once per change to the agents
 * themselves (not each time their chats move), so streaming never rebuilds it.
 */
export function MentionsProvider({ children }: { children: ReactNode }) {
  const { data } = useAgents()
  // People write names; Hermes writes handles: its profile name, "hermes" for the main agent.
  const key = (data ?? []).map((a) => [a.id, a.isDefault ? 'hermes' : a.id, a.hue, a.name].join('\u0000')).join('\u0001')
  const value = useMemo<Directory>(() => {
    if (!key) return EMPTY
    const members = key.split('\u0001').map((row) => {
      const [id, handle, hue, name] = row.split('\u0000')
      return { id, handle, hue: Number(hue), name }
    })
    return { members, byId: new Map(members.map((m) => [m.id, m])), key }
  }, [key])
  return <Context value={value}>{children}</Context>
}

/** Plain text (your own messages) with its mentions as chips. */
export function MentionText({ text, still }: { text: string; still?: boolean }) {
  const { members } = useMentions()
  const ranges = useMemo(() => mentionRanges(text, members), [text, members])
  if (!ranges.length) return text
  const out: ReactNode[] = []
  let at = 0
  for (const r of ranges) {
    if (r.start > at) out.push(text.slice(at, r.start))
    out.push(
      <Mention key={r.start} agentId={r.member?.id ?? ''} still={still}>
        {r.member ? `@${r.member.name}` : text.slice(r.start, r.end)}
      </Mention>,
    )
    at = r.end
  }
  out.push(text.slice(at))
  return out
}

/**
 * One mention. `agentId` is empty for @everyone and @all, which read as a
 * quiet neutral chip; an agent's opens its card. `still` draws it without the tap.
 */
export function Mention({ agentId, still, children }: { agentId: string; still?: boolean; children: ReactNode }) {
  const member = useMentions().byId.get(agentId)
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  // The card is only built for a chip that's been tapped.
  const [wanted, setWanted] = useState(false)

  const toggle = useCallback(() => {
    setWanted(true)
    setOpen((o) => !o)
  }, [])

  if (!agentId) return <span className="mention mention-all">{children}</span>
  if (!member) return children

  const style = { '--hue': member.hue } as CSSProperties
  if (still) return <span className="mention hue-scope" style={style}>{children}</span>

  const onClick = (e: MouseEvent) => {
    // Dragging across it to select words isn't a tap.
    if (!getSelection()?.isCollapsed) return
    e.stopPropagation()
    toggle()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    toggle()
  }

  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="mention hue-scope"
        style={style}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {children}
      </span>
      {wanted && <MentionCard agentId={agentId} anchor={ref} open={open} onOpenChange={setOpen} />}
    </>
  )
}
