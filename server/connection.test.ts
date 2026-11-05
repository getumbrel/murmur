import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startServer, type RunningServer } from './app.ts'
import { resetSignIns } from './sso.ts'

// A Hermes behind single sign-on, saved and kept signed in by Murmur's server:
// signed in to once, renewed with a refresh token that outlives a restart, and
// signed in to again when that ends.

describe('a Hermes signed in to with single sign-on', () => {
  const b64 = (b: Buffer) => b.toString('base64url')
  const json = (res: http.ServerResponse, status: number, body: unknown) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  const read = async (req: http.IncomingMessage) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    return JSON.parse(raw || '{}')
  }

  // Hermes's native sign-in, its refresh (rotating, as Authentik's does) and one API.
  const hermes = {
    codes: new Map<string, string>(),
    refresh: new Set<string>(),
    access: new Set<string>(),
    refreshes: 0,
    n: 0,
  }
  // Short-lived, as an OIDC ID token is: every request past the first renews it.
  const session = (life = 30) => {
    const n = ++hermes.n
    hermes.access.add(`at-${n}`)
    hermes.refresh.add(`rt-${n}`)
    return {
      access_token: `at-${n}`,
      refresh_token: `rt-${n}`,
      expires_at: Math.floor(Date.now() / 1000) + life,
      provider: 'self-hosted',
    }
  }
  const fake = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? '', 'http://x').pathname
    if (path === '/api/status')
      return json(res, 200, { version: '0.22.5', auth_required: true, auth_flows: ['cookie', 'native_pkce'] })
    if (path === '/api/auth/providers')
      return json(res, 200, { providers: [{ name: 'self-hosted', supports_password: false }] })
    if (path === '/auth/native/token') {
      const { code, code_verifier } = await read(req)
      const challenge = hermes.codes.get(code)
      hermes.codes.delete(code)
      if (!challenge || challenge !== b64(createHash('sha256').update(code_verifier).digest()))
        return json(res, 400, {})
      return json(res, 200, session())
    }
    if (path === '/auth/native/refresh') {
      const { refresh_token, provider } = await read(req)
      if (provider !== 'self-hosted' || !hermes.refresh.delete(refresh_token))
        return json(res, 401, { error: 'session_expired' })
      hermes.refreshes++
      return json(res, 200, session())
    }
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    if (!hermes.access.has(bearer)) return json(res, 401, { detail: 'Unauthorized' })
    if (path === '/api/sessions') return json(res, 200, { sessions: [] })
    json(res, 404, {})
  })

  type Connection = { id: string; status: string; mode: string; error?: string }
  /** The parts of Murmur's answers read here. */
  type Answer = Partial<Connection> & {
    address: string
    returns: string
    connection: Connection & { name: string }
    connections: Connection[]
    found: (Connection & { name: string })[]
  }

  let HERMES = ''
  let dir = ''
  let murmur: RunningServer
  const start = async (env = {}) => (murmur = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, env }))
  const saved = () =>
    JSON.parse(readFileSync(join(dir, 'murmur.json'), 'utf8')).connections as Record<string, unknown>[]

  beforeAll(async () => {
    await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done))
    HERMES = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`
  })
  afterAll(() => fake.close())
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'murmur-sso-'))
    resetSignIns()
    await start()
  })
  afterEach(async () => {
    await murmur.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${murmur.url}${path}`, {
      method,
      // The page is on Murmur's own computer, so the sign-in comes straight back.
      headers: { 'content-type': 'application/json', origin: murmur.url },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as Answer }
  }
  /** Someone signs in, the way a browser would: Hermes's page, the provider, and back to Murmur. */
  const signIn = async () => {
    const { body } = await call('POST', '/murmur/sign-in', { url: HERMES })
    expect(body.returns).toBe('here')
    const authorize = new URL(body.address)
    const code = b64(randomBytes(12))
    hermes.codes.set(code, authorize.searchParams.get('code_challenge')!)
    const back = new URL(authorize.searchParams.get('redirect_uri')!)
    back.search = new URLSearchParams({ code, state: authorize.searchParams.get('state')! }).toString()
    // No header, no Murmur sign-in: it's the person's browser coming back.
    expect(await (await fetch(back)).text()).toContain('You’re signed in')
    expect((await call('GET', `/murmur/sign-in/${body.id}`)).body).toEqual({ status: 'ready' })
    return body.id!
  }

  it('is saved with what renews it, never its access token, and renewed across a restart', async () => {
    const added = await call('POST', '/murmur/connections', { url: HERMES, signIn: await signIn(), activate: true })
    expect(added.status).toBe(200)
    expect(added.body.connection).toMatchObject({ status: 'connected', mode: 'sso' })
    const [entry] = saved()
    expect(entry.sso).toEqual({ provider: 'self-hosted', refresh: expect.stringMatching(/^rt-/) })
    expect(JSON.stringify(entry)).not.toMatch(/at-\d/)

    // Its access token is nearly up: the next check renews it, and the new refresh token is written down.
    const before = entry.sso as { refresh: string }
    expect((await call('GET', '/murmur/connection')).body).toMatchObject({ status: 'connected', mode: 'sso' })
    const renewed = saved()[0].sso as { refresh: string }
    expect(renewed.refresh).not.toBe(before.refresh)
    expect(hermes.refresh.has(renewed.refresh)).toBe(true)

    await murmur.close()
    await start()
    const id = entry.id as string
    const { body } = await call('GET', '/murmur/connections')
    expect(body.connections.find((c) => c.id === id)).toMatchObject({
      status: 'connected',
      mode: 'sso',
    })
  })

  it('asks to sign in again once it has ended, and takes the new sign-in', async () => {
    const { body } = await call('POST', '/murmur/connections', { url: HERMES, signIn: await signIn(), activate: true })
    const id = body.connection.id

    // Signed out at the provider: every refresh token is gone.
    hermes.refresh.clear()
    hermes.access.clear()
    await murmur.close()
    await start()
    const ended = await call('GET', `/murmur/connections`)
    expect(ended.body.connections.find((c) => c.id === id)).toMatchObject({
      status: 'needs-login',
      mode: 'sso',
      error: 'Your sign-in to this Hermes has ended. Sign in again.',
    })
    // Still saved, to be signed in to again.
    expect(saved()[0].sso).toBeDefined()

    const again = await call('PATCH', `/murmur/connections/${id}`, { url: HERMES, signIn: await signIn() })
    expect(again.body.connection).toMatchObject({ status: 'connected', mode: 'sso' })
    expect(hermes.refresh.has((saved()[0].sso as { refresh: string }).refresh)).toBe(true)
  })

  it('is offered when found nearby, and chosen with a single sign-on', async () => {
    await murmur.close()
    await start({ MURMUR_FIND_HERMES: `Studio=${HERMES}` })
    const { body: setup } = await call('GET', '/murmur/setup')
    const [found] = setup.found
    expect(found).toMatchObject({ name: 'Studio', needsSignIn: true, signIns: ['sso'] })

    // Started by its id, so the sign-in goes where Murmur's server found it.
    const { body: opened } = await call('POST', '/murmur/sign-in', { found: found.id })
    const authorize = new URL(opened.address!)
    const code = b64(randomBytes(12))
    hermes.codes.set(code, authorize.searchParams.get('code_challenge')!)
    const back = new URL(authorize.searchParams.get('redirect_uri')!)
    back.search = new URLSearchParams({ code, state: authorize.searchParams.get('state')! }).toString()
    await fetch(back)

    const chosen = await call('POST', '/murmur/setup', { use: 'found', id: found.id, signIn: opened.id })
    expect(chosen).toMatchObject({
      status: 200,
      body: { connection: { name: 'Studio', status: 'connected', mode: 'sso' } },
    })
    expect(saved()[0].sso).toEqual({ provider: 'self-hosted', refresh: expect.any(String) })
    expect((await call('POST', '/murmur/sign-in', { found: 'nobody' })).status).toBe(404)
  })

  it('takes a sign-in once, and only for its own Hermes', async () => {
    const id = await signIn()
    const elsewhere = await call('POST', '/murmur/connections', { url: 'http://127.0.0.1:9', signIn: id })
    expect(elsewhere).toMatchObject({
      status: 422,
      body: { status: 'needs-login', error: 'That sign-in has expired. Sign in again.' },
    })
    expect((await call('POST', '/murmur/connections', { url: HERMES, signIn: id })).status).toBe(200)
    expect((await call('POST', '/murmur/connections', { url: HERMES, signIn: id })).body.error).toBe(
      'That sign-in has expired. Sign in again.',
    )
  })

  it('is checked through the Hermes that renews it, never with a refresh token already spent', async () => {
    await call('POST', '/murmur/connections', { url: HERMES, signIn: await signIn(), activate: true })
    for (let i = 0; i < 3; i++) {
      expect((await call('POST', '/murmur/connection/test', { url: HERMES })).body).toMatchObject({
        status: 'connected',
        mode: 'sso',
      })
      expect((await call('GET', '/murmur/connection')).body).toMatchObject({ status: 'connected' })
    }
    expect(hermes.refresh.has((saved()[0].sso as { refresh: string }).refresh)).toBe(true)
  })
})

describe('the desktop app’s server', () => {
  // Its per-launch header keeps everything else on the computer out, but a sign-in comes back in the system browser.
  let murmur: RunningServer
  let dir = ''
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'murmur-desktop-'))
    murmur = await startServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: dir,
      env: {},
      requireHeader: { name: 'x-murmur-desktop', value: 'launch' },
    })
  })
  afterAll(async () => {
    await murmur.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('takes a sign-in coming back without its header, and nothing else', async () => {
    const back = await fetch(`${murmur.url}/murmur/sign-in/return?code=abc&state=unknown`)
    // Answered (a state it never issued), not turned away.
    expect(back.status).toBe(400)
    expect(await back.text()).toContain('didn’t go through')
    expect((await fetch(`${murmur.url}/murmur/sign-in/abcdefghijklmnopqrstuvwx`)).status).toBe(403)
    expect((await fetch(`${murmur.url}/murmur/sign-in`, { method: 'POST', body: '{}' })).status).toBe(403)
  })
})
