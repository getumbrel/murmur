import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Hermes } from './hermes.ts'
import { isOAuthReturn, returnPage } from './oauth-return.ts'
import { createProxy } from './proxy.ts'

const req = (method: string) => ({ method }) as http.IncomingMessage

describe('an app’s sign-in coming back', () => {
  it('is only a GET for one app', () => {
    expect(isOAuthReturn(req('GET'), '/hermes/api/mcp/oauth/callback/notion')).toBe(true)
    expect(isOAuthReturn(req('POST'), '/hermes/api/mcp/oauth/callback/notion')).toBe(false)
    expect(isOAuthReturn(req('GET'), '/hermes/api/mcp/oauth/callback/')).toBe(false)
    expect(isOAuthReturn(req('GET'), '/hermes/api/mcp/oauth/flows/abc')).toBe(false)
    expect(isOAuthReturn(req('GET'), '/hermes/api/mcp/servers')).toBe(false)
    expect(isOAuthReturn(req('GET'), '/hermes/api/mcp/oauth/callback/n8n-official')).toBe(true)
    // Only one app's return, never anything deeper or sideways.
    expect(isOAuthReturn(req('GET'), '/hermes/api/mcp/oauth/callback/a/b')).toBe(false)
    expect(isOAuthReturn(req('GET'), '/hermes/api/mcp/oauth/callback/..')).toBe(false)
    expect(isOAuthReturn(req('GET'), '/hermes/api/mcp/oauth/callback/%2e%2e')).toBe(false)
  })

  it('lands on a page that closes itself once it worked, and stays to say when it didn’t', () => {
    expect(returnPage(true)).toContain('You’re signed in')
    expect(returnPage(true)).toContain('window.close()')
    expect(returnPage(false)).toContain('didn’t go through')
    expect(returnPage(false)).not.toContain('window.close()')
  })
})

describe('the relay for a sign-in coming back', () => {
  // A stand-in Hermes that takes a code once, as Hermes's callback does.
  const seen: http.IncomingHttpHeaders[] = []
  const paths: string[] = []
  const used = new Set<string>()
  const hermes = http.createServer((req, res) => {
    seen.push(req.headers)
    paths.push(req.url ?? '')
    const state = new URL(req.url ?? '', 'http://x').searchParams.get('state') ?? ''
    const ok = state.startsWith('good') && !used.has(state)
    used.add(state)
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html' }).end('<p>Hermes page</p>')
  })
  let murmur: http.Server
  let base = ''
  let down = false

  beforeAll(async () => {
    await new Promise<void>((done) => hermes.listen(0, '127.0.0.1', done))
    const target = new URL(`http://127.0.0.1:${(hermes.address() as AddressInfo).port}`)
    const proxy = createProxy(() =>
      down ? ({ url: new URL('http://127.0.0.1:9'), prefix: '' } as Hermes) : ({ url: target, prefix: '' } as Hermes),
    )
    murmur = http.createServer((req, res) => void proxy.proxyOAuthReturn(req, res, new URL(req.url ?? '', 'http://m')))
    await new Promise<void>((done) => murmur.listen(0, '127.0.0.1', done))
    base = `http://127.0.0.1:${(murmur.address() as AddressInfo).port}`
  })
  afterAll(() => {
    hermes.close()
    murmur.close()
  })

  const back = (query: string) =>
    fetch(`${base}/hermes/api/mcp/oauth/callback/notion?${query}`, {
      headers: { cookie: 'murmur=secret', authorization: 'Bearer browser' },
    })

  it('hands the code to Hermes, and shows Murmur’s own page', async () => {
    const res = await back('code=abc&state=good-1&hermes=main')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('You’re signed in')
    expect(html).not.toContain('Hermes page')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    // Hermes's own path, without Murmur's choice of Hermes, and nothing of the browser's.
    expect(paths.at(-1)).toBe('/api/mcp/oauth/callback/notion?code=abc&state=good-1')
    expect(seen.at(-1)?.cookie).toBeUndefined()
    expect(seen.at(-1)?.authorization).toBeUndefined()
  })

  it('says it didn’t go through when Hermes turns the code down, or it’s used twice', async () => {
    expect((await back('code=abc&state=bad')).status).toBe(400)
    expect((await back('code=abc&state=good-2')).status).toBe(200)
    const again = await back('code=abc&state=good-2')
    expect(again.status).toBe(400)
    expect(await again.text()).toContain('didn’t go through')
  })

  it('says it didn’t go through when Hermes can’t be reached', async () => {
    down = true
    try {
      expect((await back('code=abc&state=good-3')).status).toBe(400)
    } finally {
      down = false
    }
  })
})
