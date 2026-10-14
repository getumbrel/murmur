// Agents deliver files and widgets inside their reply text:
//
//   MEDIA:/opt/data/cache/picture.jpg        a file (own line or inline)
//   ::preview{file="/opt/data/chart.html"}   a live HTML widget, alone on its line
//
// We cut the reply into prose and blocks so each renders in place. The
// patterns mirror Hermes Desktop's (apps/desktop/src/lib/chat-messages/parts.ts
// and transcript-directives.ts), so agents behave the same in both apps.

export type Segment = { kind: 'md'; text: string } | { kind: 'media'; path: string } | { kind: 'preview'; file: string }

// Extensions that can end an unquoted path, which lets a path contain spaces.
const EXTS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tiff',
  'svg',
  'avif',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  '3gp',
  'm4v',
  'mp3',
  'm2a',
  'wav',
  'ogg',
  'opus',
  'm4a',
  'aac',
  'flac',
  'pdf',
  'docx',
  'doc',
  'odt',
  'rtf',
  'txt',
  'md',
  'epub',
  'xlsx',
  'xls',
  'ods',
  'csv',
  'tsv',
  'json',
  'xml',
  'yaml',
  'yml',
  'kmz',
  'kml',
  'geojson',
  'gpx',
  'pptx',
  'ppt',
  'odp',
  'key',
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'apk',
  'ipa',
  'html',
  'htm',
  'py',
  'js',
  'ts',
].sort((a, b) => b.length - a.length)

const PATH = `(?:~/|/|[A-Za-z]:[/\\\\])\\S+?(?:[^\\S\\n]+\\S+?)*?\\.(?:${EXTS.join('|')})(?=[\\s\`"'*_,;:)\\]}]|MEDIA:|$)`
const VALUE = `\`[^\`\\n]+\`|"[^"\\n]+"|'[^'\\n]+'|${PATH}|\\S+`
const MEDIA_TAG = new RegExp(`[\`"']?MEDIA:\\s*(${VALUE})[\`"']?`, 'g')
/** Where a delivered file can be: an absolute path, a home path, a drive, or a web link. */
const LOCATION = /^(?:\/[^/\s]|~\/|[A-Za-z]:[/\\]|https?:\/\/)/
const DIRECTIVE = /^::([a-z][a-z0-9-]{0,63})(?:\{([^{}]{0,1024})\})?$/
const ATTR = /([a-z][\w-]{0,63})=(?:"([^"]*)"|'([^']*)')/gi
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

function unquote(value: string) {
  const t = value.trim()
  const q = t[0]
  if (q && q === t.at(-1) && t.length > 1 && ['"', "'", '`'].includes(q)) return t.slice(1, -1)
  // The bare fallback keeps whatever followed the path; peel sentence punctuation.
  return t.replace(/[.,;:!?)\]}*_]+$/, '')
}

function attrs(raw = '') {
  const out: Record<string, string> = {}
  for (const m of raw.matchAll(ATTR)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
  return out
}

/**
 * Split a reply into prose and blocks. While `streaming`, a half-written tag
 * on the last line stays hidden instead of flashing as text (or as a broken
 * file whose path is still arriving).
 */
export function splitMessage(text: string, streaming = false): Segment[] {
  if (!text.includes('MEDIA:') && !text.includes('::')) return [{ kind: 'md', text }]
  const out: Segment[] = []
  let prose: string[] = []
  const flush = () => {
    const md = prose.join('\n')
    if (md.trim()) out.push({ kind: 'md', text: md })
    prose = []
  }
  const lines = text.split('\n')
  let fence: string | null = null

  lines.forEach((line, i) => {
    const open = FENCE.exec(line)
    if (fence) {
      if (
        open &&
        open[1][0] === fence[0] &&
        open[1].length >= fence.length &&
        !line.trim().slice(open[1].length).trim()
      )
        fence = null
      prose.push(line)
      return
    }
    if (open) {
      fence = open[1]
      prose.push(line)
      return
    }

    const unfinished = streaming && i === lines.length - 1
    const trimmed = line.trim()

    if (trimmed.startsWith('::')) {
      const d = DIRECTIVE.exec(trimmed)
      if (d?.[1] === 'preview') {
        const file = attrs(d[2]).file
        if (file) {
          flush()
          out.push(/\.(?:html?|xhtml)$/i.test(file) ? { kind: 'preview', file } : { kind: 'media', path: file })
          return
        }
      }
      if (unfinished) return
    }

    if (!line.includes('MEDIA:')) {
      prose.push(line)
      return
    }
    if (unfinished) {
      // Show the words before the tag; hold the tag until its line is done.
      const before = line.slice(0, line.indexOf('MEDIA:')).replace(/[`"']$/, '')
      if (before.trim()) prose.push(before)
      return
    }
    const paths: string[] = []
    const rest = line.replace(MEDIA_TAG, (tag: string, value: string) => {
      const path = unquote(value)
      // Only a real file or link is a delivery. Prose *about* the tag
      // ("I used the `MEDIA:path` tag") stays words.
      if (!LOCATION.test(path)) return tag
      paths.push(path)
      return ''
    })
    const words = rest
      .replace(/([^\s]) {2,}/g, '$1 ')
      .replace(/ +([.,;!?])/g, '$1')
      .replace(/\s+$/, '')
    if (words.trim() && !/^[\s:,.;\-–—*_>]*$/.test(words)) prose.push(words)
    if (paths.length) {
      flush()
      for (const path of paths) out.push({ kind: 'media', path })
    }
  })
  flush()
  return out.length ? out : [{ kind: 'md', text: '' }]
}

/** The reply as words only (for Copy): tags and widgets removed. */
export function proseOf(text: string) {
  return splitMessage(text)
    .flatMap((s) => (s.kind === 'md' ? [s.text.trim()] : []))
    .join('\n\n')
}

/** Every file a reply delivers. */
export function mediaPathsOf(text: string) {
  return splitMessage(text).flatMap((s) => (s.kind === 'media' ? [s.path] : s.kind === 'preview' ? [s.file] : []))
}

// ── What the person attached, as stored in history ─────────────────────────

import type { UserAttachment } from '@/features/chat/types'
import { scoped } from '@/hermes/instance'
export type { UserAttachment }

const ATTACHED_CONTEXT = /(?:^|\n)--- Attached Context ---\s*\n[\s\S]*$/
const CONTEXT_WARNINGS = /(?:^|\n)--- Context Warnings ---[\s\S]*$/
const RUNTIME_CONTEXT = /\n*Umbrel Runtime Context:[\s\S]*$/
const IMAGE_ATTACHED = /\[Image attached at: ([^\]\n]+)\]/g
const IMAGE_ATTACHED_TAIL = /\n*\[Image attached at: [^\]]+\][\s\S]*$/
const REF = /@(file|image):(`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|\S+)/g
const SCREENSHOT_LINE = /^\[screenshot\]\n?/gm

const nameOf = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || path

// Hermes saves an attached picture under its own name (upload_…png). Remember
// what the person called it, so history shows "teal.png", not the upload file.
const NAMES_KEY = scoped('murmur:upload-names')
const UPLOAD = /^upload_\d{8}_\d{6}_\d+(\.\w+)$/

function uploadNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function rememberUpload(path: string, name: string) {
  try {
    // The newest few hundred are plenty: older ones read "image.png".
    const all = Object.entries({ ...uploadNames(), [path]: name }).slice(-300)
    localStorage.setItem(NAMES_KEY, JSON.stringify(Object.fromEntries(all)))
  } catch {}
}

/** What the person called a file: an upload's own name never shows. */
const nameFor = (path: string, names: Record<string, string>) =>
  names[path] ?? nameOf(path).replace(UPLOAD, 'image$1')

/**
 * Split a stored user message into the words the person typed and the files
 * they attached. Hermes stores the expanded prompt: image markers, `@file:` /
 * `@image:` refs, the inlined file contents and runtime context.
 */
export function parseUserMessage(raw: string): { text: string; attachments: UserAttachment[] } {
  const attachments: UserAttachment[] = []
  const seen = new Set<string>()
  const add = (a: UserAttachment) => {
    const k = `${a.kind}:${a.path}`
    if (seen.has(k)) return
    seen.add(k)
    attachments.push(a)
  }

  const names = uploadNames()
  for (const m of raw.matchAll(IMAGE_ATTACHED)) {
    const path = m[1].trim()
    add({ kind: 'image', name: nameFor(path, names), path })
  }

  // Refs can sit in the prose or after the inlined context (`@image:` lines).
  for (const m of raw.replace(RUNTIME_CONTEXT, '').matchAll(REF)) {
    const path = unquote(m[2])
    const image = m[1] === 'image' || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(path)
    add({ kind: image ? 'image' : 'file', name: nameFor(path, names), path })
  }
  let text = raw
    .replace(CONTEXT_WARNINGS, '')
    .replace(ATTACHED_CONTEXT, '')
    .replace(IMAGE_ATTACHED_TAIL, '')
    .replace(RUNTIME_CONTEXT, '')
  text = text.replace(REF, '')
  if (attachments.some((a) => a.kind === 'image')) text = text.replace(SCREENSHOT_LINE, '')
  return { text: text.replace(/^\s*\n/, '').trim(), attachments }
}
