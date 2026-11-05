import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  handleSignIn,
  isSignInReturn,
  readReturn,
  resetSignIns,
  returnAddress,
  signInReturn,
  takeGrant,
} from './sso.ts'

describe('where a sign-in comes back to', () => {
  it('is Murmur’s server when the page is on its computer, as an IP literal', () => {
    expect(returnAddress('http://localhost:5173')).toEqual({
      address: 'http://127.0.0.1:5173/murmur/sign-in/return',
      here: true,
    })
    expect(returnAddress('http://127.0.0.1:8080')).toEqual({
      address: 'http://127.0.0.1:8080/murmur/sign-in/return',
      here: true,
    })
    expect(returnAddress('http://[::1]:3000')).toEqual({
      address: 'http://[::1]:3000/murmur/sign-in/return',
      here: true,
    })
    expect(returnAddress('http://127.0.0.1')).toEqual({ address: 'http://127.0.0.1/murmur/sign-in/return', here: true })
  })

  it('is a page to paste from anywhere else', () => {
    const paste = { address: 'http://127.0.0.1/murmur/sign-in/return', here: false }
    expect(returnAddress('https://murmur.example.com')).toEqual(paste)
    expect(returnAddress('http://umbrel.local:2101')).toEqual(paste)
    expect(returnAddress('http://192.168.1.20:2101')).toEqual(paste)
    // Loopback behind TLS is a proxy in front of Murmur, not Murmur itself.
    expect(returnAddress('https://localhost:8443')).toEqual(paste)
    expect(returnAddress(undefined)).toEqual(paste)
    expect(returnAddress('null')).toEqual(paste)
  })
})

describe('reading a pasted address', () => {
  it('takes the whole address, or just its query', () => {
    const want = { code: 'abc', state: 'xyz' }
    expect(readReturn('http://127.0.0.1/murmur/sign-in/return?code=abc&state=xyz')).toEqual(want)
    expect(readReturn('  127.0.0.1/murmur/sign-in/return?state=xyz&code=abc#\n')).toEqual(want)
    expect(readReturn('code=abc&state=xyz')).toEqual(want)
  })

  it('wants both the code and the state', () => {
    expect(readReturn('http://127.0.0.1/murmur/sign-in/return?code=abc')).toBeNull()
    expect(readReturn('http://127.0.0.1/murmur/sign-in/return?error=access_denied&state=xyz')).toBeNull()
    expect(readReturn('hello')).toBeNull()
    expect(readReturn('')).toBeNull()
  })

  it('is only a GET to the one return path', () => {
    expect(isSignInReturn({ method: 'GET' } as http.IncomingMessage, '/murmur/sign-in/return')).toBe(true)
    expect(isSignInReturn({ method: 'POST' } as http.IncomingMessage, '/murmur/sign-in/return')).toBe(false)
    expect(isSignInReturn({ method: 'GET' } as http.IncomingMessage, '/murmur/sign-in/return/x')).toBe(false)
  })
})

describe('signing in to a Hermes behind single sign-on', () => {
  // A stand-in Hermes: its native sign-in (RFC 8252 + PKCE), with the
  // provider's part played by `approve`, which hands back a code.
  const hermes = {
    providers: [{ name: 'self-hosted', supports_password: false }] as { name: string; supports_password: boolean }[],
    flows: ['cookie', 'native_pkce'],
    refreshes: true,
    codes: new Map<string, { challenge: string; used: boolean }>(),
    redeemed: 0,
    /** HERMES_DASHBOARD_PUBLIC_URL, when it's set. */
    publicUrl: '',
    asked: 0,
  }
  const b64 = (b: Buffer) => b.toString('base64url')
  const send = (res: http.ServerResponse, status: number, body: unknown) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  const fake = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? '', 'http://x').pathname
    if (path === '/api/status')
      return send(res, 200, { version: '0.22.5', auth_required: true, auth_flows: hermes.flows })
    if (path === '/api/auth/providers') return send(res, 200, { providers: hermes.providers })
    if (path === '/auth/native/authorize') {
      // On to the provider, with a return to Hermes's callback at its public address, else the one it was asked at.
      hermes.asked++
      const callback = `${hermes.publicUrl || `http://${req.headers.host}`}/auth/callback`
      const idp = `https://auth.example.com/authorize?client_id=hermes&redirect_uri=${encodeURIComponent(callback)}`
      return res.writeHead(302, { location: idp, 'set-cookie': 'hermes_session_pkce=x; HttpOnly' }).end()
    }
    if (path === '/auth/native/token' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const { code, code_verifier } = JSON.parse(raw)
      const issued = hermes.codes.get(code)
      const proof = b64(createHash('sha256').update(String(code_verifier)).digest())
      if (!issued || issued.used || issued.challenge !== proof)
        return send(res, 400, { detail: 'Invalid or expired authorization code.' })
      issued.used = true
      hermes.redeemed++
      return send(res, 200, {
        access_token: 'id-token',
        ...(hermes.refreshes && { refresh_token: 'idp-refresh' }),
        expires_at: 1_900_000_000,
        provider: 'self-hosted',
        user_id: 'dasun',
      })
    }
    send(res, 404, { detail: 'Not Found' })
  })

  // Just the routes sso.ts answers, as app.ts lets them through.
  const murmur = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '', 'http://m')
    if (isSignInReturn(req, url.pathname)) return void (await signInReturn(res, url))
    if (!(await handleSignIn(req, res, url.pathname))) res.writeHead(404).end()
  })

  let HERMES = ''
  let MURMUR = ''
  const listen = async (server: http.Server) => {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }
  beforeAll(async () => {
    HERMES = await listen(fake)
    MURMUR = await listen(murmur)
  })
  afterAll(() => {
    fake.close()
    murmur.close()
  })
  beforeEach(() => {
    resetSignIns()
    hermes.providers = [{ name: 'self-hosted', supports_password: false }]
    hermes.flows = ['cookie', 'native_pkce']
    hermes.refreshes = true
    hermes.publicUrl = ''
  })

  const call = async (path: string, body?: unknown, origin = 'https://murmur.example.com') => {
    const res = await fetch(`${MURMUR}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as Record<string, string> }
  }
  /** The provider's part: someone signs in, and the browser is sent to the return address. */
  const approve = (address: string) => {
    const authorize = new URL(address)
    const code = b64(randomBytes(12))
    hermes.codes.set(code, { challenge: authorize.searchParams.get('code_challenge')!, used: false })
    const back = new URL(authorize.searchParams.get('redirect_uri')!)
    back.searchParams.set('code', code)
    back.searchParams.set('state', authorize.searchParams.get('state')!)
    return back.toString()
  }

  it('opens Hermes’s native sign-in with PKCE, never handing out the verifier', async () => {
    const { status, body } = await call('/murmur/sign-in', { url: HERMES })
    expect(status).toBe(200)
    expect(body.returns).toBe('paste')
    const authorize = new URL(body.address)
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${HERMES}/auth/native/authorize`)
    expect(Object.fromEntries(authorize.searchParams)).toEqual({
      provider: 'self-hosted',
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: 'S256',
      redirect_uri: 'http://127.0.0.1/murmur/sign-in/return',
      state: expect.stringMatching(/^[\w-]{32}$/),
    })
    // The id the page holds isn't what rides through the browser.
    expect(authorize.searchParams.get('state')).not.toBe(body.id)
    expect(body.address).not.toContain('verifier')
  })

  it('opens at Hermes’s public address when Murmur reaches it at another', async () => {
    // Murmur reaches it at 127.0.0.1 (or a container's name); people, and its provider, at its own name.
    hermes.publicUrl = 'https://agents.example.com/hermes'
    const asked = hermes.asked
    const { body } = await call('/murmur/sign-in', { url: HERMES })
    const authorize = new URL(body.address)
    expect(`${authorize.origin}${authorize.pathname}`).toBe('https://agents.example.com/hermes/auth/native/authorize')
    expect(authorize.searchParams.get('provider')).toBe('self-hosted')
    // Asked once, then known for a while.
    await call('/murmur/sign-in', { url: HERMES })
    expect(hermes.asked - asked).toBe(1)
  })

  it('leaves the choice to Hermes when it has several providers', async () => {
    hermes.providers = [
      { name: 'basic', supports_password: true },
      { name: 'self-hosted', supports_password: false },
      { name: 'nous', supports_password: false },
    ]
    const { body } = await call('/murmur/sign-in', { url: HERMES })
    expect(new URL(body.address).searchParams.has('provider')).toBe(false)
  })

  it('says so when a Hermes doesn’t sign in that way, or can’t be reached', async () => {
    hermes.providers = [{ name: 'basic', supports_password: true }]
    expect(await call('/murmur/sign-in', { url: HERMES })).toEqual({
      status: 422,
      body: { error: 'This Hermes doesn’t sign in with single sign-on.' },
    })
    hermes.providers = [{ name: 'self-hosted', supports_password: false }]
    hermes.flows = ['cookie']
    expect((await call('/murmur/sign-in', { url: HERMES })).status).toBe(422)
    expect((await call('/murmur/sign-in', { url: 'http://127.0.0.1:9' })).body.error).toMatch(
      /^Couldn’t reach that address/,
    )
    expect((await call('/murmur/sign-in', { url: 'not a url' })).status).toBe(422)
  })

  it('finishes with the address the sign-in ended on, pasted', async () => {
    const { body: opened } = await call('/murmur/sign-in', { url: HERMES })
    expect((await call(`/murmur/sign-in/${opened.id}`)).body).toEqual({ status: 'waiting' })

    const ended = approve(opened.address)
    expect(ended).toMatch(/^http:\/\/127\.0\.0\.1\/murmur\/sign-in\/return\?code=/)
    expect(await call(`/murmur/sign-in/${opened.id}`, { address: ended })).toEqual({
      status: 200,
      body: { status: 'ready' },
    })
    expect((await call(`/murmur/sign-in/${opened.id}`)).body).toEqual({ status: 'ready' })

    // Taken once, for that Hermes only.
    expect(takeGrant(opened.id, 'http://elsewhere:9119')).toBeNull()
    expect(takeGrant(opened.id, HERMES)).toEqual({
      url: HERMES,
      provider: 'self-hosted',
      refresh: 'idp-refresh',
      access: 'id-token',
      expiresAt: 1_900_000_000_000,
    })
    expect(takeGrant(opened.id, HERMES)).toBeNull()
    expect((await call(`/murmur/sign-in/${opened.id}`)).body).toMatchObject({ status: 'failed' })
  })

  it('keeps waiting through a paste that isn’t this sign-in’s end', async () => {
    const { body: opened } = await call('/murmur/sign-in', { url: HERMES })
    expect(await call(`/murmur/sign-in/${opened.id}`, { address: 'http://127.0.0.1/' })).toEqual({
      status: 422,
      body: {
        status: 'waiting',
        error: 'Paste the whole address the sign-in ended on. It starts with http://127.0.0.1.',
      },
    })
    const other = await call('/murmur/sign-in', { url: HERMES })
    expect(await call(`/murmur/sign-in/${opened.id}`, { address: approve(other.body.address) })).toEqual({
      status: 422,
      body: {
        status: 'waiting',
        error: 'That address is from a different sign-in. Paste the one this sign-in ended on.',
      },
    })
    expect((await call(`/murmur/sign-in/${opened.id}`, { address: approve(opened.address) })).body.status).toBe('ready')
  })

  it('ends when Hermes no longer takes the code', async () => {
    const { body: opened } = await call('/murmur/sign-in', { url: HERMES })
    const ended = new URL(approve(opened.address))
    ended.searchParams.set('code', 'stale')
    expect(await call(`/murmur/sign-in/${opened.id}`, { address: ended.toString() })).toEqual({
      status: 422,
      body: {
        status: 'failed',
        error: 'That sign-in timed out. Start again, then paste the address within two minutes.',
      },
    })
    expect(await call('/murmur/sign-in/AAAAAAAAAAAAAAAAAAAAAAAA')).toEqual({
      status: 404,
      body: { status: 'failed', error: 'That sign-in took too long. Start again.' },
    })
  })

  it('says how to fix a provider that won’t keep people signed in', async () => {
    hermes.refreshes = false
    const { body: opened } = await call('/murmur/sign-in', { url: HERMES })
    const { body } = await call(`/murmur/sign-in/${opened.id}`, { address: approve(opened.address) })
    expect(body).toEqual({ status: 'failed', error: expect.stringContaining('offline_access') })
    expect(takeGrant(opened.id, HERMES)).toBeNull()
  })

  it('comes back by itself on Murmur’s own computer, once', async () => {
    const { body: opened } = await call('/murmur/sign-in', { url: HERMES }, MURMUR)
    expect(opened.returns).toBe('here')
    const back = approve(opened.address)
    expect(back.startsWith(`${MURMUR}/murmur/sign-in/return?`)).toBe(true)

    const before = hermes.redeemed
    const [page, again] = await Promise.all([fetch(back), fetch(back)])
    expect(await page.text()).toContain('You’re signed in')
    expect(await again.text()).toContain('You’re signed in')
    // Two loads of the same return trade the code once.
    expect(hermes.redeemed - before).toBe(1)
    expect((await call(`/murmur/sign-in/${opened.id}`)).body).toEqual({ status: 'ready' })

    const forged = new URL(back)
    forged.searchParams.set('state', 'guess')
    expect(await (await fetch(forged)).text()).toContain('didn’t go through')
  })
})
