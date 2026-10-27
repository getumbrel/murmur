// What the person attached, as stored in history. (What agents deliver inside
// their replies is read by shared/message.ts, which the server uses too.)

import type { UserAttachment } from '@/features/chat/types'
import { scoped } from '@/hermes/instance'
import { unquote } from '@shared/message.ts'
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
