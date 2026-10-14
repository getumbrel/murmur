import { describe, expect, it } from 'vitest'
import type { FoundHermes } from '@/state/setup'
import { agentHue, arrivedCopy, hasAgentsOrChats, placeOf, problemLine, useLabel, whereBody } from './setup-copy'

const app = (over: Partial<FoundHermes> = {}): FoundHermes => ({
  id: 'f1',
  name: 'Hermes Agent',
  where: 'umbrel',
  url: 'http://hermes-agent_web_1:18789',
  host: 'hermes-agent_web_1:18789',
  version: '0.22.0',
  agents: [
    { id: 'default', name: 'Juniper', isDefault: true },
    { id: 'sage', name: 'Sage' },
  ],
  agentCount: 2,
  chats: 3,
  ...over,
})

const studio = (over: Partial<FoundHermes> = {}) =>
  app({
    where: 'network',
    name: 'Hermes on studio.local',
    url: 'http://studio.local:9119',
    host: 'studio.local:9119',
    ...over,
  })

describe('whereBody', () => {
  it('nothing found: the built-in leads', () => {
    expect(whereBody(undefined)).toBe('Right here in Murmur, or in a Hermes you already run.')
  })
  it('names the Umbrel app by name, and says whether agents are in it', () => {
    expect(whereBody(app())).toBe('Hermes Agent is already on this Umbrel, with your agents in it.')
    expect(
      whereBody(app({ agents: [{ id: 'default', name: 'Hermes', isDefault: true }], agentCount: 1, chats: 0 })),
    ).toBe('Hermes Agent is already on this Umbrel. Use it, or start fresh.')
  })
  it('elsewhere, by where it is', () => {
    expect(whereBody(studio())).toBe('There’s a Hermes on studio.local with your agents in it.')
    expect(whereBody(app({ where: 'computer', host: 'localhost:9119' }))).toBe(
      'There’s a Hermes on this computer with your agents in it.',
    )
  })
  it('out of date, or behind a password', () => {
    expect(whereBody(app({ outdated: true }))).toBe('Hermes Agent is on this Umbrel, but it needs an update first.')
    expect(whereBody(studio({ needsSignIn: true, agents: undefined }))).toBe(
      'There’s a Hermes on studio.local. Sign in to use it, or start fresh.',
    )
  })
})

describe('the card', () => {
  it('only the Umbrel app is "Hermes Agent"', () => {
    expect(useLabel(app())).toBe('Use Hermes Agent')
    expect(useLabel(studio())).toBe('Use this Hermes')
  })
  it('a problem shows where and which version, never a container name', () => {
    expect(problemLine(app({ outdated: true, version: '0.20.1' }))).toBe('On this Umbrel · Hermes 0.20.1')
    expect(problemLine(studio())).toBe('studio.local:9119 · Hermes 0.22.0')
  })
  it('places for sentences', () => {
    expect(placeOf(app())).toBe('this Umbrel')
    expect(placeOf(studio())).toBe('studio.local')
  })
  it('agents or chats', () => {
    expect(hasAgentsOrChats(app())).toBe(true)
    expect(hasAgentsOrChats(app({ agents: [], agentCount: 1, chats: 0 }))).toBe(false)
    expect(hasAgentsOrChats(app({ agents: [], agentCount: 1, chats: 1 }))).toBe(true)
  })
})

describe('agentHue', () => {
  it('prefers the stored hue, then Hermes Desktop’s colour, then the app’s own pick', () => {
    expect(agentHue({ id: 'sage', name: 'Sage', hue: 160, color: '#ff0000' })).toBe(160)
    expect(agentHue({ id: 'default', name: 'Hermes', isDefault: true })).toBe(278)
    expect(typeof agentHue({ id: 'sage', name: 'Sage', color: '#22aa88' })).toBe('number')
    expect(agentHue({ id: 'sage', name: 'Sage' })).toBe(agentHue({ id: 'sage', name: 'Sage' }))
  })
})

describe('arrivedCopy', () => {
  it('one agent', () => {
    expect(arrivedCopy(['Juniper'], 1, 4)).toEqual({
      title: 'Your agent is here',
      body: 'Juniper came along, with all their chats.',
    })
    expect(arrivedCopy(['Juniper'], 1, 0).body).toBe('Juniper is ready to chat.')
  })
  it('two and three', () => {
    expect(arrivedCopy(['Juniper', 'Sage'], 2, 1).body).toBe('Juniper and Sage came along, with all their chats.')
    expect(arrivedCopy(['Juniper', 'Sage', 'Otto'], 3, 0)).toEqual({
      title: 'Your agents are here',
      body: 'Juniper, Sage and Otto are ready to chat.',
    })
  })
  it('more', () => {
    expect(arrivedCopy(['Juniper', 'Sage', 'Otto', 'Rowan', 'Wren', 'Pip'], 6, 240).body).toBe(
      'Juniper, Sage and 4 others came along, with all their chats.',
    )
  })
})
