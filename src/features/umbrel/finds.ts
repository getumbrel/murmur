// What an agent found on its Umbrel, read out of umbrelOS's MCP tool results
// so Murmur can show it instead of the agent describing it: the photos and
// files a search turned up, the apps it listed or installed, how the Umbrel
// is doing. Each call gives a piece (`pieceOf`); a turn's pieces settle into
// what's worth showing (`gather`): the latest search, one card per app that
// keeps up with its install, the photos it looked at picked out in the grid.
//
// The shapes are umbrelOS's (packages/umbreld/source/modules/mcp/tools/*.ts).
// Hermes hands each result over as {"result": "<the tool's text>"}, with any
// picture it returned cached and named on a MEDIA: line after the JSON.
//
// A call can also show what's coming (`pendingIn`): a search's card appears,
// titled and shimmering, the moment the agent starts looking.

export type Photo = {
  id: string
  takenAt?: string
  video?: boolean
  /** Seconds into a video or recording where the match is. */
  at?: number
  /** A copy of the picture Hermes already has (the agent looked at it). */
  media?: string
}

export type FileHit = {
  path: string
  name: string
  type?: string
  kind?: string
  size?: number
  modified?: number
  /** Why it matched: its name, words in it, words said in it, or how it looks. */
  match?: string
  snippet?: string
  page?: number
  at?: number
  folder?: boolean
}

export type AppHit = {
  id: string
  name?: string
  state?: string
  progress?: number
  version?: string
  tagline?: string
  update?: boolean
  installed?: boolean
  url?: string
  usage?: { cpu?: number; memory?: number; disk?: number }
}

export type Vitals = {
  cpu?: number
  memory?: { used: number; size: number }
  storage?: { used: number; size: number }
  temperature?: number
  device?: string
  version?: string
}

/** What one call to an Umbrel tool turned up. */
export type Piece =
  | { kind: 'search'; query?: string; filters: string[]; photos: Photo[]; files: FileHit[] }
  | { kind: 'photos'; photos: Photo[]; total?: number }
  | { kind: 'look'; photo: Photo }
  | { kind: 'folder'; path: string; files: FileHit[] }
  | { kind: 'apps'; apps: AppHit[]; store: boolean }
  | { kind: 'app'; app: AppHit }
  | { kind: 'vitals'; vitals: Vitals }

/**
 * A card's worth: what a turn found, settled. `server` is the agent's name for
 * its Umbrel. `pending` while a call that will fill it is still running.
 */
export type Find = { key: string; server: string; pending?: boolean } & (
  | { kind: 'photos'; query?: string; filters: string[]; photos: Photo[]; files: FileHit[]; total?: number; looked: string[] }
  | { kind: 'folder'; path: string; files: FileHit[] }
  | { kind: 'apps'; apps: AppHit[]; store: boolean }
  | { kind: 'app'; app: AppHit }
  | { kind: 'vitals'; vitals: Vitals }
)

const MCP = /^mcp__(.+?)__(.+)$/
/**
 * Murmur connects agents to their Umbrel as "umbrel", and to other Umbrels as
 * "umbrel_office" and so on (umbrel-mcp.ts); an agent may have named it umbrelOS.
 */
const isUmbrel = (server: string) => /^umbrel(os)?(_[a-z0-9_]+)?$/i.test(server)

/** The server and tool an Umbrel call went to, or null for any other tool. */
export function umbrelTool(name: string): { server: string; tool: string } | null {
  const m = MCP.exec(name)
  return m && isUmbrel(m[1]) ? { server: m[1], tool: m[2] } : null
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const PHOTO_ID = /^[a-f0-9]{64}$/

/**
 * A stored result, as the model saw it: a server the agent asks before acting
 * on (umbrel-mcp.ts) has its results wrapped as untrusted data, around the
 * same {"result": …} the live event carries.
 */
const UNTRUSTED = /^<untrusted_tool_result\b[^>]*>[\s\S]*?\n\n(\{[\s\S]*?\})\s*<\/untrusted_tool_result>/

/**
 * A result that hands the model a picture to look at (get_photo with `image`)
 * is several parts: the tool's text first, then a note and the picture. Live
 * it's Hermes's `{_multimodal, text_summary, content}`; stored, each text part
 * is its own untrusted block.
 */
function textOf(raw: unknown): unknown {
  const parts = obj(raw)
  if (!parts?._multimodal) return raw
  return str(parts.text_summary) ?? list(parts.content).flatMap((p) => str(obj(p)?.text) ?? [])[0]
}

/** The tool's own text and any picture Hermes cached from it. */
export function unwrap(result: unknown): { value: unknown; media: string[] } | null {
  let raw: unknown = textOf(result)
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(UNTRUSTED.exec(raw.trim())?.[1] ?? raw)
    } catch {
      return null
    }
  }
  const text = str(obj(raw)?.result)
  if (!text) return null
  const media: string[] = []
  const json = text
    .split('\n')
    .filter((line) => {
      const m = /^MEDIA:(\S.*)$/.exec(line.trim())
      if (m) media.push(m[1].trim())
      return !m
    })
    .join('\n')
  try {
    return { value: JSON.parse(json), media }
  } catch {
    return null
  }
}

function photoOf(v: unknown): Photo | null {
  const p = obj(v)
  const id = str(p?.id)
  if (!p || !id || !PHOTO_ID.test(id)) return null
  return { id, takenAt: str(p.takenAt), video: p.kind === 'video' || undefined }
}

function fileOf(v: unknown): FileHit | null {
  const f = obj(v)
  const path = str(f?.path)
  const name = str(f?.name) ?? path?.split('/').pop()
  if (!f || !path || !name) return null
  const moment = obj(f.moment)
  return {
    path,
    name,
    type: str(f.type),
    kind: str(f.kind),
    size: num(f.size),
    modified: num(f.modified),
    match: str(f.match),
    snippet: str(f.snippet),
    page: num(f.page),
    at: num(moment?.startSeconds),
    folder: f.type === 'directory' || undefined,
  }
}

function appOf(v: unknown): AppHit | null {
  const a = obj(v)
  const id = str(a?.id) ?? str(a?.appId)
  if (!a || !id) return null
  const usage = obj(a.usage)
  return {
    id,
    name: str(a.name),
    state: str(a.state),
    progress: num(a.progress),
    version: str(a.version),
    tagline: str(a.tagline),
    update: typeof a.updateAvailable === 'boolean' ? a.updateAvailable : undefined,
    installed: typeof a.installed === 'boolean' ? a.installed : undefined,
    url: str(a.url),
    usage: usage && { cpu: num(usage.cpu), memory: num(usage.memory), disk: num(usage.disk) },
  }
}

const OPERATION_STATE: Record<string, string> = {
  install: 'installing',
  start: 'starting',
  stop: 'stopping',
  restart: 'restarting',
  update: 'updating',
  uninstall: 'uninstalling',
}

/** What a call to an Umbrel tool turned up, or null for anything Murmur doesn't show. */
export function pieceOf(name: string, args: unknown, result: unknown): Piece | null {
  const tool = umbrelTool(name)?.tool
  if (!tool) return null
  const out = unwrap(result)
  if (!out) return null
  const v = out.value
  const r = obj(v)
  switch (tool) {
    case 'search': {
      const photos: Photo[] = []
      const files: FileHit[] = []
      for (const hit of list(r?.results)) {
        const h = obj(hit)
        const photo = photoOf(obj(h?.photo))
        if (photo) {
          const at = num(obj(h?.moment)?.startSeconds)
          photos.push({ ...photo, video: h?.kind === 'video' || undefined, ...(at != null && { at }) })
        } else {
          const file = fileOf(h)
          if (file) files.push(file)
        }
      }
      const understood = obj(r?.understood)
      const filters = list(understood?.filters).flatMap((f) => str(obj(f)?.label) ?? [])
      // What the agent asked for reads better than what's left once umbrelOS took its filters out.
      const query = str(obj(args)?.query) ?? str(understood?.text)
      // Nothing found is worth showing too (`gather` keeps it out of the chat).
      return { kind: 'search', query, filters, photos, files }
    }
    case 'list_photos': {
      const photos = list(r?.items).flatMap((i) => photoOf(i) ?? [])
      return photos.length ? { kind: 'photos', photos, total: num(r?.total) } : null
    }
    case 'get_photo': {
      const photo = photoOf(r)
      return photo ? { kind: 'look', photo: { ...photo, media: out.media[0] } } : null
    }
    case 'list_directory': {
      const files = list(r?.files).flatMap((f) => fileOf(f) ?? [])
      return files.length ? { kind: 'folder', path: str(r?.path) ?? str(obj(args)?.path) ?? '/', files } : null
    }
    case 'list_apps':
      return { kind: 'apps', apps: list(v).flatMap((a) => appOf(a) ?? []), store: false }
    case 'search_app_store': {
      const apps = list(v).flatMap((a) => appOf(a) ?? [])
      return apps.length ? { kind: 'apps', apps, store: true } : null
    }
    case 'get_app_details':
    case 'get_app_store_details':
    case 'get_app_status': {
      const app = appOf(r)
      return app ? { kind: 'app', app } : null
    }
    case 'install_app':
    case 'start_app':
    case 'stop_app':
    case 'restart_app':
    case 'update_app':
    case 'uninstall_app': {
      const id = str(r?.appId)
      const state = OPERATION_STATE[str(r?.operation) ?? '']
      return id && r?.accepted ? { kind: 'app', app: { id, state, progress: state === 'installing' ? 0 : undefined } } : null
    }
    case 'get_system_resources': {
      const memory = obj(r?.memory)
      const storage = obj(r?.storage)
      const pair = (o?: Json) => {
        const used = num(o?.totalUsed)
        const size = num(o?.size)
        return used != null && size ? { used, size } : undefined
      }
      return {
        kind: 'vitals',
        vitals: {
          cpu: num(obj(r?.cpu)?.totalUsed),
          memory: pair(memory),
          storage: pair(storage),
          temperature: num(obj(r?.temperature)?.temperature),
        },
      }
    }
    case 'get_system_info':
      return { kind: 'vitals', vitals: { device: str(r?.productName) ?? str(r?.device), version: str(r?.versionName) } }
  }
  return null
}

/** What a step found on the Umbrel, kept on the step (ChatItem `found`), or what it's about to (`pending`). */
export type Found = { server: string; piece: Piece; pending?: boolean }

export function foundIn(name: string, args: unknown, result: unknown): Found | undefined {
  const tool = umbrelTool(name)
  const piece = tool && pieceOf(name, args, result)
  return piece ? { server: tool.server, piece } : undefined
}

/**
 * What a call that's just started will turn up, as far as its arguments say:
 * a search's query, the photo it's opening, the app it's installing. Its card
 * shows at once and fills in when the result comes.
 */
export function pendingIn(name: string, args: unknown): Found | undefined {
  const tool = umbrelTool(name)
  if (!tool) return undefined
  let a = obj(args)
  if (typeof args === 'string') {
    try {
      a = obj(JSON.parse(args))
    } catch {
      /* no arguments to go on */
    }
  }
  const piece = ((): Piece | null => {
    switch (tool.tool) {
      case 'search':
        return { kind: 'search', query: str(a?.query), filters: [], photos: [], files: [] }
      case 'list_photos':
        return { kind: 'photos', photos: [] }
      case 'get_photo': {
        const id = str(a?.id)
        return id && PHOTO_ID.test(id) ? { kind: 'look', photo: { id } } : null
      }
      case 'list_directory':
        return { kind: 'folder', path: str(a?.path) ?? '/', files: [] }
      case 'list_apps':
        return { kind: 'apps', apps: [], store: false }
      case 'search_app_store':
        return { kind: 'apps', apps: [], store: true }
      case 'install_app':
      case 'start_app':
      case 'stop_app':
      case 'restart_app':
      case 'update_app':
      case 'uninstall_app': {
        const id = str(a?.appId)
        const state = OPERATION_STATE[tool.tool.replace(/_app$/, '')]
        return id ? { kind: 'app', app: { id, state, progress: state === 'installing' ? 0 : undefined } } : null
      }
      case 'get_system_resources':
      case 'get_system_info':
        return { kind: 'vitals', vitals: {} }
    }
    return null
  })()
  return piece ? { server: tool.server, piece, pending: true } : undefined
}

const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>

/**
 * A turn's pieces, settled into cards: the newest search or photo list (with
 * what the agent looked at picked out in it), each folder, one list of apps,
 * one card per app that follows it as it installs, and one for the Umbrel's
 * health. Cards keep the order they first appeared in.
 *
 * On a call (`live`) the cards also show what's still coming (pieces marked
 * `pending`) and a search that found nothing; the chat shows neither.
 */
export function gather(pieces: Found[], { live = false } = {}): Find[] {
  // (A Map keeps a key where it was first set: a newer card takes the older one's place in line.)
  const cards = new Map<string, Find>()
  const put = (find: Find) => cards.set(find.key, find)
  const looks: Photo[] = []
  for (const { server, piece, pending } of pieces) {
    if (pending && !live) continue
    switch (piece.kind) {
      case 'search':
      case 'photos': {
        const had = cards.get('photos')
        const found = piece.photos.length > 0 || (piece.kind === 'search' && piece.files.length > 0)
        const shown = had?.kind === 'photos' && (had.photos.length > 0 || had.files.length > 0)
        const query = piece.kind === 'search' ? piece.query : undefined
        // Another look, or a look that found nothing: what's on screen stays while it does.
        if (shown && (pending || !found)) {
          put({ ...had, pending: pending || undefined, ...(pending && query ? { query } : {}) })
          break
        }
        put({
          key: 'photos',
          server,
          kind: 'photos',
          query,
          filters: piece.kind === 'search' ? piece.filters : [],
          photos: piece.photos,
          files: piece.kind === 'search' ? piece.files : [],
          total: piece.kind === 'photos' ? piece.total : undefined,
          looked: [],
          pending: pending || undefined,
        })
        break
      }
      case 'look':
        looks.push(piece.photo)
        if (!cards.has('photos')) put({ key: 'photos', server, kind: 'photos', filters: [], photos: [], files: [], looked: [] })
        break
      case 'folder': {
        const key = `folder:${piece.path}`
        const had = cards.get(key)
        put(pending && had ? { ...had, pending } : { key, server, kind: 'folder', path: piece.path, files: piece.files, pending: pending || undefined })
        break
      }
      case 'apps': {
        const key = piece.store ? 'store' : 'apps'
        const had = cards.get(key)
        put(pending && had ? { ...had, pending } : { key, server, kind: 'apps', apps: piece.apps, store: piece.store, pending: pending || undefined })
        // The installed apps, listed after it worked on one, say how that went: an app it was
        // removing that isn't there any more is gone, and one that is there is as listed.
        if (piece.store || pending) break
        for (const card of cards.values()) {
          if (card.kind !== 'app') continue
          const now = piece.apps.find((a) => a.id === card.app.id)
          if (now) put({ ...card, app: { ...card.app, ...defined(now) } })
          else if (card.app.state === 'uninstalling') put({ ...card, app: { ...card.app, state: 'removed', progress: undefined } })
        }
        break
      }
      case 'app': {
        const key = `app:${piece.app.id}`
        const had = cards.get(key)
        const before = had?.kind === 'app' ? had.app : undefined
        // Known from a list this turn: start from what it said.
        const listed = [...cards.values()].flatMap((c) => (c.kind === 'apps' ? c.apps : [])).find((a) => a.id === piece.app.id)
        // A check on an app that's already changing doesn't reset its progress.
        const next = pending && before ? { state: piece.app.state ?? before.state } : defined(piece.app)
        put({ key, server, kind: 'app', app: { ...listed, ...before, ...next, id: piece.app.id } })
        break
      }
      case 'vitals': {
        const had = cards.get('vitals')
        put({
          key: 'vitals',
          server,
          kind: 'vitals',
          vitals: { ...(had?.kind === 'vitals' ? had.vitals : {}), ...defined(piece.vitals) },
          pending: pending || undefined,
        })
        break
      }
    }
  }
  // What it looked at: picked out where the grid has it, added where it doesn't.
  const grid = cards.get('photos')
  if (grid?.kind === 'photos' && looks.length) {
    const photos = grid.photos.map((p) => {
      const seen = looks.find((l) => l.id === p.id)
      return seen ? { ...p, media: seen.media ?? p.media } : p
    })
    const extra = looks.filter((l) => !photos.some((p) => p.id === l.id))
    cards.set('photos', { ...grid, photos: [...extra, ...photos], looked: [...new Set(looks.map((l) => l.id))] })
  }
  const followed = new Set([...cards.values()].flatMap((c) => (c.kind === 'app' ? [c.app.id] : [])))
  return [...cards.values()].filter((c) => {
    if (c.kind === 'photos') return c.photos.length > 0 || c.files.length > 0 || live
    // The store's results, once the app it picked has its own card, say nothing more.
    if (c.kind === 'apps' && c.store) return !c.apps.every((a) => followed.has(a.id))
    return true
  })
}

/**
 * Cards for a turn's runs of steps (a reply can stop for your OK and carry on
 * in a new run). Each card shows once, under the last run that changed it,
 * with everything the turn knew about it by then: an install that started
 * before you said OK finishes in the run after.
 */
export function placeFinds(runs: Found[][]): Find[][] {
  const sofar: Found[] = []
  const cards = runs.map((run) => {
    sofar.push(...run)
    return run.length ? gather(sofar) : []
  })
  const touched = runs.map((run) => new Set(gather(run).map((f) => f.key)))
  return cards.map((list, i) => list.filter((f) => touched[i].has(f.key) && !touched.slice(i + 1).some((later) => later.has(f.key))))
}

export const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "home-assistant" → "Home Assistant", for an app known only by its id. */
export const appName = (id: string) => id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** A short name for a card, for the call's shelf. */
export function findLabel(find: Find) {
  switch (find.kind) {
    case 'photos':
      return find.photos.length
        ? count(Math.max(find.total ?? 0, find.photos.length), 'photo')
        : find.files.length
          ? count(find.files.length, 'file')
          : find.query
            ? sentence(find.query)
            : 'Photos'
    case 'folder':
      return find.path.split('/').filter(Boolean).pop() ?? 'Files'
    case 'apps':
      return find.store ? 'App Store' : 'Apps'
    case 'app':
      return find.app.name ?? appName(find.app.id)
    case 'vitals':
      return 'Your Umbrel'
  }
}
