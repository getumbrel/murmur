import { describe, expect, it, vi } from 'vitest'
import type { CatalogApp } from '@/state/apps'

vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn(), gateway: { on: () => () => {} } }))
vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: Error }))
vi.mock('@/lib/desktop', () => ({ isDesktop: false }))
vi.mock('@/state/toolsets', () => ({ allowHostedApps: vi.fn() }))

const { hostedAppFrom } = await import('@/state/hosted-apps-names')
const { arrangeWall, itemName } = await import('./wall')
const { namesLine, offerLine } = await import('./glance')

const direct = (name: string): CatalogApp => ({
  name,
  description: `${name} things`,
  auth_type: 'oauth',
  required_env: [],
  url: null,
  needs_install: false,
})
const name = (n: string) => n.charAt(0).toUpperCase() + n.slice(1)
const offer = (over: Partial<Parameters<typeof arrangeWall>[0]> = {}) =>
  offerLine(
    arrangeWall({
      direct: ['notion', 'linear'].map(direct),
      hosted: [],
      nameOf: name,
      email: true,
      added: new Set(),
      connectedSlugs: new Set(),
      ...over,
    }),
    (item) => itemName(item, name),
  )

describe('the apps an agent uses, in a line', () => {
  it('names up to three, then counts the rest', () => {
    expect(namesLine(['Gmail'])).toBe('Gmail')
    expect(namesLine(['Gmail', 'Slack'])).toBe('Gmail and Slack')
    expect(namesLine(['Gmail', 'Slack', 'GitHub'])).toBe('Gmail, Slack and GitHub')
    expect(namesLine(['Gmail', 'Slack', 'GitHub', 'Notion', 'Linear'])).toBe('Gmail, Slack and 3 more')
  })

  it('names an app with two accounts once', () => {
    expect(namesLine(['Slack', 'Slack', 'Gmail'])).toBe('Slack and Gmail')
  })
})

describe('what an agent with none could have', () => {
  it('is the wall’s first two', () => {
    expect(offer()).toBe('Email, Notion and more')
    expect(offer({ email: false })).toBe('Notion, Linear and more')
  })

  it('doesn’t follow Email with Gmail, which it covers', () => {
    const hosted = ['gmail', 'googlecalendar'].map((slug) => hostedAppFrom({ slug, category: 'Communication' }))
    expect(offer({ hosted })).toBe('Email, Google Calendar and more')
  })

  it('has nothing to say about an empty wall', () => {
    expect(offer({ direct: [], email: false })).toBeUndefined()
  })
})
