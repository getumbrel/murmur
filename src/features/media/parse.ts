// What the person attached, as stored in history. (What agents deliver inside
// their replies is read by shared/message.ts, which the server uses too.)

import type { UserAttachment } from '@/features/chat/types'
import { scoped } from '@/hermes/instance'
import { unquote } from '@shared/message.ts'
import { ALONG } from '@shared/routines.ts'
export type { UserAttachment }

const ATTACHED_CONTEXT = /(?:^|\n)--- Attached Context ---\s*\n[\s\S]*$/
const CONTEXT_WARNINGS = /(?:^|\n)--- Context Warnings ---[\s\S]*$/
const RUNTIME_CONTEXT = /\n*Umbrel Runtime Context:[\s\S]*$/
// A picture's file on the Hermes host ("at: <path>"), or its address on the web.
const IMAGE_ATTACHED = /\[Image attached(?: at: ([^\]\n]+)|: (https?:\/\/[^\]\s]+))\]/g
const IMAGE_ATTACHED_TAIL = /\n*\[Image attached(?: at: [^\]]+|: https?:\/\/[^\]\s]+)\][\s\S]*$/
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

/** A file's `@file:` ref, quoted the way Hermes quotes one so a path with spaces reads back whole. */
export function fileRef(path: string) {
  if (!/[\s()[\]{}<>"'`]/.test(path)) return `@file:${path}`
  const quote = ['`', '"', "'"].find((q) => !path.includes(q))
  return `@file:${quote ? `${quote}${path}${quote}` : path}`
}

/** What the person called a file: an upload's own name never shows. */
const nameFor = (path: string, names: Record<string, string>) =>
  names[path] ?? nameOf(path).replace(UPLOAD, 'image$1')

/**
 * The pictures in a message Hermes saved in parts (text beside pictures):
 * each one's address, which is usually the picture itself (a `data:` URL, and
 * a long one: it's passed along as it is, never copied or rebuilt).
 */
export function picturesIn(content: unknown): string[] {
  const parts = Array.isArray(content) ? content : content && typeof content === 'object' ? [content] : []
  return parts.flatMap((part) => {
    const at = part?.image_url
    const url = typeof at === 'string' ? at : at?.url
    return typeof url === 'string' && PICTURE.test(url) ? [url] : []
  })
}

const PICTURE = /^(?:data:image\/|https?:\/\/)/i

/** What to call a picture known only by its address. */
function pictureName(url: string) {
  const kind = /^data:image\/([a-z0-9]+)/i.exec(url)?.[1].toLowerCase()
  if (kind) return `image.${kind === 'jpeg' ? 'jpg' : kind}`
  try {
    return nameOf(decodeURIComponent(new URL(url).pathname)) || 'image'
  } catch {
    return 'image'
  }
}

/**
 * Split a stored user message into the words the person typed and the files
 * they attached. Hermes stores the expanded prompt: image markers, `@file:` /
 * `@image:` refs, the inlined file contents and runtime context, and what
 * Murmur sent along with it. `pictures` are the ones saved in the message
 * itself (picturesIn), in the order its words name them: shown from there,
 * they outlast their files, which Hermes clears away after a while.
 */
export function parseUserMessage(
  stored: string,
  pictures: string[] = [],
): { text: string; attachments: UserAttachment[] } {
  const attachments: UserAttachment[] = []
  const seen = new Map<string, UserAttachment>()
  // Every picture the words name, in order (one named twice is here twice).
  const named: Extract<UserAttachment, { kind: 'image' }>[] = []
  const add = (a: UserAttachment) => {
    const k = `${a.kind}:${a.path ?? (a.kind === 'image' ? a.url : '')}`
    const known = seen.get(k) ?? a
    if (known.kind === 'image') named.push(known)
    if (seen.has(k)) return
    seen.set(k, a)
    attachments.push(a)
  }

  const names = uploadNames()
  // What Murmur sent along (what routines reported, say) isn't what the person wrote.
  const raw = stored.replace(ALONG, '')
  for (const m of raw.matchAll(IMAGE_ATTACHED)) {
    const path = m[1]?.trim()
    if (path) add({ kind: 'image', name: nameFor(path, names), path })
    else add({ kind: 'image', name: pictureName(m[2]), url: m[2] })
  }

  // Refs can sit in the prose or after the inlined context (`@image:` lines).
  for (const m of raw.replace(RUNTIME_CONTEXT, '').matchAll(REF)) {
    const path = unquote(m[2])
    const image = m[1] === 'image' || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(path)
    add({ kind: image ? 'image' : 'file', name: nameFor(path, names), path })
  }
  // Each picture saved in the message is one its words name, in the same order; any more stand on their own.
  for (const [n, url] of pictures.entries()) {
    if (named[n]) named[n].url ??= url
    else attachments.push({ kind: 'image', name: pictureName(url), url })
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

// ── Replying to a part of what the agent said ───────────────────────────────
// A passage goes to Hermes as plain Markdown, a blockquote above your words,
// so the agent (and any other app reading the chat) sees which part you mean.
// Several go one under another, each a blockquote of its own. Read back, the
// blockquotes that open your message are those passages again.

/** A passage as it's quoted: no trailing spaces, no more than one blank line in a row, none at either end. */
export function tidyQuote(passage: string) {
  return passage
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A passage as it's sent: "> " on each of its lines. */
const quoted = (passage: string) =>
  passage
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')

/**
 * Your words under the passages they answer, as they're sent: each passage a
 * blockquote of its own, in the order they were picked, a blank line between
 * them, then a blank line and the words.
 */
export function withQuotes(quotes: readonly string[], text: string) {
  const blocks = quotes.map(tidyQuote).filter(Boolean).map(quoted)
  if (!blocks.length) return text
  return [...blocks, ...(text ? [text] : [])].join('\n\n')
}

const QUOTED = /^>(?: |$)/

/**
 * The passages a message opens with, and the words under them. Only
 * blockquotes at the very top count, each ended by a blank line (or the end
 * of the message): a ">" line with more typed straight under it is just what
 * someone wrote, and so is everything after it.
 */
export function splitQuotes(message: string): { quotes: string[]; text: string } {
  const lines = message.split('\n')
  const quotes: string[] = []
  // Where the words begin: after the last passage read, and the blank lines under it.
  let rest = 0
  for (let at = 0; at < lines.length; ) {
    let end = at
    while (end < lines.length && QUOTED.test(lines[end])) end++
    if (end === at || (end < lines.length && lines[end].trim())) break
    const quote = tidyQuote(
      lines
        .slice(at, end)
        .map((line) => line.replace(/^> ?/, ''))
        .join('\n'),
    )
    if (!quote) break
    quotes.push(quote)
    while (end < lines.length && !lines[end].trim()) end++
    at = rest = end
  }
  if (!quotes.length) return { quotes, text: message }
  return { quotes, text: lines.slice(rest).join('\n').trimEnd() }
}
