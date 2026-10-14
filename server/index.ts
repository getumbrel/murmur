// Murmur server: serves the web app and gives it a same-origin path to Hermes.
//
//   /hermes/api/*        → Hermes dashboard API (REST + the /api/ws JSON-RPC
//                          socket), signed in server-side (proxy.ts, hermes.ts).
//                          Nothing else of Hermes: its pages carry its token.
//   /murmur/connections  → the Hermes this Murmur knows, and which one this
//                          browser uses (connection.ts). /murmur/connection
//                          is the older single-Hermes API, still answered.
//   /murmur/login …      → Murmur's own optional password (access.ts).
//   /murmur/local        → finds OpenAI-compatible model servers on this Umbrel
//                          (the browser can't reach other containers directly).
//   everything else      → the built web app, with SPA fallback.
//
// No dependencies: node:http for serving, raw sockets for WebSocket upgrades.

import http from 'node:http'
import type net from 'node:net'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { accessRequired, cookieValue, handleAccess, isSignedIn, onSignOut } from './access.ts'
import { DATA_DIR } from './config.ts'
import { firstTarget, handleConnection, hermesFor, onDrop, syncHermesCookie } from './connection.ts'
import { hostAllowed, originAllowed, requestUrl, sendJson } from './http.ts'
import { createProxy, refuse } from './proxy.ts'

const PORT = Number(process.env.PORT ?? 3000)
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? 'dist')

// Model servers commonly installed alongside Hermes on umbrelOS.
const LOCAL_CANDIDATES = (
  process.env.MURMUR_LOCAL_MODEL_URLS ??
  'Ollama=http://ollama_ollama_1:11434,LocalAI=http://localai_api_1:8080'
)
  .split(',')
  .map((entry) => {
    const [name, url] = entry.split('=')
    return { name: name.trim(), url: url.trim().replace(/\/$/, '') }
  })

// ── Local model discovery ───────────────────────────────────────────────────

async function probe(url: string, path: string) {
  const res = await fetch(url + path, { signal: AbortSignal.timeout(1500) })
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<Record<string, unknown>>
}

async function discoverLocal() {
  const found = await Promise.all(
    LOCAL_CANDIDATES.map(async ({ name, url }) => {
      try {
        // Ollama's native listing carries sizes; fall back to the OpenAI shape.
        const tags = await probe(url, '/api/tags').catch(() => null)
        if (tags && Array.isArray(tags.models)) {
          const models = (tags.models as { name: string; size?: number; details?: { parameter_size?: string } }[]).map(
            (m) => ({ id: m.name, size: m.size ?? null, parameters: m.details?.parameter_size ?? null }),
          )
          return { name, baseUrl: `${url}/v1`, models }
        }
        const list = await probe(url, '/v1/models')
        const models = ((list.data as { id: string }[]) ?? []).map((m) => ({ id: m.id, size: null, parameters: null }))
        return { name, baseUrl: `${url}/v1`, models }
      } catch {
        return null
      }
    }),
  )
  return found.filter(Boolean)
}

// ── Static files ────────────────────────────────────────────────────────────

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

// The app is never framed (an approval card must not be clickjacked) or sniffed.
const STATIC_HEADERS = {
  'content-security-policy': "frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
}

// Text assets are compressed once at build time (vite.config.ts writes .br and
// .gz beside them); each request gets the best one the browser takes: br,
// then gzip, else the file as it is.
// Images and fonts are already compressed and always go as they are.
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest', '.txt', '.xml', '.wasm'])
const ENCODINGS = [
  ['br', '.br'],
  ['gzip', '.gz'],
] as const

/** The encodings an Accept-Encoding header allows (a q of 0 refuses one; `*` allows any not named). */
function accepted(header: string | string[] | undefined) {
  const allowed = new Set<string>()
  const refused = new Set<string>()
  for (const part of String(header ?? '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';')
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    if (q && Number(q.slice(2)) === 0) refused.add(name.trim())
    else allowed.add(name.trim())
  }
  return (encoding: string) => !refused.has(encoding) && (allowed.has(encoding) || allowed.has('*'))
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const pathname = decodeURIComponent(url.pathname) // checked by requestUrl
  let file = normalize(join(STATIC_DIR, pathname))
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + sep)) {
    res.writeHead(403).end()
    return
  }
  let stat = statSafe(file)
  if (stat?.isDirectory()) stat = statSafe((file = join(file, 'index.html')))
  if (!stat) {
    // Unknown asset paths 404; everything else is an app route.
    if (pathname.startsWith('/assets/')) return void res.writeHead(404, STATIC_HEADERS).end()
    stat = statSafe((file = join(STATIC_DIR, 'index.html')))
    if (!stat) return void res.writeHead(404).end('Murmur has not been built yet.')
  }
  const immutable = file.includes(`${STATIC_DIR}/assets/`)
  const compressible = COMPRESSIBLE.has(extname(file))
  let body = { path: file, size: stat.size, encoding: '' }
  if (compressible) {
    const takes = accepted(req.headers['accept-encoding'])
    for (const [encoding, suffix] of ENCODINGS) {
      const sibling = takes(encoding) ? statSafe(file + suffix) : null
      if (sibling?.isFile()) {
        body = { path: file + suffix, size: sibling.size, encoding }
        break
      }
    }
  }
  res.writeHead(200, {
    ...STATIC_HEADERS,
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': body.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(body.encoding && { 'content-encoding': body.encoding }),
    // Caches keep one copy per encoding, even of a file that went uncompressed.
    ...(compressible && { vary: 'Accept-Encoding' }),
  })
  if (req.method === 'HEAD') return void res.end()
  createReadStream(body.path)
    .on('error', () => res.destroy())
    .pipe(res)
}

function statSafe(path: string) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

// ── Server ──────────────────────────────────────────────────────────────────

const proxy = createProxy(hermesFor)
onDrop((hermes) => proxy.closeWhere((owner) => owner.hermes === hermes))
onSignOut((session) => proxy.closeWhere((owner) => owner.session === session))

const isHermes = (path: string) => path === '/hermes' || path.startsWith('/hermes/')
const isHermesApi = (path: string) => path.startsWith('/hermes/api/')

const blockedHost = (res: http.ServerResponse, host = '') => {
  res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' })
  res.end(
    `Murmur doesn’t know the address “${host}”, so it isn’t answering there.\n` +
      'If it’s yours, add it to MURMUR_ALLOWED_HOSTS (comma-separated) and restart Murmur.\n' +
      'Murmur refuses unknown names so other websites can’t reach it through a name they control.\n',
  )
}

const server = http.createServer(async (req, res) => {
  const url = requestUrl(req)
  if (!url) return void res.writeHead(400).end()
  const path = url.pathname
  if (path === '/healthz') return void res.writeHead(200).end('ok')
  if (!hostAllowed(req)) return blockedHost(res, req.headers.host)
  syncHermesCookie(req, res)

  try {
    if (!isHermes(path) && !path.startsWith('/murmur/')) return serveStatic(req, res, url)
    const mutating = req.method !== 'GET' && req.method !== 'HEAD'
    if ((isHermes(path) || mutating) && !originAllowed(req)) return sendJson(res, 403, { error: 'cross_origin' })
    if (isHermes(path) && !isHermesApi(path)) return sendJson(res, 404, { error: 'not_found' })
    if (await handleAccess(req, res, path)) return
    if (!isSignedIn(req)) return sendJson(res, 401, { error: 'signed_out' })
    if (isHermes(path)) return await proxy.proxyHttp(req, res, url)
    if (await handleConnection(req, res, path)) return
    if (path === '/murmur/local') return sendJson(res, 200, { servers: await discoverLocal() })
    sendJson(res, 404, { error: 'not_found' })
  } catch (error) {
    console.error(error)
    if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
    else res.destroy()
  }
})

server.on('upgrade', (req, socket: net.Socket, head) => {
  // Node leaves an upgraded socket's errors to us; unhandled, one would crash the server.
  socket.on('error', () => socket.destroy())
  const url = requestUrl(req)
  if (!url) return refuse(socket, 400, 'Bad Request')
  if (!isHermesApi(url.pathname)) return refuse(socket, 404, 'Not Found')
  if (!hostAllowed(req) || !originAllowed(req)) return refuse(socket, 403, 'Forbidden')
  if (!isSignedIn(req)) return refuse(socket, 401, 'Unauthorized')
  proxy.proxyUpgrade(req, socket, head, url, cookieValue(req)).catch((error) => {
    console.error(error)
    socket.destroy()
  })
})

// Long-lived streams must never time out at this hop.
server.requestTimeout = 0
server.headersTimeout = 60_000
server.keepAliveTimeout = 65_000

server.listen(PORT, () => {
  const target = firstTarget()
  console.log(`Murmur listening on :${PORT} → Hermes at ${target.url} (${target.source})`)
  console.log(`Data in ${DATA_DIR}${accessRequired ? '; sign-in required' : ''}`)
})
