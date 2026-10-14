// Search across every chat with every agent. Hermes searches one agent at a
// time, so we ask each agent in parallel and merge, newest first. Behind-the-
// scenes chats (scheduled runs, group plumbing) are left out.

import { create } from 'zustand'
import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '@/hermes/rest'
import { rpc } from '@/hermes/gateway'
import { readable, useAgents, type Agent } from '@/state/agents'

type Hit = {
  session_id: string
  id?: string
  title?: string | null
  preview?: string | null
  snippet?: string
  role?: string | null
  source?: string | null
  last_active?: number | null
  session_started?: number | null
  started_at?: number | null
  message_count?: number
}

/** A piece of a snippet; `match` pieces are what the person typed. */
export type SnippetPart = { text: string; match?: boolean }

export type SearchResult = {
  agent: Agent
  chatId: string
  title: string
  snippet: SnippetPart[]
  /** Who said the matching words; `title` when it's the chat's name that matched. */
  from: 'you' | 'agent' | 'other' | 'title'
  /** ms */
  at: number
}

const HIDDEN_SOURCES = ['cron', 'bot_room']
const hidden = (source?: string | null, title?: string | null) =>
  HIDDEN_SOURCES.includes(source ?? '') || (title ?? '').startsWith('Group: ')

// Attachment paths read as their file names: "MEDIA:/opt/data/fruits.csv" → "fruits.csv".
const REFS = /(?:MEDIA:\s*|@(?:file|image):)(`[^`]+`|"[^"]+"|\S+)/g
const fileName = (path: string) => path.replace(/^[`"']|[`"']$/g, '').split(/[\\/]/).pop() || path
const PER_AGENT = 15
export const MIN_QUERY = 2

/** ">>>pine<<<apple" → [{pine, match}, {apple}], tidied for one or two lines. */
export function parseSnippet(raw: string): SnippetPart[] {
  const flat = raw
    .replace(REFS, (_, path: string) => fileName(path))
    // Escaped newlines from tool output read as "\n\n" otherwise.
    .replace(/\\[nrt]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.\.\.\s*/, '…')
    .replace(/\s*\.\.\.$/, '…')
    // Markdown that reads as noise in a one-line preview.
    .replace(/\*\*|__|`+/g, '')
    .replace(/(^|\s)#{1,6}\s/g, '$1')
    // A table's rules and cells: "| | Email | Inbox triage |" → "Email · Inbox triage".
    .replace(/:?-{3,}:?/g, '')
    .replace(/\s*(?:\|\s*)+/g, ' · ')
    .replace(/^(…?)\s*·\s*|\s*·\s*(…?)$/g, '$1$2')
    .trim()
  const parts: SnippetPart[] = []
  const re = />>>(.*?)<<</g
  let at = 0
  for (let m = re.exec(flat); m; m = re.exec(flat)) {
    if (m.index > at) parts.push({ text: flat.slice(at, m.index) })
    if (m[1]) parts.push({ text: m[1], match: true })
    at = m.index + m[0].length
  }
  if (at < flat.length) parts.push({ text: flat.slice(at).replace(/>>>|<<</g, '') })
  return trimToMatch(parts)
}

// A row shows two lines (about 80 characters on a phone, fewer in the
// sidebar), so the first match must come early or it's clamped out of sight.
const LEAD = 36

/** Drops the words well before the first match, starting on a word, with "…" for what's gone. */
function trimToMatch(parts: SnippetPart[]): SnippetPart[] {
  // Pieces alternate, so a match with words before it is the second piece.
  if (!parts[1]?.match) return parts
  const lead = parts[0].text
  if (lead.length <= LEAD + 8) return parts
  const cut = lead.slice(-LEAD)
  const word = cut.indexOf(' ')
  const kept = word >= 0 && word < LEAD - 8 ? cut.slice(word + 1) : cut
  return [{ text: `…${kept}` }, ...parts.slice(1)]
}

// What the agent's tools said or were asked ("[{"id": "call_…", …}]", a file's
// raw JSON) is stored beside the conversation and searched with it, but people
// never read it there and shouldn't read it here.
const JSON_LIKE = /[{[]\s*"[\w-]+"\s*:|"[\w-]+"\s*:\s*["{[\d]|\bcall_[A-Za-z0-9]{8,}/
const behindTheScenes = (h: Hit) =>
  (h.role != null && h.role !== 'user' && h.role !== 'assistant') || JSON_LIKE.test(h.snippet ?? '')

/** Words around the first place `q` appears in `text`, marked, for a hit whose own snippet was tool noise. */
function markedIn(text: string, q: string): SnippetPart[] | undefined {
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0) return undefined
  return trimToMatch([
    ...(at > 0 ? [{ text: text.slice(0, at) }] : []),
    { text: text.slice(at, at + q.length), match: true },
    ...(at + q.length < text.length ? [{ text: text.slice(at + q.length) }] : []),
  ])
}

async function searchAgent(agent: Agent, q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q, profile: agent.id, limit: String(PER_AGENT), exclude_sources: HIDDEN_SOURCES.join(',') })
  const res = await api.get<{ results?: Hit[] }>(`/api/sessions/search?${params}`, { signal })
  return (res.results ?? []).flatMap<SearchResult>((h) => {
    const chatId = h.session_id || h.id || ''
    if (!chatId || hidden(h.source, h.title)) return []
    const title = readable(h.title, { files: false }) || readable(h.preview) || 'Chat'
    const base = { agent, chatId, title, at: (h.last_active || h.session_started || h.started_at || 0) * 1000 }
    if (!behindTheScenes(h)) {
      const from = h.role === 'user' ? 'you' : h.role === 'assistant' ? 'agent' : 'other'
      return [{ ...base, from, snippet: parseSnippet(h.snippet ?? '') }]
    }
    // Hermes gives one hit per chat, its best; when that's tool noise, the chat
    // still counts if its opening words hold what was typed (a name that does
    // is found by searchTitles).
    const preview = readable(h.preview)
    const inPreview = preview && preview !== title ? markedIn(preview, q) : undefined
    return inPreview ? [{ ...base, from: 'you', snippet: inPreview }] : []
  })
}

type Session = {
  id: string
  title?: string | null
  preview?: string | null
  source?: string | null
  started_at?: number | null
  last_active?: number | null
  message_count?: number
}

/** Chats whose name matches: people search by what they called a chat. Lists are cached briefly. */
async function searchTitles(qc: QueryClient, agent: Agent, q: string): Promise<SearchResult[]> {
  const { sessions } = await qc.fetchQuery({
    queryKey: ['chat-titles', agent.id],
    queryFn: () => rpc<{ sessions: Session[] }>('session.list', { profile: agent.id, limit: 200 }),
    staleTime: 30_000,
  })
  const needle = q.toLowerCase()
  return sessions.flatMap((s) => {
    const title = readable(s.title)
    if (!title.toLowerCase().includes(needle) || hidden(s.source, s.title) || !s.message_count) return []
    const preview = readable(s.preview)
    return [
      {
        agent,
        chatId: s.id,
        title,
        snippet: preview && preview !== title ? [{ text: preview }] : [],
        from: 'title' as const,
        at: (s.last_active || s.started_at || 0) * 1000,
      },
    ]
  })
}

export type ChatSearch = {
  /** The query the results belong to (debounced, trimmed). */
  query: string
  results: SearchResult[]
  /** True while a search is out, including the debounce wait. */
  searching: boolean
  /** Every agent failed. */
  failed: boolean
  retry: () => void
}

/** Results for `input` across all agents; debounced, keeps old results while typing. */
export function useChatSearch(input: string, delay = 220): ChatSearch {
  const qc = useQueryClient()
  const { data: agents = [] } = useAgents()
  const query = useDebounced(input.trim(), delay)
  const ready = query.length >= MIN_QUERY && agents.length > 0
  const ids = agents.map((a) => a.id).join(',')

  const res = useQuery({
    queryKey: ['search', query, ids],
    enabled: ready,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      const [settled, titled] = await Promise.all([
        Promise.allSettled(agents.map((a) => searchAgent(a, query, signal))),
        Promise.allSettled(agents.map((a) => searchTitles(qc, a, query))),
      ])
      const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
      if (!ok.length && settled.length) throw (settled[0] as PromiseRejectedResult).reason
      // A chat found by its words shows those words; one found only by its name shows its name.
      const found = ok.flat()
      const seen = new Set(found.map((r) => `${r.agent.id}/${r.chatId}`))
      const byTitle = titled
        .flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
        .filter((r) => !seen.has(`${r.agent.id}/${r.chatId}`))
      return [...found, ...byTitle].sort((a, b) => b.at - a.at)
    },
  })

  const typing = input.trim() !== query
  return {
    query: ready ? query : '',
    results: ready ? (res.data ?? []) : [],
    searching: input.trim().length >= MIN_QUERY && (typing || res.isFetching),
    failed: ready && res.isError && !res.data,
    retry: () => void res.refetch(),
  }
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// ── What's being searched (survives opening a result and coming back) ──────

type SearchStore = { active: boolean; text: string }

export const useSearchStore = create<SearchStore>(() => ({ active: false, text: '' }))

export const searchActions = {
  open: () => useSearchStore.setState({ active: true }),
  set: (text: string) => useSearchStore.setState({ text }),
  close: () => useSearchStore.setState({ active: false, text: '' }),
}
