// Where this Murmur's agents live: asked once, on first run.
//
//   GET  /murmur/setup   → {decided, umbrel, builtin, found}; ?again=1 looks
//                          afresh rather than reusing what it found seconds ago
//   POST /murmur/setup   {use: 'builtin'} | {use: 'found', id, username?, password?}
//                        → {connection, active, connections, builtin?}, and this
//                          browser uses it; 422 {…connection} when it couldn't be
//                          used; 404 when that id is unknown; 409 {error:
//                          'decided', active, connections} once a choice exists.
//
// `decided`: a Hermes is pinned (HERMES_URL) or one was chosen or added, so
// the app never asks. It keeps answering after that, for Settings → Server's
// suggestions: `found` then leaves out every Hermes Murmur already has, and
// `builtin.added` says whether the built-in is one of them.
//
// An update from before the choice existed (Murmur's data was there, with no
// Hermes saved, because umbrelOS pinned the Hermes Agent app) is decided on the
// first start: the Hermes Agent app is saved as the chosen Hermes when it
// answers, so nobody who used it is asked again. Requests wait for that.
//
// The shapes the app reads are in src/state/setup.ts.

import type http from 'node:http'
import {
  addTarget,
  BUILTIN_ID,
  builtinConfig,
  builtinTarget,
  decided,
  listTargets,
  managedName,
  noteSetupSeen,
} from './config.ts'
import { addNamed, cookieFor, describe, instance, knownTargets, reload, state, type Body } from './connection.ts'
import {
  builtinInstallId,
  builtinReport,
  candidates,
  forApp,
  lookAgain,
  lookAround,
  offer,
  onUmbrel,
  publicStatus,
  type BuiltinReport,
} from './discovery.ts'
import { createHermes } from './hermes.ts'
import { appendCookie, readJson, sendJson } from './http.ts'

let settled: Promise<void> = Promise.resolve()

/** Requests that depend on which Hermes is chosen wait for an update's first start to settle it. */
export const setupSettled = () => settled

/** Called once the server's settings are known. */
export function startSetup() {
  const updated = noteSetupSeen()
  if (updated && !decided())
    settled = adoptUmbrelApp().catch((error) => console.warn(`Murmur: ${(error as Error).message}`))
}

/** An update on umbrelOS: keep using the Hermes Agent app it used before, when it answers. */
async function adoptUmbrelApp() {
  const app = candidates().find((c) => c.where === 'umbrel')
  if (!app) return
  const status = await publicStatus(app.url, 3000)
  if (!status || status.authRequired) return
  const hermes = createHermes({ id: 'adopt', name: '', url: app.url, source: 'saved' })
  const info = await hermes.check()
  if (info.status !== 'connected' || info.outdated || decided()) return
  // Under the name the person gave it, if they renamed it while it was pinned.
  addTarget({ name: managedName() ?? app.label, url: app.url })
  reload()
  console.log(`Murmur: carrying on with ${app.name} at ${app.url}, as before this update.`)
}

// ── Answering ───────────────────────────────────────────────────────────────

type BuiltinAnswer = (BuiltinReport & { added: boolean }) | null

async function builtinAnswer(): Promise<BuiltinAnswer> {
  const target = listTargets().find((t) => t.id === BUILTIN_ID) ?? builtinTarget()
  if (!target) return null
  return { ...(await builtinReport(instance(target))), added: knownTargets().some((t) => t.id === BUILTIN_ID) }
}

// A Hermes keeps its install id for life (it's in its data folder), so each address is asked once.
const installs = new Map<string, string>()

async function installAt(url: string) {
  if (!installs.has(url)) {
    const id = (await publicStatus(url))?.installId
    if (id) installs.set(url, id)
  }
  return installs.get(url)
}

/** The installs Murmur already has, asked publicly (cheap, and nothing is sent). */
async function knownInstalls() {
  const ids = await Promise.all(
    knownTargets()
      .filter((t) => t.id !== BUILTIN_ID)
      .map((t) => installAt(t.url)),
  )
  return new Set(ids.filter((id): id is string => Boolean(id)))
}

async function answer() {
  const builtinUrl = builtinConfig()?.url
  const [builtin, looked, installIds] = await Promise.all([builtinAnswer(), lookAround(), knownInstalls()])
  const urls = new Set([...knownTargets().map((t) => t.url), ...(builtinUrl ? [builtinUrl] : [])])
  // The built-in, never offered as found: its report learns its install the first time it answers.
  const builtinId = builtinInstallId()
  if (builtinId) installIds.add(builtinId)
  return {
    decided: decided(),
    umbrel: onUmbrel(),
    builtin,
    found: offer(looked, { urls, installIds }).map(forApp),
  }
}

export async function handleSetup(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
  if (path !== '/murmur/setup') return false
  if (req.method === 'GET') {
    // "Check again" after an update, or "Try again".
    if (new URL(req.url ?? '', 'http://murmur').searchParams.has('again')) lookAgain()
    sendJson(res, 200, await answer())
    return true
  }
  if (req.method !== 'POST') return false

  const body = (await readJson(req).catch(() => ({}))) as Body & { use?: unknown; id?: unknown }
  if (decided()) {
    sendJson(res, 409, { error: 'decided', ...(await state(req)) })
    return true
  }
  let target
  if (body.use === 'builtin') target = await addNamed(res, { builtin: true })
  else if (body.use === 'found')
    target = await addNamed(res, { found: body.id ?? '', username: body.username, password: body.password })
  else {
    sendJson(res, 422, { error: 'Choose the built-in Hermes or one Murmur found.' })
    return true
  }
  if (!target) return true
  appendCookie(res, cookieFor(req, target.id))
  const connection = await describe(target, true)
  const builtin = target.id === BUILTIN_ID ? await builtinAnswer() : undefined
  sendJson(res, 200, { connection, ...(await state(req, target.id)), ...(builtin !== undefined && { builtin }) })
  return true
}
