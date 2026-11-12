// Where an agent left its browser: the last picture of it from each reply that
// browsed. Hermes shows its screen only while it's there to see, so the app
// keeps the picture it was showing (just the page, as the chat's card shows
// it) and hands it to Murmur's server (server/browser-frames.ts), which is
// what a reload, or another device, shows afterwards. A reply nobody watched
// has none.

import { useEffect, useSyncExternalStore } from 'react'
import { firstHermes, homeOf } from '@/hermes/instance'
import { hermesHeaders } from '@/hermes/rest'
import { pageCut } from '@/features/screen/frame'
import { PAGE } from '@/state/screen'

type Size = { w: number; h: number }

/** Wide enough for the chat's card on a sharp screen (560px, twice over). */
const WIDTH = 1120
/** What Murmur's server takes for one picture. */
const MOST = 300 * 1024
/** How long a chat's list of pictures is good for: one a moment old may have missed a reply that's just ended. */
const FRESH = 5000

/** A kept picture, decoded and ready to show. */
export type Kept = { src: string; w: number; h: number }

// Each picture as the app has it, by chat and step: undefined until it's
// known, null when there's none.
const kept = new Map<string, Kept | null>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
const put = (key: string, picture: Kept | null) => {
  kept.set(key, picture)
  for (const listener of listeners) listener()
}

// Murmur's server keeps each Hermes's pictures apart, so every request names the chat's own.
const headersFor = (chat: string, headers?: Record<string, string>) => hermesHeaders(headers, homeOf(chat) ?? firstHermes())

const route = (chat: string, frame?: string) =>
  `/murmur/browser-frames/${encodeURIComponent(chat)}${frame ? `/${encodeURIComponent(frame)}` : ''}`

/** A still of the agent's screen as the picture to keep: just its page, a JPEG; null when it can't be made small enough. */
export async function pagePicture(still: string, size: Size): Promise<Blob | null> {
  const img = new Image()
  img.src = still
  await img.decode()
  const cut = pageCut({ w: img.naturalWidth, h: img.naturalHeight }, size, PAGE, WIDTH)
  const canvas = document.createElement('canvas')
  canvas.width = cut.w
  canvas.height = cut.h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, cut.top, img.naturalWidth, cut.height, 0, 0, cut.w, cut.h)
  for (const quality of [0.82, 0.6, 0.4]) {
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', quality))
    if (blob && blob.size <= MOST) return blob
  }
  return null
}

async function show(key: string, blob: Blob) {
  const src = URL.createObjectURL(blob)
  const img = new Image()
  img.src = src
  // Decoded before it's shown, so it never blinks in.
  await img.decode()
  const before = kept.get(key)
  put(key, { src, w: img.naturalWidth, h: img.naturalHeight })
  // The one before, once nothing's still fading out of it.
  if (before) setTimeout(() => URL.revokeObjectURL(before.src), 5000)
}

/**
 * Keeps a reply's picture: shown from here on, and handed to Murmur's server
 * for a reload or another device. Quiet when the server can't take it: the
 * picture still shows for as long as the app is open.
 */
export async function keepFrame(chat: string, frame: string, picture: Blob) {
  await show(`${chat}/${frame}`, picture).catch(() => {})
  await fetch(route(chat, frame), {
    method: 'PUT',
    headers: headersFor(chat, { 'content-type': 'image/jpeg' }),
    body: picture,
  }).catch(() => {})
}

// The pictures Murmur's server has for a chat, asked once for all its replies.
const lists = new Map<string, { at: number; frames: Promise<Set<string>> }>()

function listOf(chat: string) {
  const had = lists.get(chat)
  if (had && Date.now() - had.at < FRESH) return had.frames
  const frames = fetch(route(chat), { headers: headersFor(chat), cache: 'no-store' })
    .then((res): Promise<{ frames?: string[] }> | { frames?: string[] } => (res.ok ? res.json() : {}))
    .then(
      (body) => new Set<string>(body.frames ?? []),
      () => new Set<string>(),
    )
  lists.set(chat, { at: Date.now(), frames })
  return frames
}

const loading = new Set<string>()

async function load(chat: string, frame: string) {
  const key = `${chat}/${frame}`
  if (kept.has(key) || loading.has(key)) return
  loading.add(key)
  try {
    if (!(await listOf(chat)).has(frame)) return put(key, null)
    const res = await fetch(route(chat, frame), { headers: headersFor(chat), cache: 'no-store' })
    if (!res.ok) return put(key, null)
    await show(key, await res.blob())
  } catch {
    put(key, null)
  } finally {
    loading.delete(key)
  }
}

/**
 * The picture kept for a reply's browser: undefined while Murmur finds out
 * whether there is one, null when there's none.
 */
export function useKeptFrame(chat: string | undefined, frame: string | undefined): Kept | null | undefined {
  const key = chat && frame ? `${chat}/${frame}` : undefined
  useEffect(() => {
    if (chat && frame) void load(chat, frame)
  }, [chat, frame])
  return useSyncExternalStore(subscribe, () => (key ? kept.get(key) : null))
}

/** Forgets a chat's pictures, here and on Murmur's server: the chat was deleted. */
export async function forgetFrames(chat: string) {
  lists.delete(chat)
  for (const [key, picture] of kept) {
    if (!key.startsWith(`${chat}/`)) continue
    if (picture) URL.revokeObjectURL(picture.src)
    kept.delete(key)
  }
  await fetch(route(chat), { method: 'DELETE', headers: headersFor(chat) }).catch(() => {})
}
