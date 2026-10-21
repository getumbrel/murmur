import { describe, expect, it } from 'vitest'
import {
  AWAY_MS,
  candidate,
  candidateId,
  offer,
  parseFindList,
  quietState,
  remembered,
  RESTART_PATIENCE_MS,
  START_PATIENCE_MS,
  toFoundAgents,
  withHiddenToolsets,
  type Found,
} from './discovery.ts'

describe('where to look', () => {
  it('reads names and addresses, and skips what isn’t one', () => {
    const list = parseFindList(
      'Hermes Agent=http://hermes-agent_web_1:18789, localhost:9119,,not an address,studio.local:9119/',
    )
    expect(list.map((c) => [c.name, c.label, c.url, c.where])).toEqual([
      ['Hermes Agent', 'Hermes Agent', 'http://hermes-agent_web_1:18789', 'umbrel'],
      ['Hermes on this computer', undefined, 'http://localhost:9119', 'computer'],
      ['Hermes on studio.local', undefined, 'http://studio.local:9119', 'network'],
    ])
  })

  it('names the Hermes Agent app by its app, even without a name given', () => {
    expect(candidate('http://hermes-agent_web_1:18789')).toMatchObject({
      name: 'Hermes Agent',
      where: 'umbrel',
      host: 'hermes-agent_web_1:18789',
    })
  })

  it('keeps an id per address, the same on every start', () => {
    expect(candidateId('http://localhost:9119')).toBe(candidateId('http://localhost:9119'))
    expect(candidateId('http://localhost:9119')).not.toBe(candidateId('http://127.0.0.1:9119'))
    expect(candidateId('http://localhost:9119')).toMatch(/^f[0-9a-f]{12}$/)
  })

  it('lists an address once', () => {
    expect(parseFindList('http://localhost:9119,A=localhost:9119')).toHaveLength(1)
  })
})

describe('agents found', () => {
  it('read as the app shows them, main agent first', () => {
    const agents = toFoundAgents([
      {
        name: 'coder',
        is_default: false,
        ui_meta: { murmur: { hue: 160 }, 'hermes-bots': { title: 'Ada', color: '#22aa88' } },
      },
      { name: 'research-helper', is_default: false },
      { name: 'default', is_default: true },
      { name: 'writer', display_name: 'Sage', bot_title: '', ui_meta: { 'hermes-bots': { color: 'not a colour' } } },
      { nope: true },
    ])
    expect(agents).toEqual([
      { id: 'default', name: 'Hermes', isDefault: true },
      { id: 'coder', name: 'Ada', hue: 160, color: '#22aa88' },
      { id: 'research-helper', name: 'Research Helper' },
      { id: 'writer', name: 'Sage' },
    ])
  })

  it('take REST’s bot title when there’s no ui_meta', () => {
    expect(toFoundAgents([{ name: 'ada', bot_title: 'Ada' }])).toEqual([{ id: 'ada', name: 'Ada' }])
    expect(toFoundAgents(null)).toEqual([])
  })
})

describe('what to offer', () => {
  const found = (over: Partial<Found>): Found => ({
    id: 'x',
    name: 'x',
    where: 'network',
    url: 'http://x',
    host: 'x',
    ...over,
  })

  it('leaves out a Hermes Murmur has, by address or by install', () => {
    const list = [
      found({ url: 'http://a', installId: '1' }),
      found({ url: 'http://b', installId: '2' }),
      found({ url: 'http://c' }),
      null,
    ]
    expect(offer(list, { urls: new Set(['http://a']), installIds: new Set(['2']) }).map((f) => f.url)).toEqual([
      'http://c',
    ])
  })

  it('lists one Hermes at two addresses once, as the Hermes Agent app when it’s that', () => {
    const list = [
      found({ url: 'http://localhost:18789', where: 'computer', installId: '1' }),
      found({ url: 'http://127.0.0.1:18789', where: 'computer', installId: '1' }),
      found({ url: 'http://hermes-agent_web_1:18789', where: 'umbrel', installId: '1' }),
      found({ url: 'http://studio.local:9119', installId: '2' }),
    ]
    expect(offer(list, { urls: new Set(), installIds: new Set() }).map((f) => f.url)).toEqual([
      'http://hermes-agent_web_1:18789',
      'http://studio.local:9119',
    ])
  })
})

describe('a found Hermes that goes quiet', () => {
  const seen: Found = { id: 'x', name: 'Hermes Agent', where: 'umbrel', url: 'http://x', host: 'x', outdated: true }
  const at = 1_000_000
  it('is still offered, as it was, while it’s away (most often updating)', () => {
    expect(remembered(null, { at, found: seen }, at + 5 * 60_000)).toEqual({ ...seen, away: true })
  })
  it('until it’s been quiet too long, or was never seen', () => {
    expect(remembered(null, { at, found: seen }, at + AWAY_MS)).toBeNull()
    expect(remembered(null, undefined, at)).toBeNull()
  })
  it('is what it says now once it answers again', () => {
    const back = { ...seen, outdated: undefined, version: '0.22.0' }
    expect(remembered(back, { at, found: seen }, at + 60_000)).toBe(back)
  })
})

describe('a built-in that isn’t answering', () => {
  const startedAt = 1_000_000
  it('is starting, with patience for a slow first start', () => {
    expect(quietState({ now: startedAt + 10_000, startedAt })).toBe('starting')
    expect(quietState({ now: startedAt + START_PATIENCE_MS - 1, startedAt })).toBe('starting')
    expect(quietState({ now: startedAt + START_PATIENCE_MS, startedAt })).toBe('unreachable')
  })

  it('after being up, is restarting for a while, then unreachable', () => {
    const lastUpAt = startedAt + START_PATIENCE_MS * 4
    expect(quietState({ now: lastUpAt + 5_000, startedAt, lastUpAt })).toBe('starting')
    expect(quietState({ now: lastUpAt + RESTART_PATIENCE_MS, startedAt, lastUpAt })).toBe('unreachable')
  })
})

describe('the built-in’s toolsets', () => {
  it('switch off what only Hermes Desktop can show, keeping the rest', () => {
    expect(withHiddenToolsets(null)).toEqual(['catalog', 'project'])
    expect(withHiddenToolsets('browser')).toEqual(['browser', 'catalog', 'project'])
    expect(withHiddenToolsets(['catalog', 'project'])).toBeNull()
  })
})
