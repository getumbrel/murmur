// /hermes/api/* → the Hermes the request is for, credentials attached server-side.
// REST is streamed through node:http(s); WebSocket upgrades are spliced as raw
// sockets once Hermes has accepted the handshake.

import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import type { Hermes } from './hermes.ts'
import { HERMES_PARAM } from './connection.ts'

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'])
// Browser-side identity never reaches Hermes; Murmur speaks for the browser.
// Forwarding headers go too: Hermes trusts them from loopback, and they would
// let the browser pick the client address Hermes sees.
const STRIP = new Set(['host', 'cookie', 'origin', 'referer', 'authorization', 'x-hermes-session-token', 'forwarded', 'x-real-ip'])
const stripped = (key: string) => HOP_BY_HOP.has(key) || STRIP.has(key) || key.startsWith('x-forwarded-')

// Hermes pages carry its session token; only files the person asked for may be markup.
const MARKUP = /^\s*(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml)/i
const DOWNLOAD = '/hermes/api/fs/download'

/** Hermes's path for a request. Murmur's own `?hermes=` (which Hermes) stays here. */
function upstreamPath(hermes: Hermes, url: URL) {
  const params = new URLSearchParams(url.search)
  params.delete(HERMES_PARAM)
  const search = params.size ? `?${params}` : ''
  return hermes.prefix + url.pathname.replace(/^\/hermes/, '') + search
}
const defaultPort = (url: URL) => Number(url.port || (url.protocol === 'https:' ? 443 : 80))

function forwardHeaders(req: http.IncomingMessage, hermes: Hermes, auth: Record<string, string>) {
  const headers: http.OutgoingHttpHeaders = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (!stripped(key)) headers[key] = value
  }
  return { ...headers, ...auth, host: hermes.url.host }
}

type Pick = (req: http.IncomingMessage, url: URL) => Hermes | null

export function createProxy(pick: Pick) {
  // Live sockets, with the Murmur sign-in that opened each and the Hermes they reach.
  const sockets = new Map<net.Socket, { session: string | null; hermes: Hermes }>()

  async function proxyHttp(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const hermes = pick(req, url)
    if (!hermes) return gone(res)
    // Buffer the body so a request with a stale credential can be replayed once.
    let body: Buffer | undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      body = Buffer.concat(chunks)
    }
    const send = async (retried: boolean) => {
      let auth: Awaited<ReturnType<Hermes['restAuth']>>
      try {
        auth = await hermes.restAuth()
      } catch (error) {
        return unavailable(res, (error as Error).message)
      }
      if (res.destroyed) return
      const client = hermes.url.protocol === 'https:' ? https : http
      const upstream = client.request(
        {
          host: hermes.url.hostname,
          port: defaultPort(hermes.url),
          method: req.method,
          path: upstreamPath(hermes, url),
          headers: forwardHeaders(req, hermes, auth.headers),
        },
        (up) => {
          if ((up.statusCode === 401 || up.statusCode === 403) && !retried) {
            up.resume()
            hermes.reject(auth.credential)
            return void send(true)
          }
          const type = String(up.headers['content-type'] ?? '')
          if (MARKUP.test(type) && url.pathname !== DOWNLOAD) {
            up.destroy()
            return unavailable(res, 'Hermes sent a page where Murmur expected data.')
          }
          const headers: http.OutgoingHttpHeaders = {}
          for (const [key, value] of Object.entries(up.headers)) {
            if (!HOP_BY_HOP.has(key) && key !== 'set-cookie') headers[key] = value
          }
          // Never let intermediaries buffer streamed responses.
          headers['x-accel-buffering'] = 'no'
          headers['cache-control'] ??= 'no-store'
          headers['x-content-type-options'] = 'nosniff'
          // A downloaded page or SVG opened in a tab runs in an opaque origin, away from Murmur.
          if (MARKUP.test(type)) headers['content-security-policy'] = 'sandbox'
          res.writeHead(up.statusCode ?? 502, headers)
          up.on('error', () => res.destroy())
          up.pipe(res)
        },
      )
      // A <video> seeking, or a closed tab: stop reading from Hermes.
      res.on('close', () => {
        if (!res.writableFinished) upstream.destroy()
      })
      upstream.on('error', () => unavailable(res))
      upstream.end(body)
    }
    await send(false)
  }

  async function proxyUpgrade(req: http.IncomingMessage, client: net.Socket, head: Buffer, target: URL, session: string | null, retried = false) {
    const hermes = pick(req, target)
    if (!hermes) return refuse(client, 409, 'Conflict')
    let auth: Awaited<ReturnType<Hermes['socketAuth']>>
    try {
      auth = await hermes.socketAuth()
    } catch {
      return refuse(client, 502, 'Bad Gateway')
    }
    if (client.destroyed) return
    const url = new URL(upstreamPath(hermes, target), hermes.url)
    url.searchParams.delete('token')
    url.searchParams.delete('ticket')
    url.searchParams.set(...auth.param)

    const port = defaultPort(hermes.url)
    const onConnect = () => {
      const lines = [`GET ${url.pathname}${url.search} HTTP/1.1`]
      for (const [key, value] of Object.entries(forwardHeaders(req, hermes, {}))) {
        for (const v of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${v}`)
      }
      lines.push('connection: Upgrade', 'upgrade: websocket')
      upstream.write(lines.join('\r\n') + '\r\n\r\n')
      if (head.length) upstream.write(head)
    }
    const upstream =
      hermes.url.protocol === 'https:'
        ? tls.connect({ host: hermes.url.hostname, port, servername: hermes.url.hostname }, onConnect)
        : net.connect(port, hermes.url.hostname, onConnect)

    const close = () => {
      upstream.destroy()
      client.destroy()
      sockets.delete(client)
    }
    const dropUpstream = () => {
      upstream.destroy()
      sockets.delete(client)
    }

    // Look at the handshake reply before splicing: Hermes refuses a stale
    // credential with a plain HTTP 401/403, so fetch a fresh one and retry once.
    upstream.once('data', (first: Buffer) => {
      const status = Number(first.subarray(0, 16).toString().match(/^HTTP\/1\.[01] (\d{3})/)?.[1])
      if ((status === 401 || status === 403) && !retried) {
        upstream.off('close', close).off('error', close)
        client.off('close', dropUpstream).off('error', close)
        upstream.destroy()
        hermes.reject(auth.credential)
        return void proxyUpgrade(req, client, head, target, session, true)
      }
      client.write(first)
      upstream.pipe(client)
      client.pipe(upstream)
      if (status === 101) sockets.set(client, { session, hermes })
    })
    // Registered up front: a Hermes that hangs up without answering must not
    // leave the browser waiting.
    upstream.on('close', close)
    upstream.on('error', close)
    client.on('error', close)
    client.on('close', dropUpstream)
  }

  /** Drop live sockets so browsers redial: one sign-in's (sign-out), or one Hermes's (it changed or went). */
  function closeWhere(match: (owner: { session: string | null; hermes: Hermes }) => boolean) {
    for (const [socket, owner] of sockets) {
      if (!match(owner)) continue
      socket.destroy()
      sockets.delete(socket)
    }
  }

  return { proxyHttp, proxyUpgrade, closeWhere }
}

export function refuse(socket: net.Socket, status: number, text: string) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`)
}

/** The tab was pinned to a Hermes that's since been removed: it starts over on the browser's current one. */
function gone(res: http.ServerResponse) {
  res.writeHead(409, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify({ error: 'hermes_gone' }))
}

function unavailable(res: http.ServerResponse, detail = 'Hermes is not responding.') {
  if (res.headersSent) return res.destroy()
  res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify({ error: 'hermes_unreachable', detail }))
}
