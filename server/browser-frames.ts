// Where an agent left its browser: the last picture of it from each reply that
// browsed, so the chat still shows the page after the reply ends, after a
// reload, and on another device. Hermes shows its screen only while it's
// there to see, so the app keeps the picture it was showing (src/state/browser-frames.ts)
// and hands it to Murmur's server, which keeps it here.
//
//   GET    /murmur/browser-frames/<chat>         → {frames: [<step>, …]}, the pictures kept for a chat
//   GET    /murmur/browser-frames/<chat>/<step>  → the picture (JPEG); 404 when there's none
//   PUT    /murmur/browser-frames/<chat>/<step>  → keeps it, in place of the one before
//   DELETE /murmur/browser-frames/<chat>         → forgets a chat's pictures, with the chat
//
// <chat> is the chat's id on its Hermes, and <step> the id of the reply's
// first step in the browser, which is the same while the reply streams and
// when it's read back later. Each Hermes has its own, in
// DATA_DIR/browser-frames/<hermes>/<chat>/<step>.jpg, so two Hermes never see
// each other's.
//
// A picture is what was on the page, which can be private, so it's kept the
// way murmur.json is: readable by Murmur alone, behind Murmur's sign-in, gone
// with its chat or its Hermes. Only a JPEG is taken, checked by its bytes and
// never larger than a page's worth, and it's only ever served back as one.
// When they'd take more room than KEEP_BYTES, the oldest go first.

import type http from 'node:http'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './config.ts'
import { sendJson } from './http.ts'

const ROUTE = '/murmur/browser-frames'
/** One picture: a page 1120px wide comes to 60–150 KB. */
export const FRAME_BYTES = 300 * 1024
/** All of them together: about a thousand replies' worth. */
export const KEEP_BYTES = 100 * 1024 * 1024
/** Brought down to this much of the limit when it's passed, so making room isn't every picture's job. */
const ROOM = 0.9

/** An id that's safe as a folder or a file: no dots, no slashes, nothing to climb out with. */
const ID = /^[A-Za-z0-9_-]{1,96}$/
export const safeId = (raw: unknown): string | null => (typeof raw === 'string' && ID.test(raw) ? raw : null)

/** A whole JPEG, by its first and last bytes: nothing else is kept, whatever it's called. */
export function isJpeg(body: Buffer) {
  const n = body.length
  return n > 4 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff && body[n - 2] === 0xff && body[n - 1] === 0xd9
}

const root = () => join(dataDir(), 'browser-frames')
const chatDir = (hermes: string, chat: string) => join(root(), hermes, chat)
const frameFile = (hermes: string, chat: string, step: string) => join(chatDir(hermes, chat), `${step}.jpg`)

const list = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

const sizeOf = (file: string) => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

type Kept = { file: string; size: number; at: number }

/** Every picture kept, for every Hermes. */
function everything(): Kept[] {
  const kept: Kept[] = []
  for (const hermes of list(root())) {
    if (!hermes.isDirectory()) continue
    for (const chat of list(join(root(), hermes.name))) {
      if (!chat.isDirectory()) continue
      const dir = join(root(), hermes.name, chat.name)
      for (const frame of list(dir)) {
        if (!frame.isFile() || !frame.name.endsWith('.jpg')) continue
        try {
          const file = join(dir, frame.name)
          const stat = statSync(file)
          kept.push({ file, size: stat.size, at: stat.mtimeMs })
        } catch {
          // Gone since it was listed.
        }
      }
    }
  }
  return kept
}

// How much is kept, counted once and then kept up with each picture, per data folder.
let tally: { root: string; bytes: number } | undefined

const held = () => {
  if (tally?.root !== root()) tally = { root: root(), bytes: everything().reduce((sum, k) => sum + k.size, 0) }
  return tally
}

/** A folder that's been emptied goes too. */
const tidy = (dir: string) => {
  try {
    rmdirSync(dir)
  } catch {
    // Still has something in it.
  }
}

/**
 * Makes room once the pictures pass `limit`: the oldest go first, until
 * what's left fits with a little to spare. Returns how many went.
 */
export function makeRoom(limit = KEEP_BYTES) {
  if (held().bytes <= limit) return 0
  const kept = everything().sort((a, b) => a.at - b.at)
  let bytes = kept.reduce((sum, k) => sum + k.size, 0)
  let gone = 0
  for (const { file, size } of kept) {
    if (bytes <= limit * ROOM) break
    rmSync(file, { force: true })
    tidy(join(file, '..'))
    bytes -= size
    gone++
  }
  tally = { root: root(), bytes }
  return gone
}

/** Keeps a reply's picture, in place of the one it had. */
export function keepFrame(hermes: string, chat: string, step: string, picture: Buffer, limit = KEEP_BYTES) {
  const file = frameFile(hermes, chat, step)
  const count = held()
  const had = sizeOf(file)
  mkdirSync(root(), { recursive: true, mode: 0o700 })
  mkdirSync(chatDir(hermes, chat), { recursive: true, mode: 0o700 })
  writeFileSync(`${file}.tmp`, picture, { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
  count.bytes += picture.length - had
  makeRoom(limit)
}

export function readFrame(hermes: string, chat: string, step: string) {
  try {
    return readFileSync(frameFile(hermes, chat, step))
  } catch {
    return null
  }
}

/** The steps a chat has a picture for. */
export const framesOf = (hermes: string, chat: string) =>
  list(chatDir(hermes, chat)).flatMap((f) => (f.isFile() && f.name.endsWith('.jpg') ? [f.name.slice(0, -4)] : []))

/** Forgets a chat's pictures: the chat was deleted. */
export function forgetChat(hermes: string, chat: string) {
  rmSync(chatDir(hermes, chat), { recursive: true, force: true })
  tidy(join(root(), hermes))
  tally = undefined
}

/** Forgets everything kept for a Hermes that's been removed from this Murmur. */
export function forgetHermes(hermes: string) {
  if (!safeId(hermes)) return
  rmSync(join(root(), hermes), { recursive: true, force: true })
  tally = undefined
}

/** The request's body, or null once it's longer than `limit`. */
async function readBody(req: http.IncomingMessage, limit: number) {
  if (Number(req.headers['content-length'] ?? 0) > limit) return null
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) return null
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

const reply = (res: http.ServerResponse, status: number, body: unknown) => (sendJson(res, status, body), true)

/** `hermes`: the Hermes the request is for (connection.ts), or null when it named one that's gone. */
export async function handleBrowserFrames(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  hermes: string | null,
) {
  if (url.pathname !== ROUTE && !url.pathname.startsWith(`${ROUTE}/`)) return false
  if (!hermes) return reply(res, 409, { error: 'hermes_gone' })
  const parts = url.pathname.slice(ROUTE.length + 1).split('/')
  const [chat, step] = parts.map((part) => safeId(decodeURIComponent(part)))
  if (parts.length > 2 || !safeId(hermes) || !chat || (parts.length === 2 && !step)) return reply(res, 400, { error: 'bad_request' })

  if (!step) {
    if (req.method === 'GET') return reply(res, 200, { frames: framesOf(hermes, chat) })
    if (req.method !== 'DELETE') return reply(res, 405, { error: 'method_not_allowed' })
    forgetChat(hermes, chat)
    return reply(res, 200, { ok: true })
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const picture = readFrame(hermes, chat, step)
    if (!picture || !isJpeg(picture)) return reply(res, 404, { error: 'not_found' })
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': picture.length,
      // The one picture a reply has changes while it browses: always asked for afresh.
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    })
    res.end(req.method === 'HEAD' ? undefined : picture)
    return true
  }

  if (req.method !== 'PUT') return reply(res, 405, { error: 'method_not_allowed' })
  if (req.headers['content-type'] !== 'image/jpeg') return reply(res, 415, { error: 'not_a_jpeg' })
  const picture = await readBody(req, FRAME_BYTES)
  if (!picture) {
    // Whatever's left of it isn't read.
    res.once('finish', () => req.destroy())
    return reply(res, 413, { error: 'too_large' })
  }
  if (!isJpeg(picture)) return reply(res, 415, { error: 'not_a_jpeg' })
  keepFrame(hermes, chat, step, picture)
  return reply(res, 200, { ok: true })
}
