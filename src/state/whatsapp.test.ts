import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: class extends Error {}, within: () => ({}) }))
vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn() }))
vi.mock('@/hermes/compat', () => ({ listProfiles: vi.fn() }))

const { linkFrom, statusFrom, phoneLabel, chatLink, linkActive } = await import('./whatsapp')

const platform = (over: Record<string, unknown> = {}) => ({
  id: 'whatsapp',
  enabled: true,
  configured: true,
  gateway_running: true,
  state: 'connected',
  ...over,
})

describe('WhatsApp status', () => {
  it('is off until it’s switched on and set up', () => {
    expect(statusFrom(undefined)).toEqual({ state: 'off' })
    expect(statusFrom(platform({ enabled: false }))).toEqual({ state: 'off' })
    expect(statusFrom(platform({ configured: false, state: 'not_configured' }))).toEqual({ state: 'off' })
  })

  it('says how a linked agent is doing', () => {
    const setup = { whatsapp_setup: { mode: 'bot' } }
    expect(statusFrom(platform(setup))).toEqual({ state: 'connected', mode: 'bot' })
    expect(statusFrom(platform({ ...setup, state: 'pending_restart' })).state).toBe('starting')
    expect(statusFrom(platform({ ...setup, state: 'gateway_stopped' })).state).toBe('problem')
    expect(statusFrom(platform({ ...setup, state: 'fatal' })).problem).toMatch(/answering/)
  })

  it('trusts the mode for an agent Hermes calls “not configured”, and its own messaging for how it’s doing', () => {
    const named = platform({ configured: false, state: 'not_configured', whatsapp_setup: { mode: 'self-chat' } })
    expect(statusFrom(named, { state: 'connected' })).toEqual({ state: 'connected', mode: 'self-chat' })
    expect(statusFrom(named).state).toBe('starting')
    expect(statusFrom({ ...named, gateway_running: false }).state).toBe('problem')
  })
})

describe('linking', () => {
  const start = { phase: 'starting', mode: 'self-chat' } as const

  it('gets ready, shows a code, and keeps the newest one', () => {
    const ready = linkFrom({ pairing_id: 'p1', status: 'installing', expires_at: '2026-10-15T09:00:00Z' }, start)
    expect(ready).toMatchObject({ phase: 'installing', id: 'p1', expiresAt: Date.parse('2026-10-15T09:00:00Z') })
    // Once downloading, the bridge starting up is still "getting ready".
    expect(linkFrom({ status: 'starting' }, ready).phase).toBe('installing')
    const waiting = linkFrom({ status: 'waiting', qr_payload: 'qr-1' }, ready)
    expect(waiting).toMatchObject({ phase: 'waiting', qr: 'qr-1', id: 'p1' })
    expect(linkFrom({ status: 'waiting', qr_payload: 'qr-2' }, waiting).qr).toBe('qr-2')
    expect(linkActive(waiting.phase)).toBe(true)
  })

  it('moves on to saving once the phone has scanned, with who it’s linked to', () => {
    const next = linkFrom(
      { status: 'connected', account_name: 'Sam', account_phone: '15551234567' },
      { ...start, phase: 'waiting', qr: 'qr' },
    )
    expect(next).toMatchObject({ phase: 'saving', qr: undefined, account: { name: 'Sam', phone: '15551234567' } })
    expect(linkActive(next.phase)).toBe(false)
  })

  it('ends in words a person can act on', () => {
    expect(linkFrom({ status: 'expired' }, start).phase).toBe('expired')
    expect(linkFrom({ status: 'error', error: 'npm install failed for WhatsApp bridge' }, start)).toMatchObject({
      phase: 'failed',
      message: expect.stringMatching(/internet/),
    })
    expect(linkFrom({ status: 'cancelled' }, start).message).toMatch(/somewhere else/)
    expect(linkFrom({ status: 'error', error: 'logged_out' }, start).message).toMatch(/fresh code/)
  })
})

describe('numbers', () => {
  it('reads like a phone number', () => {
    expect(phoneLabel('15551234567')).toBe('+1 555 123 4567')
    expect(phoneLabel('447700900123')).toBe('+447700900123')
    expect(phoneLabel(undefined)).toBeUndefined()
    expect(chatLink('+1 555 123 4567')).toBe('https://wa.me/15551234567')
  })
})
