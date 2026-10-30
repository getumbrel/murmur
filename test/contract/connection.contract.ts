// How Murmur's server finds and signs in to a Hermes (server/hermes.ts): the
// public status probe, password sign-in, token refresh and socket tickets.

import { describe, expect, inject, it } from 'vitest'
import { MIN_HERMES_VERSION, olderThan, readCookies } from '../../server/hermes.ts'
import { HERMES_PASSWORD, HERMES_USERNAME } from './harness'
import { api, MURMUR } from './client'

const HERMES = inject('hermes').url

async function signIn() {
  const res = await fetch(`${HERMES}/auth/password-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'basic', username: HERMES_USERNAME, password: HERMES_PASSWORD }),
    redirect: 'manual',
  })
  // Read the way Murmur's server reads them (refresh tokens come quoted).
  return { res, jar: readCookies(res.headers.getSetCookie()) }
}

describe('finding Hermes', () => {
  it('says what it is and whether it needs a sign-in, without one', async () => {
    const status = await (await fetch(`${HERMES}/api/status`)).json()
    expect(status.version).toEqual(expect.any(String))
    expect(status.auth_required).toBe(true)
    expect(olderThan(status.version, MIN_HERMES_VERSION)).toBe(false)
    expect(status.gateway_running).toBe(true)
    expect(typeof status.gateway_busy).toBe('boolean')
    expect(status.install_id).toEqual(expect.any(String))
    // In a container, where `hermes update` can't apply: Murmur says to pull a newer image instead.
    expect(status.can_update_hermes).toBe(false)
  })

  it('answers /api/health with its version', async () => {
    const health = await (await fetch(`${HERMES}/api/health`)).json()
    expect(health.version).toEqual(expect.any(String))
  })

  it('keeps its API behind the sign-in', async () => {
    expect((await fetch(`${HERMES}/api/profiles`)).status).toBe(401)
  })
})

describe('password sign-in', () => {
  it('offers a provider that takes a password', async () => {
    const { providers } = await (await fetch(`${HERMES}/api/auth/providers`)).json()
    expect(providers).toContainEqual(expect.objectContaining({ name: expect.any(String), supports_password: true }))
  })

  it('signs in with tokens in cookies, and refuses a wrong password with 401', async () => {
    const { res, jar } = await signIn()
    expect(res.ok).toBe(true)
    expect(jar.get('hermes_session_at')?.value).toBeTruthy()
    expect(jar.get('hermes_session_at')?.maxAge).toBeGreaterThan(60)
    expect(jar.get('hermes_session_rt')?.value).toBeTruthy()

    const wrong = await fetch(`${HERMES}/auth/password-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'basic', username: HERMES_USERNAME, password: 'not-it' }),
    })
    expect(wrong.status).toBe(401)
  })

  it('takes the access token as a Bearer token, and mints socket tickets with it', async () => {
    const { jar } = await signIn()
    const auth = { authorization: `Bearer ${jar.get('hermes_session_at')!.value}` }
    expect((await fetch(`${HERMES}/api/sessions?limit=1`, { headers: auth })).ok).toBe(true)

    const ticket = await fetch(`${HERMES}/api/auth/ws-ticket`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })
    expect(ticket.ok).toBe(true)
    expect((await ticket.json()).ticket).toEqual(expect.any(String))
  })

  it('rotates the refresh token', async () => {
    const { jar } = await signIn()
    const res = await fetch(`${HERMES}/auth/native/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: jar.get('hermes_session_rt')!.value, provider: 'basic' }),
    })
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.access_token).toEqual(expect.any(String))
    expect(body.expires_at * 1000).toBeGreaterThan(Date.now())
    expect(body.refresh_token === null || typeof body.refresh_token === 'string').toBe(true)
  })
})

describe('through Murmur', () => {
  it('reports the Hermes as connected, by password', async () => {
    const res = await fetch(`${MURMUR}/murmur/connection`)
    const info = await res.json()
    expect(info).toMatchObject({ status: 'connected', mode: 'password', hermesVersion: inject('hermes').version })
    expect(info.outdated).toBeFalsy()
  })

  it('proxies the REST API', async () => {
    const { profiles } = await api.get('/api/profiles')
    expect(profiles).toContainEqual(expect.objectContaining({ name: 'default', is_default: true }))
  })
})
