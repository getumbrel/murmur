import { beforeEach, describe, expect, it, vi } from 'vitest'

// Two Hermes, as the server lists them with the page: "main" first, then "k3f9".
vi.stubGlobal('document', { cookie: 'murmur_servers=main.k3f9' })

function storage() {
  const store: Record<string, string> = {}
  Object.defineProperties(store, {
    getItem: { value: (key: string) => store[key] ?? null },
    setItem: { value: (key: string, value: string) => void (store[key] = value) },
    removeItem: { value: (key: string) => void delete store[key] },
  })
  return store
}
let kept = storage()
beforeEach(() => {
  kept = storage()
  vi.stubGlobal('localStorage', kept)
})

const instance = await import('./instance')
const { agentIdOn, byHermes, hermesIds, hermesOf, homeOf, hrefOn, isMain, mainFor, mainOn, noteHome, placeOf, profileOf, sameHermes, scoped } = instance
const { noteAnswer, routeCall, routePath } = await import('./route')
const { keptByAgent, keptByHome, keyForAgent, keyForChat } = await import('./kept')

describe('an agent’s id', () => {
  it('is its profile’s name on the first Hermes, and carries the Hermes on any other', () => {
    expect(hermesIds()).toEqual(['main', 'k3f9'])
    expect(agentIdOn('main', 'atlas')).toBe('atlas')
    expect(agentIdOn('k3f9', 'atlas')).toBe('k3f9~atlas')
    expect(agentIdOn(null, 'atlas')).toBe('atlas')
  })

  it('says where the agent lives and what Hermes calls it', () => {
    expect(placeOf('atlas')).toEqual({ hermes: 'main', profile: 'atlas' })
    expect(placeOf('k3f9~atlas')).toEqual({ hermes: 'k3f9', profile: 'atlas' })
    expect(hermesOf('k3f9~default')).toBe('k3f9')
    expect(profileOf('k3f9~default')).toBe('default')
    expect(sameHermes('atlas', 'scout')).toBe(true)
    expect(sameHermes('atlas', 'k3f9~atlas')).toBe(false)
  })

  it('leaves a name that only looks like another Hermes’s alone', () => {
    // No such Hermes here: the whole thing is a profile on the first.
    expect(placeOf('gone~atlas')).toEqual({ hermes: 'main', profile: 'gone~atlas' })
  })

  it('knows each Hermes’s main agent', () => {
    expect(mainOn('main')).toBe('default')
    expect(mainOn('k3f9')).toBe('k3f9~default')
    expect(mainFor('k3f9~atlas')).toBe('k3f9~default')
    expect(mainFor('atlas')).toBe('default')
    expect(isMain('k3f9~default')).toBe(true)
    expect(isMain('k3f9~atlas')).toBe(false)
  })

  it('sorts agents by where they live, in the order given', () => {
    expect([...byHermes(['atlas', 'k3f9~default', 'scout', 'k3f9~atlas'])]).toEqual([
      ['main', ['atlas', 'scout']],
      ['k3f9', ['k3f9~default', 'k3f9~atlas']],
    ])
  })
})

describe('a link as one Hermes writes it', () => {
  it('names the agent as it is here, and remembers where its chat came from', () => {
    expect(hrefOn('/chat/atlas/s_42', 'k3f9')).toBe('/chat/k3f9~atlas/s_42')
    expect(homeOf('s_42')).toBe('k3f9')
    expect(hrefOn('/chat/atlas/new', 'k3f9')).toBe('/chat/k3f9~atlas/new')
    expect(hrefOn('/agent/atlas', 'main')).toBe('/agent/atlas')
    expect(hrefOn('/group/r_7', 'k3f9')).toBe('/group/r_7')
    expect(homeOf('r_7')).toBe('k3f9')
    expect(hrefOn('/settings', 'k3f9')).toBe('/settings')
  })
})

describe('where a socket call goes', () => {
  it('goes to the Hermes of the agent it names, by the name that Hermes knows', () => {
    expect(routeCall('session.create', { profile: 'k3f9~atlas' })).toEqual({ hermes: 'k3f9', params: { profile: 'atlas' } })
    expect(routeCall('session.create', { profile: 'atlas' })).toEqual({ hermes: 'main', params: { profile: 'atlas' } })
    expect(routeCall('profiles.configure', { name: 'k3f9~default', ui_meta: {} })).toEqual({
      hermes: 'k3f9',
      params: { name: 'default', ui_meta: {} },
    })
  })

  it('leaves a name alone where it isn’t an agent’s', () => {
    expect(routeCall('room.rename', { room_id: 'r_1', name: 'k3f9~plans' }).params.name).toBe('k3f9~plans')
  })

  it('goes where a chat, live session or group came from', () => {
    noteHome('s_9', 'k3f9')
    noteHome('r_9', 'k3f9')
    expect(routeCall('prompt.submit', { session_id: 's_9', text: 'hi' }).hermes).toBe('k3f9')
    expect(routeCall('room.post', { room_id: 'r_9' }).hermes).toBe('k3f9')
    expect(routeCall('prompt.submit', { session_id: 'unknown' }).hermes).toBe('main')
  })

  it('takes a group’s members by the names their Hermes knows', () => {
    const { hermes, params } = routeCall('room.create', { members: [{ profile: 'k3f9~atlas' }, { profile: 'k3f9~default' }] })
    expect(hermes).toBe('k3f9')
    expect(params.members).toEqual([{ profile: 'atlas' }, { profile: 'default' }])
  })

  it('goes where the caller says, whatever it names', () => {
    expect(routeCall('reload.mcp', {}, 'k3f9').hermes).toBe('k3f9')
    expect(routeCall('session.create', { profile: 'atlas' }, 'k3f9').hermes).toBe('k3f9')
  })
})

describe('where a request goes', () => {
  it('reads the agent from the address', () => {
    expect(routePath('/api/config?profile=k3f9~atlas', undefined)).toEqual({ hermes: 'k3f9', path: '/api/config?profile=atlas', body: undefined })
    expect(routePath('/api/profiles/k3f9~atlas/soul', undefined)).toMatchObject({ hermes: 'k3f9', path: '/api/profiles/atlas/soul' })
    expect(routePath('/api/config?profile=atlas', undefined)).toMatchObject({ hermes: 'main', path: '/api/config?profile=atlas' })
  })

  it('reads the agent from what’s sent', () => {
    expect(routePath('/api/cron/jobs', { profile: 'k3f9~atlas', name: 'Morning' })).toEqual({
      hermes: 'k3f9',
      path: '/api/cron/jobs',
      body: { profile: 'atlas', name: 'Morning' },
    })
  })

  it('follows a chat to where it came from, and the caller’s word above all', () => {
    noteHome('s_77', 'k3f9')
    expect(routePath('/api/sessions/s_77/messages', undefined).hermes).toBe('k3f9')
    expect(routePath('/api/status', undefined).hermes).toBe('main')
    expect(routePath('/api/status', undefined, 'k3f9').hermes).toBe('k3f9')
  })
})

describe('what an answer says about where things came from', () => {
  it('remembers the chats, sessions and groups in it', () => {
    noteAnswer('k3f9', { sessions: [{ id: 's_a' }, { id: 's_b' }], session_id: 'live_1' })
    expect(homeOf('s_a')).toBe('k3f9')
    expect(homeOf('s_b')).toBe('k3f9')
    expect(homeOf('live_1')).toBe('k3f9')
  })
})

describe('what the browser keeps', () => {
  it('stays filed per Hermes under the names it always had', () => {
    expect(scoped('murmur:seen')).toBe('murmur:seen')
    expect(scoped('murmur:seen', 'main')).toBe('murmur:seen')
    expect(scoped('murmur:seen', 'k3f9')).toBe('murmur@k3f9:seen')
    expect(keyForAgent('murmur:draft:', 'k3f9~atlas', ':new')).toBe('murmur@k3f9:draft:atlas:new')
    expect(keyForAgent('murmur:draft:', 'atlas')).toBe('murmur:draft:atlas')
  })

  it('reads every Hermes’s agents as one record, and writes to the agent’s own', () => {
    kept['murmur:hues'] = JSON.stringify({ atlas: 200 })
    kept['murmur@k3f9:hues'] = JSON.stringify({ atlas: 28 })
    const hues = keptByAgent<number>('murmur:hues')
    expect(hues.all()).toEqual({ atlas: 200, 'k3f9~atlas': 28 })
    expect(hues.get('k3f9~atlas')).toBe(28)

    hues.set('k3f9~scout', 52)
    hues.set('atlas', undefined)
    expect(JSON.parse(kept['murmur@k3f9:hues'])).toEqual({ atlas: 28, scout: 52 })
    expect(JSON.parse(kept['murmur:hues'])).toEqual({})
  })

  it('keeps a chat’s things with the Hermes the chat came from', () => {
    noteHome('s_kept', 'k3f9')
    const seen = keptByHome<number>('murmur:seen')
    seen.set('s_kept', 3)
    seen.set('s_first', 1)
    expect(JSON.parse(kept['murmur@k3f9:seen'])).toEqual({ s_kept: 3 })
    expect(JSON.parse(kept['murmur:seen'])).toEqual({ s_first: 1 })
    expect(seen.all()).toEqual({ s_kept: 3, s_first: 1 })
    expect(keyForChat('murmur:scroll:', 's_kept')).toBe('murmur@k3f9:scroll:s_kept')
  })

  it('finds a chat’s thing wherever it’s kept, before its Hermes is known', () => {
    kept['murmur@k3f9:scroll:s_deep'] = '120'
    expect(keyForChat('murmur:scroll:', 's_deep')).toBe('murmur@k3f9:scroll:s_deep')
    expect(keyForChat('murmur:scroll:', 's_nowhere')).toBe('murmur:scroll:s_nowhere')
  })
})

describe('the list changing while the app is open', () => {
  it('takes a Hermes added or removed after the first, and tells whoever listens', () => {
    const heard = vi.fn()
    const stop = instance.onHermesIds(heard)
    expect(instance.setHermesIds(['main', 'k3f9', 'vps2'])).toBe(true)
    expect(hermesIds()).toEqual(['main', 'k3f9', 'vps2'])
    expect(heard).toHaveBeenCalledTimes(1)
    expect(instance.setHermesIds(['main', 'k3f9'])).toBe(true)
    // The same list again says nothing.
    expect(instance.setHermesIds(['main', 'k3f9'])).toBe(true)
    expect(heard).toHaveBeenCalledTimes(2)
    stop()
  })

  it('refuses a new first Hermes: every plain id would mean another agent', () => {
    expect(instance.setHermesIds(['k3f9', 'main'])).toBe(false)
    expect(hermesIds()).toEqual(['main', 'k3f9'])
  })
})
