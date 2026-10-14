// Hermes tool names → warm, present-tense words people understand. The raw
// name never reaches the screen; unknown tools fall back to humanized text.

export type ToolCategory =
  | 'web'
  | 'browser'
  | 'terminal'
  | 'file'
  | 'code'
  | 'helper'
  | 'memory'
  | 'playbook'
  | 'plan'
  | 'vision'
  | 'image'
  | 'voice'
  | 'message'
  | 'schedule'
  | 'question'
  | 'history'
  | 'other'

export type ToolLabel = { label: string; category: ToolCategory; detail?: string }

type Args = Record<string, unknown>
type Rule = {
  label: string
  category: ToolCategory
  detail?: (a: Args) => string | undefined
  /** Hermes's own one-line summary is jargon here (a shell command): never show it. */
  private?: boolean
  /** Verb that reads naturally with the detail: "Reading" + "notes.md". */
  verb?: string
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const pick = (a: Args, ...keys: string[]) => keys.map((k) => str(a[k])).find(Boolean)

export function basename(path: string) {
  const clean = path.replace(/[/\\]+$/, '')
  return clean.slice(clean.search(/[^/\\]*$/)) || clean
}

export function domain(url: string) {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const query = (a: Args) => pick(a, 'query', 'q', 'search', 'pattern', 'text')
const path = (a: Args) => {
  const p = pick(a, 'path', 'file_path', 'file', 'filename', 'target')
  return p && basename(p)
}
const url = (a: Args) => {
  const u = pick(a, 'url', 'href')
  if (u) return domain(u)
  const urls = a.urls
  return Array.isArray(urls) && typeof urls[0] === 'string' ? domain(urls[0]) : undefined
}
/** Commands are jargon; the site one reaches is the only part worth saying. */
const site = (a: Args) => {
  const u = /https?:\/\/[^\s'"`]+/.exec(pick(a, 'command', 'cmd') ?? '')?.[0]
  return u ? domain(u) : undefined
}

const RULES: Record<string, Rule> = {
  web_search: { label: 'Searching the web', category: 'web', detail: query },
  web_extract: { label: 'Reading a page', category: 'web', detail: url },
  web_crawl: { label: 'Reading a website', category: 'web', detail: url },

  browser_navigate: { label: 'Opening a page', category: 'browser', detail: url },
  browser_click: { label: 'Clicking', category: 'browser', detail: (a) => pick(a, 'element', 'ref', 'text') },
  browser_type: { label: 'Typing', category: 'browser', detail: (a) => pick(a, 'text') },
  browser_snapshot: { label: 'Looking at the page', category: 'browser' },
  browser_scroll: { label: 'Scrolling the page', category: 'browser' },
  browser_back: { label: 'Going back', category: 'browser' },
  browser_press: { label: 'Pressing a key', category: 'browser', detail: (a) => pick(a, 'key') },
  browser_vision: { label: 'Looking at the page', category: 'vision' },
  browser_get_images: { label: 'Collecting images', category: 'browser' },
  browser_close: { label: 'Closing the browser', category: 'browser' },

  terminal: { label: 'Running a command', category: 'terminal', detail: site, private: true },
  process: { label: 'Checking on a task', category: 'terminal' },

  read_file: { label: 'Reading a file', verb: 'Reading', category: 'file', detail: path },
  write_file: { label: 'Writing a file', verb: 'Writing', category: 'file', detail: path },
  patch: { label: 'Editing a file', verb: 'Editing', category: 'file', detail: path },
  search_files: { label: 'Searching files', category: 'file', detail: query },

  execute_code: { label: 'Running code', category: 'code' },
  delegate_task: { label: 'Asking a helper', category: 'helper', detail: (a) => pick(a, 'goal', 'task') },
  memory: { label: 'Remembering', category: 'memory' },
  todo: { label: 'Planning', category: 'plan' },
  vision_analyze: { label: 'Looking at the image', category: 'vision' },
  image_generate: { label: 'Making an image', category: 'image', detail: (a) => pick(a, 'prompt') },
  text_to_speech: { label: 'Recording a voice note', category: 'voice' },
  send_message: { label: 'Sending a message', category: 'message', detail: (a) => pick(a, 'target', 'to') },
  cronjob: { label: 'Scheduling', category: 'schedule', detail: (a) => pick(a, 'name', 'schedule') },
  clarify: { label: 'Asking you', category: 'question' },
  session_search: { label: 'Looking through past chats', category: 'history', detail: query },
}

const PREFIXES: [string, Rule][] = [
  ['browser_', { label: 'Using the browser', category: 'browser', detail: url }],
  ['skill', { label: 'Following a playbook', category: 'playbook', detail: (a) => pick(a, 'name', 'skill') }],
  ['web_', { label: 'Searching the web', category: 'web', detail: query }],
]

function humanize(name: string) {
  const words = name
    .replace(/^mcp_+/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\-.:\s]+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Working'
}

function parseArgs(args: unknown): Args {
  if (args && typeof args === 'object' && !Array.isArray(args)) return args as Args
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args)
      if (parsed && typeof parsed === 'object') return parsed as Args
    } catch {
      /* not JSON: treat as a free-form preview */
    }
  }
  return {}
}

const clip = (s: string, max = 48) => {
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/**
 * Human label, icon category and a short detail for a Hermes tool call.
 * `args` may be an object or a JSON string; `preview` is Hermes' own one-line
 * summary, used when args don't yield a detail.
 */
export function toolLabel(name: string, args?: unknown, preview?: string): ToolLabel {
  const rule = RULES[name] ?? PREFIXES.find(([p]) => name.startsWith(p))?.[1]
  const a = parseArgs(args)
  if (!rule) {
    const detail = str(preview)
    return { label: humanize(name), category: 'other', detail: detail && clip(detail) }
  }
  const detail = rule.detail?.(a) ?? (rule.detail && !rule.private ? str(preview) : undefined)
  if (detail && rule.verb) return { label: `${rule.verb} ${clip(detail, 40)}`, category: rule.category }
  return { label: rule.label, category: rule.category, detail: detail && clip(detail) }
}

export function toolCategory(name: string): ToolCategory {
  return toolLabel(name).category
}

// ── Past tense, for steps that are done and the summary of a stretch of work.

const PAST: Record<string, string> = {
  Searching: 'Searched',
  Reading: 'Read',
  Opening: 'Opened',
  Clicking: 'Clicked',
  Typing: 'Typed',
  Looking: 'Looked',
  Scrolling: 'Scrolled',
  Going: 'Went',
  Pressing: 'Pressed',
  Collecting: 'Collected',
  Closing: 'Closed',
  Using: 'Used',
  Running: 'Ran',
  Checking: 'Checked',
  Writing: 'Wrote',
  Editing: 'Edited',
  Asking: 'Asked',
  Remembering: 'Remembered',
  Planning: 'Planned',
  Making: 'Made',
  Recording: 'Recorded',
  Sending: 'Sent',
  Scheduling: 'Scheduled',
  Following: 'Followed',
}

/** "Searching the web" → "Searched the web". Labels it doesn't know stay as they are. */
export function pastLabel(label: string) {
  const [verb, ...rest] = label.split(' ')
  const past = PAST[verb]
  return past ? [past, ...rest].join(' ') : label
}

/** How a run of the same kind of step reads afterwards: one, or `n` of them. */
type Done = { key: string; one: string; many?: (n: number) => string }

const DONE: Record<string, Done> = {
  web_search: { key: 'search', one: 'Searched the web' },
  web_extract: { key: 'page', one: 'Read a page', many: (n) => `Read ${n} pages` },
  web_crawl: { key: 'page', one: 'Read a website', many: (n) => `Read ${n} pages` },
  terminal: { key: 'command', one: 'Ran a command', many: (n) => `Ran ${n} commands` },
  process: { key: 'command', one: 'Checked on a task', many: (n) => `Ran ${n} commands` },
  read_file: { key: 'read', one: 'Read a file', many: (n) => `Read ${n} files` },
  write_file: { key: 'edit', one: 'Wrote a file', many: (n) => `Edited ${n} files` },
  patch: { key: 'edit', one: 'Edited a file', many: (n) => `Edited ${n} files` },
  search_files: { key: 'find', one: 'Searched files' },
  execute_code: { key: 'code', one: 'Ran some code' },
  delegate_task: { key: 'helper', one: 'Asked a helper', many: (n) => `Asked ${n} helpers` },
  memory: { key: 'memory', one: 'Updated memory' },
  todo: { key: 'plan', one: 'Made a plan' },
  vision_analyze: { key: 'look', one: 'Looked at an image', many: (n) => `Looked at ${n} images` },
  browser_vision: { key: 'browse', one: 'Used the browser' },
  image_generate: { key: 'image', one: 'Made an image', many: (n) => `Made ${n} images` },
  text_to_speech: { key: 'voice', one: 'Recorded a voice note', many: (n) => `Recorded ${n} voice notes` },
  send_message: { key: 'message', one: 'Sent a message', many: (n) => `Sent ${n} messages` },
  cronjob: { key: 'schedule', one: 'Set up a routine' },
  clarify: { key: 'ask', one: 'Asked you' },
  session_search: { key: 'history', one: 'Looked through past chats' },
}

const DONE_PREFIXES: [string, Done][] = [
  ['browser_', { key: 'browse', one: 'Used the browser' }],
  ['skill', { key: 'playbook', one: 'Followed a playbook' }],
  ['web_', { key: 'search', one: 'Searched the web' }],
]

const OTHER: Done = { key: 'other', one: 'Used a tool', many: (n) => `Used ${n} tools` }

/**
 * What a set of tool calls did, in a few human words: "Searched the web",
 * "Read 3 pages", "Searched the web and read 2 pages". Undefined when it was
 * too varied to say briefly.
 */
export function didSummary(names: string[]): string | undefined {
  const groups = new Map<string, { done: Done; n: number }>()
  for (const name of names) {
    const done = DONE[name] ?? DONE_PREFIXES.find(([p]) => name.startsWith(p))?.[1] ?? OTHER
    const g = groups.get(done.key)
    if (g) g.n++
    else groups.set(done.key, { done, n: 1 })
  }
  if (!groups.size || groups.size > 2) return undefined
  const [a, b] = [...groups.values()].map(({ done, n }) => (n > 1 && done.many ? done.many(n) : done.one))
  return b ? `${a} and ${b[0].toLowerCase()}${b.slice(1)}` : a
}
