import { describe, expect, it, vi } from 'vitest'

// The helpers are plain logic; what they sit beside needs a browser.
vi.mock('@/hermes/instance', () => ({ adoptHermes: () => true, tabHermes: () => null }))
vi.mock('@/state/connection', () => ({ connectionKey: [], connectionsKey: [], switchHermes: () => {} }))

const { agentNames, countLine, holdsSomething, pickLead, recommended } = await import('./setup')
type FoundHermes = import('./setup').FoundHermes

const found = (over: Partial<FoundHermes>): FoundHermes => ({
  id: 'x',
  name: 'x',
  where: 'network',
  url: 'http://x',
  host: 'x',
  ...over,
})
const agents = (...names: string[]) => names.map((name, i) => ({ id: name.toLowerCase(), name, isDefault: i === 0 }))

describe('the lead', () => {
  it('is usable first, then on this Umbrel, then has the most agents', () => {
    const umbrelOld = found({ id: 'a', where: 'umbrel', outdated: true })
    const locked = found({ id: 'b', where: 'umbrel', needsSignIn: true })
    const small = found({ id: 'c', where: 'network', agentCount: 1 })
    const big = found({ id: 'd', where: 'network', agentCount: 6 })
    const here = found({ id: 'e', where: 'computer', agentCount: 1 })
    expect(pickLead([umbrelOld, locked, small, big, here])?.id).toBe('e')
    expect(pickLead([umbrelOld, locked, small, big])?.id).toBe('d')
    expect(pickLead([locked, umbrelOld])?.id).toBe('a')
    expect(pickLead([])).toBeUndefined()
  })
})

describe('recommending', () => {
  it('only a usable Hermes that holds something', () => {
    expect(holdsSomething(found({ agentCount: 1 }))).toBe(false)
    expect(holdsSomething(found({ agentCount: 2 }))).toBe(true)
    expect(holdsSomething(found({ chats: 1 }))).toBe(true)
    expect(holdsSomething(found({ hasModel: true }))).toBe(true)
    expect(recommended(found({ chats: 3, outdated: true }))).toBe(false)
    expect(recommended(found({ chats: 3, needsSignIn: true }))).toBe(false)
    expect(recommended(found({ chats: 3 }))).toBe(true)
  })
})

describe('copy', () => {
  it('names agents, main first', () => {
    expect(agentNames(found({}))).toBe('')
    expect(agentNames(found({ agents: agents('Juniper') }))).toBe('Juniper')
    expect(agentNames(found({ agents: agents('Juniper', 'Sage') }))).toBe('Juniper and Sage')
    expect(agentNames(found({ agents: agents('Juniper', 'Sage', 'Otto') }))).toBe('Juniper, Sage and Otto')
    expect(agentNames(found({ agents: agents('Juniper', 'Sage', 'Otto', 'Rowan') }))).toBe(
      'Juniper, Sage, Otto and Rowan',
    )
    expect(agentNames(found({ agents: agents('Juniper', 'Sage', 'Otto', 'Rowan', 'Ivy', 'Moss') }))).toBe(
      'Juniper, Sage, Otto and 3 more',
    )
    expect(
      agentNames(
        found({
          agents: [
            { id: 'b', name: 'Sage' },
            { id: 'a', name: 'Hermes', isDefault: true },
          ],
        }),
      ),
    ).toBe('Hermes and Sage')
    expect(agentNames(found({ agents: agents('Juniper', 'Sage'), agentCount: 9 }))).toBe('Juniper, Sage and 7 more')
  })

  it('counts', () => {
    expect(countLine(found({ where: 'umbrel', agentCount: 6, chats: 240 }))).toBe(
      'On this Umbrel · 6\u00a0agents · 100+\u00a0chats',
    )
    expect(countLine(found({ agentCount: 1, chats: 1 }))).toBe('1\u00a0agent · 1\u00a0chat')
    expect(countLine(found({ agents: agents('A', 'B'), chats: 0 }))).toBe('2\u00a0agents')
    expect(countLine(found({ where: 'umbrel' }))).toBe('On this Umbrel')
  })
})
