import { describe, expect, it, vi } from 'vitest'
import type { CatalogApp } from '@/state/apps'

vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn(), gateway: { on: () => () => {} } }))
vi.mock('@/hermes/rest', () => ({ api: {}, HermesError: Error }))
vi.mock('@/lib/desktop', () => ({ isDesktop: false }))
vi.mock('@/state/toolsets', () => ({ allowHostedApps: vi.fn() }))

const { hostedAppFrom } = await import('@/state/hosted-apps-names')
const { arrangeWall, itemName, matchesSearch, searchWall, EMAIL_TILE } = await import('./wall')

const direct = (name: string, description = `${name} things`): CatalogApp => ({
  name,
  description,
  auth_type: 'oauth',
  required_env: [],
  url: null,
  needs_install: false,
})
const DIRECT = ['notion', 'todoist', 'linear', 'atlassian', 'sentry', 'asana'].map((n) => direct(n))
const HOSTED = [
  hostedAppFrom({ slug: 'slack', name: 'Slack', description: 'Read and post messages', category: 'Communication' }),
  hostedAppFrom({ slug: 'jira', name: 'Jira', description: 'Issues', category: 'Work management' }),
  hostedAppFrom({ slug: 'asana', name: 'Asana', description: 'Tasks', category: 'Work management' }),
  hostedAppFrom({ slug: 'resend_mcp', name: 'Resend', description: 'Send email from code', category: 'Communication' }),
]
const name = (n: string) => n.charAt(0).toUpperCase() + n.slice(1)
const keys = (items: { key: string }[]) => items.map((i) => i.key)
const wall = (over: Partial<Parameters<typeof arrangeWall>[0]> = {}) =>
  arrangeWall({ direct: DIRECT, hosted: HOSTED, nameOf: name, email: true, added: new Set(), connectedSlugs: new Set(), ...over })

describe('the wall', () => {
  it('leads with Email, then everyday apps with Nous’s among them', () => {
    expect(keys(wall().everyday)).toEqual(['email', 'notion', 'nous:slack', 'todoist', 'linear', 'nous:asana', 'atlassian'])
  })

  it('offers Email only when this Hermes has it and the agent has no account', () => {
    expect(keys(wall({ email: false }).everyday)).not.toContain('email')
  })

  it('leaves out what’s connected: the agent’s own apps, and Nous’s apps on this Hermes', () => {
    const { everyday } = wall({ added: new Set(['notion']), connectedSlugs: new Set(['slack']) })
    expect(keys(everyday)).toEqual(['email', 'todoist', 'linear', 'nous:asana', 'atlassian'])
  })

  it('never offers what can’t connect, or Nous’s twin of one Hermes connects itself', () => {
    const all = [...wall().everyday, ...wall().developer]
    // Asana can't sign in through Hermes, so it comes through Nous; Jira is Atlassian's.
    expect(keys(all)).not.toContain('asana')
    expect(keys(all)).not.toContain('nous:jira')
  })

  it('keeps developer tools apart', () => {
    expect(keys(wall().developer)).toEqual(['nous:resend_mcp', 'sentry'])
  })

  it('shows nothing from Nous when this Hermes can’t reach it', () => {
    expect(keys(wall({ hosted: [] }).everyday)).toEqual(['email', 'notion', 'todoist', 'linear', 'atlassian'])
  })
})

describe('searching', () => {
  it('finds apps by the names people know them by', () => {
    expect(keys(searchWall(wall(), 'jira', name))).toEqual(['atlassian'])
    expect(keys(searchWall(wall(), 'confluence', name))).toEqual(['atlassian'])
    expect(keys(searchWall(wall(), 'gmail', name))).toEqual(['email'])
    expect(keys(searchWall(wall(), 'inbox', name))).toEqual(['email'])
  })

  it('covers Nous’s apps, by name and by what they do', () => {
    expect(keys(searchWall(wall(), 'slack', name))).toEqual(['nous:slack'])
    expect(keys(searchWall(wall(), 'post messages', name))).toEqual(['nous:slack'])
  })

  it('puts everyday apps before developer tools, and matches any case', () => {
    expect(keys(searchWall(wall(), 'EMAIL', name))).toEqual(['email', 'nous:resend_mcp'])
  })

  it('matches everything with no words', () => {
    expect(matchesSearch(EMAIL_TILE, '  ', name)).toBe(true)
  })

  it('names tiles the way their makers do', () => {
    expect(itemName(EMAIL_TILE, name)).toBe('Email')
    expect(itemName(wall().everyday[2], name)).toBe('Slack')
  })
})
