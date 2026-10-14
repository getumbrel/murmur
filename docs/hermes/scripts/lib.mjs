// Minimal Hermes /api/ws JSON-RPC client for probing (Node 22+, global WebSocket).
// Env: HERMES_URL (default http://localhost:18789), HERMES_TOKEN (auto-scraped from the SPA if unset),
//      QUIET=1 to suppress frame logging, LOG_DELTAS=1 to log every *.delta frame (default: collapsed).
export const BASE = process.env.HERMES_URL || 'http://localhost:18789'

export async function getToken() {
  if (process.env.HERMES_TOKEN) return process.env.HERMES_TOKEN
  const html = await (await fetch(BASE + '/')).text()
  const m = html.match(/__HERMES_SESSION_TOKEN__="([^"]+)"/)
  if (!m) throw new Error('session token not found in SPA html')
  return m[1]
}

export async function rest(path, { method = 'GET', body } = {}) {
  const token = await getToken()
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-Hermes-Session-Token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  try { return { status: res.status, json: JSON.parse(text) } } catch { return { status: res.status, text } }
}

const t0 = Date.now()
export const ts = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(7)
const short = (o, n = 600) => { const s = JSON.stringify(o); return s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s }

export async function connect({ label = 'ws', onRequest, log = !process.env.QUIET, maxLog = 900 } = {}) {
  const token = await getToken()
  const url = BASE.replace(/^http/, 'ws') + '/api/ws?token=' + encodeURIComponent(token)
  const ws = new WebSocket(url)
  const pending = new Map()
  const listeners = new Set()
  const frames = []
  let nextId = 1
  let deltaRun = null
  const flushDeltas = () => {
    if (deltaRun && log) console.log(`${ts()} [${label}] <- …${deltaRun.n}× ${deltaRun.type} sid=${deltaRun.sid} text=${JSON.stringify(deltaRun.text.slice(0, 200))}`)
    deltaRun = null
  }
  const client = {
    ws, frames,
    rpc(method, params = {}, timeoutMs = 120000) {
      const id = `${label}-${nextId++}`
      const frame = { jsonrpc: '2.0', id, method, params }
      if (log) { flushDeltas(); console.log(`${ts()} [${label}] -> ${short(frame, maxLog)}`) }
      ws.send(JSON.stringify(frame))
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)) }, timeoutMs)
        pending.set(id, { resolve, reject, timer, method })
      })
    },
    respond(id, result) {
      const f = { jsonrpc: '2.0', id, result }
      if (log) console.log(`${ts()} [${label}] -> ${short(f)}`)
      ws.send(JSON.stringify(f))
    },
    fail(id, code, message) { ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })) },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    waitEvent(pred, timeoutMs = 60000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { off(); reject(new Error('waitEvent timeout')) }, timeoutMs)
        const off = client.on(ev => { if (pred(ev)) { clearTimeout(timer); off(); resolve(ev) } })
      })
    },
    close() { flushDeltas(); ws.close() },
  }
  ws.addEventListener('message', m => {
    const f = JSON.parse(m.data)
    frames.push({ t: Date.now() - t0, f })
    if (f.method === 'event') {
      const p = f.params
      if (!process.env.LOG_DELTAS && /\.delta$/.test(p.type)) {
        const text = p.payload?.text ?? ''
        if (deltaRun && deltaRun.type === p.type && deltaRun.sid === p.session_id) { deltaRun.n++; deltaRun.text += text }
        else { flushDeltas(); deltaRun = { type: p.type, sid: p.session_id, n: 1, text }; if (log) console.log(`${ts()} [${label}] <- ${short(f, maxLog)}`) }
      } else if (log) { flushDeltas(); console.log(`${ts()} [${label}] <- ${short(f, maxLog)}`) }
      for (const fn of listeners) fn(p)
    } else if (f.method && f.id !== undefined) {
      if (log) { flushDeltas(); console.log(`${ts()} [${label}] <- SERVER REQUEST ${short(f, maxLog)}`) }
      if (onRequest) onRequest(f, client)
      else client.fail(f.id, -32601, 'no handler')
    } else if (f.id !== undefined) {
      if (log) { flushDeltas(); console.log(`${ts()} [${label}] <- ${short(f, maxLog)}`) }
      const p = pending.get(f.id)
      if (p) { clearTimeout(p.timer); pending.delete(f.id); f.error ? p.reject(Object.assign(new Error(f.error.message), { rpc: f.error })) : p.resolve(f.result) }
    }
  })
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', e => reject(new Error('ws error ' + (e.message || ''))), { once: true })
    ws.addEventListener('close', e => reject(new Error(`closed during handshake ${e.code} ${e.reason}`)), { once: true })
  })
  ws.addEventListener('close', e => { if (log) console.log(`${ts()} [${label}] closed code=${e.code} reason=${e.reason}`) })
  client.ready = await client.waitEvent(e => e.type === 'gateway.ready', 10000)
  return client
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))
