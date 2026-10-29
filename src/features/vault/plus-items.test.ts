import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '@/state/vault'

vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn(), gateway: { on: () => () => {} } }))
vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: Error }))
vi.mock('@/lib/desktop', () => ({ isDesktop: false }))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('@/state/toolsets', () => ({ allowHostedApps: vi.fn() }))

const { vaultGlance } = await import('./plus-items')

const login = (origin: string): VaultEntry => ({
  id: origin,
  kind: 'login',
  label: origin.slice(8),
  origin,
  otp: false,
})
const card = (label: string): VaultEntry => ({
  id: label,
  kind: 'payment',
  label,
  origin: 'https://shop.example',
  otp: false,
})

describe('the + menu’s passwords and cards', () => {
  it('waits while the vault is read', () => {
    expect(vaultGlance(undefined, 'Hermes')).toEqual({})
  })

  it('says what each would let the agent do when there are none', () => {
    const { logins, cards } = vaultGlance([], 'Hermes')
    expect(logins).toEqual({ line: 'Let Hermes sign in for you', none: true, sites: [] })
    expect(cards).toEqual({ line: 'Let Hermes check out for you', none: true, brand: undefined })
  })

  it('names the sites as people say them, each once, and shows their icons', () => {
    const { logins } = vaultGlance(
      [
        login('https://www.notion.so'),
        login('https://www.paypal.com'),
        login('https://bank.example'),
        login('https://app.notion.so'),
      ],
      'Hermes',
    )
    expect(logins).toEqual({
      line: 'Notion, PayPal and bank.example',
      none: false,
      sites: ['www.notion.so', 'www.paypal.com', 'bank.example'],
    })
  })

  it('names the first card and counts the rest, in its network’s colours', () => {
    expect(vaultGlance([card('Visa •••• 4242')], 'Hermes').cards).toEqual({
      line: 'Visa •••• 4242',
      none: false,
      brand: 'visa',
    })
    expect(vaultGlance([card('Mastercard •••• 5100'), card('Visa •••• 4242')], 'Hermes').cards?.line).toBe(
      'Mastercard •••• 5100 and 1 more',
    )
  })

  it('keeps logins and cards apart', () => {
    const { logins, cards } = vaultGlance([card('Visa •••• 4242')], 'Hermes')
    expect(logins?.none).toBe(true)
    expect(cards?.none).toBe(false)
  })
})
