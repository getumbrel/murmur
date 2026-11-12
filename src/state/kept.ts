// What this device keeps of what it has seen, so Murmur has something to show
// when its server or Hermes can't be reached: the lists of chats (who said
// what last, which are pinned, what routines found) and the conversations
// opened here lately, as they stood. The roster is kept the same way, in
// local storage, so it's there before anything is drawn (state/agents.ts).
//
// Nothing is ever answered from here while Hermes can answer: a kept list is
// shown and asked for afresh at once, and a kept conversation only stands in
// while the real one can't be read. Each Hermes's things are filed under it
// (hermes/instance.ts). Signing out of Murmur forgets all of it, removing a
// Hermes forgets its own, and deleting a chat forgets that chat.

import type { Query, QueryClient, QueryKey } from '@tanstack/react-query'
import { scopeOf, tabHermes } from '@/hermes/instance'
import type { ChatItem } from '@/features/chat/types'

const DB = 'murmur-kept'
const LISTS = 'lists'
const CHATS = 'chats'
/** The Murmur keeping it (vite.config.ts): what an older one kept may lack what this one needs. */
const VERSION = typeof __MURMUR_VERSION__ === 'string' ? __MURMUR_VERSION__ : ''

/** How many conversations stay on the device: the ones opened most recently. */
const MAX_CHATS = 40
/** How much of a long one: its newest messages, as many as a chat first shows. */
const MAX_ITEMS = 400
/** A list nobody has looked at in this long has likely outlived what it lists. */
const LIST_LIFE_MS = 30 * 24 * 60 * 60 * 1000

const filedUnder = (hermes = tabHermes()) => `${scopeOf(hermes)}\n`
const all = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}￿`)

let opening: Promise<IDBDatabase> | undefined

/** Rejects where there's no storage (a private window, an old browser): nothing is kept there. */
function db() {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LISTS, { keyPath: 'key' })
      request.result.createObjectStore(CHATS, { keyPath: 'key' })
    }
    request.onsuccess = () => {
      // Another tab forgetting everything (signing out) mustn't wait on this one.
      request.result.onversionchange = () => {
        request.result.close()
        opening = undefined
      }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('blocked'))
  }).catch((error) => {
    opening = undefined
    throw error
  }))
}

async function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void) {
  const tx = (await db()).transaction(store, mode)
  return new Promise<T | undefined>((resolve, reject) => {
    let request: IDBRequest<T> | void
    try {
      request = work(tx.objectStore(store))
    } catch (error) {
      // Something that can't be stored (a function, a DOM node) slipped into what was handed over.
      return reject(error)
    }
    tx.oncomplete = () => resolve(request ? request.result : undefined)
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
}

// ── Lists ───────────────────────────────────────────────────────────────────

type KeptList = { key: string; queryKey: QueryKey; data: unknown; at: number; version: string }

/**
 * The queries worth having without Hermes: an agent's chats and when each
 * last moved, its routines and what they found, and groups. Named by the
 * first word of their key. Nothing private beyond what Home already shows
 * (no memory, passwords, email or apps).
 */
const LISTED = new Set([
  'chats',
  'routines',
  'routine-runs',
  'routine-job-runs',
  'routine-finding',
  'run-of',
  'routine-run-result',
  'groups',
  'group-summaries',
])

const listed = (query: Query) => LISTED.has(String(query.queryKey[0]))

/**
 * Puts back the lists this device kept, and keeps them as Hermes answers from
 * here on. A kept list has no time (`updatedAt: 0`), like the kept roster: it's
 * shown, asked for at once, and replaced by the answer. One Hermes has
 * already answered is left alone. Call once, with the app's query client.
 */
export function keepLists(qc: QueryClient) {
  const mine = filedUnder()
  void run<KeptList[]>(LISTS, 'readonly', (s) => s.getAll(all(mine)))
    .then((lists) => {
      const stale: string[] = []
      for (const list of lists ?? []) {
        if (list.version !== VERSION || Date.now() - list.at > LIST_LIFE_MS) stale.push(list.key)
        else if (qc.getQueryData(list.queryKey) === undefined) qc.setQueryData(list.queryKey, list.data, { updatedAt: 0 })
      }
      if (stale.length) void run(LISTS, 'readwrite', (s) => stale.forEach((key) => void s.delete(key))).catch(() => {})
    })
    .catch(() => {})

  const waiting = new Map<string, ReturnType<typeof setTimeout>>()
  qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    const { query } = event
    // Only what Hermes said: a kept list put back above has no time.
    if (!listed(query) || !query.state.dataUpdatedAt || query.state.data === undefined) return
    clearTimeout(waiting.get(query.queryHash))
    waiting.set(
      query.queryHash,
      setTimeout(() => {
        waiting.delete(query.queryHash)
        const list: KeptList = {
          key: mine + query.queryHash,
          queryKey: query.queryKey,
          data: query.state.data,
          at: Date.now(),
          version: VERSION,
        }
        void run(LISTS, 'readwrite', (s) => void s.put(list)).catch(() => {})
      }, 800),
    )
  })
}

// ── Conversations ───────────────────────────────────────────────────────────

export type KeptChat = {
  id: string
  profile: string
  title?: string
  items: ChatItem[]
  /** When it was last seen like this. */
  at: number
}

type KeptChatRow = KeptChat & { key: string; version: string }

/** As it can be shown again: nothing still on its way, and no picture that only lived in the page that sent it. */
function lasting(items: ChatItem[]): ChatItem[] {
  return items.slice(-MAX_ITEMS).flatMap((item): ChatItem[] => {
    if (item.kind !== 'user') return [item]
    if (item.pending) return []
    const attachments = item.attachments?.map((a) => (a.kind === 'image' && a.url?.startsWith('blob:') ? { ...a, url: undefined } : a))
    return [{ ...item, attachments, images: item.images?.filter((url) => !url.startsWith('blob:')) }]
  })
}

/** Keep a conversation as it stands now. */
export function keepChat(chat: { id: string; profile: string; title?: string; items: ChatItem[] }) {
  const row: KeptChatRow = {
    key: filedUnder() + chat.id,
    id: chat.id,
    profile: chat.profile,
    title: chat.title,
    items: lasting(chat.items),
    at: Date.now(),
    version: VERSION,
  }
  return run(CHATS, 'readwrite', (s) => void s.put(row))
    .then(thin)
    .catch(() => {})
}

let thinned = 0

/** Lets go of all but the conversations seen most recently, now and then. */
async function thin() {
  if (Date.now() - thinned < 60_000) return
  thinned = Date.now()
  const rows = (await run<KeptChatRow[]>(CHATS, 'readonly', (s) => s.getAll(all(filedUnder())))) ?? []
  const old = rows.sort((a, b) => b.at - a.at).slice(MAX_CHATS)
  if (old.length) await run(CHATS, 'readwrite', (s) => old.forEach((row) => void s.delete(row.key)))
}

/** A conversation as this device last saw it, if it kept it. */
export async function keptChat(id: string): Promise<KeptChat | undefined> {
  const row = await run<KeptChatRow | undefined>(CHATS, 'readonly', (s) => s.get(filedUnder() + id)).catch(() => undefined)
  return row && row.version === VERSION && row.items.length ? row : undefined
}

/** A chat was deleted: its kept copy goes too. */
export function forgetKeptChat(id: string) {
  void run(CHATS, 'readwrite', (s) => void s.delete(filedUnder() + id)).catch(() => {})
}

// ── Forgetting ──────────────────────────────────────────────────────────────

/** Forget what was kept for one Hermes (it was removed). */
export function forgetKeptFor(hermes: string) {
  const theirs = all(filedUnder(hermes))
  for (const store of [LISTS, CHATS]) void run(store, 'readwrite', (s) => void s.delete(theirs)).catch(() => {})
}

/** Forget everything kept, for every Hermes: signing out of Murmur locks them all. */
export function forgetKept() {
  return new Promise<void>((resolve) => {
    const done = () => resolve()
    try {
      void opening?.then((open) => open.close()).catch(() => {})
      opening = undefined
      const request = indexedDB.deleteDatabase(DB)
      request.onsuccess = request.onerror = request.onblocked = done
    } catch {
      done()
    }
  })
}
