import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import type { Agent } from './agents'

vi.mock('@/hermes/rest', () => ({ api: {} }))
vi.mock('@/hermes/compat', () => ({ listProfiles: vi.fn(), listProfileNames: vi.fn() }))
vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn(), gateway: {} }))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('./timezone', () => ({ ensureAgentTimezone: vi.fn(async () => '') }))
vi.mock('./toolsets', () => ({ hideDesktopToolsets: vi.fn(async () => {}) }))
vi.mock('./umbrel-context', () => ({ ensureUmbrelContext: vi.fn(async () => {}) }))
vi.mock('./umbrel-mcp', () => ({ ensureUmbrelMcp: vi.fn(async () => {}) }))
vi.mock('./mail', () => ({ forgetInheritedMail: vi.fn(async () => {}) }))

const { agentsKey, asTheyAre, createAgent, revealAgent, rosterQuery, saysGone } = await import('./agents')
const { rpc } = (await import('@/hermes/gateway')) as unknown as { rpc: ReturnType<typeof vi.fn> }
const { listProfiles } = (await import('@/hermes/compat')) as unknown as { listProfiles: ReturnType<typeof vi.fn> }

const agent = (id: string, more: Partial<Agent> = {}): Agent => ({ id, name: id, hue: 0, role: '', isDefault: false, ...more })

/** The roster as it was when the sheet opened: Hermes and Zed. */
function roster() {
  const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  qc.setQueryData<Agent[]>(agentsKey, [agent('default', { name: 'Hermes', isDefault: true }), agent('zed', { name: 'Zed' })])
  return qc
}

const names = (qc: QueryClient) => qc.getQueryData<Agent[]>(agentsKey)?.map((a) => a.name)

const make = () =>
  createAgent({ name: 'Coder', hue: 30, role: 'Writes code ', soul: '# Coder\n', template: 'coder' })

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ ok: true, applied: { ui_meta: true } })
  listProfiles.mockReset().mockResolvedValue([
    { name: 'default', is_default: true, model: 'gpt-5.5', provider: 'openai-codex' },
    { name: 'zed', is_default: false, model: 'qwen3', provider: 'ollama' },
  ])
})

describe('a new agent', () => {
  it('joins the roster the moment it is let in, as it was made, without waiting for Hermes to be read again', async () => {
    const qc = roster()
    // The roster on screen, and reading every agent from Hermes takes as long as Hermes likes.
    const read = vi.fn(() => new Promise<Agent[]>(() => {}))
    const off = new QueryObserver(qc, { queryKey: agentsKey, queryFn: read, staleTime: Infinity }).subscribe(() => {})
    const id = await make()
    expect(names(qc)).toEqual(['Hermes', 'Zed'])

    await revealAgent(qc, id)
    expect(names(qc)).toEqual(['Hermes', 'Coder', 'Zed'])
    // Hermes is still read again, to settle it as Hermes has it.
    expect(read).toHaveBeenCalledTimes(1)
    expect(qc.getQueryData<Agent[]>(agentsKey)?.find((a) => a.id === id)).toMatchObject({
      id: 'coder',
      name: 'Coder',
      hue: 30,
      role: 'Writes code',
      isDefault: false,
      template: 'coder',
      // Hermes gives a new agent the main agent's model.
      model: 'gpt-5.5',
      provider: 'openai-codex',
    })
    off()
  })

  it('is not taken out again by a read that began while it was being made', async () => {
    const qc = roster()
    const id = await make()
    // A read from before it existed, still on its way.
    let land!: (list: Agent[]) => void
    const before = qc
      .fetchQuery({ queryKey: agentsKey, queryFn: () => new Promise<Agent[]>((r) => (land = r)), staleTime: 0 })
      .catch(() => {})
    await revealAgent(qc, id)
    land([agent('default', { name: 'Hermes', isDefault: true }), agent('zed', { name: 'Zed' })])
    await before
    expect(names(qc)).toEqual(['Hermes', 'Coder', 'Zed'])
  })

  it('is let in once, however many times it is revealed', async () => {
    const qc = roster()
    const id = await make()
    await revealAgent(qc, id)
    await revealAgent(qc, id)
    expect(names(qc)).toEqual(['Hermes', 'Coder', 'Zed'])
  })

  it('stays out of the roster when Hermes could not make it', async () => {
    const qc = roster()
    rpc.mockImplementation(async (method: string) => {
      if (method === 'profiles.create') throw new Error('Hermes said no')
      return { ok: true }
    })
    await expect(make()).rejects.toThrow('Hermes said no')
    await revealAgent(qc, 'coder')
    expect(names(qc)).toEqual(['Hermes', 'Zed'])
  })
})

describe('the roster kept on this device', () => {
  let kept: Map<string, string>
  const KEY = 'murmur:roster'
  const keep = (...agents: Agent[]) => kept.set(KEY, JSON.stringify({ version: __MURMUR_VERSION__, agents }))
  const keptIds = () => (JSON.parse(kept.get(KEY)!) as { agents: Agent[] }).agents.map((a) => a.id)
  const open = () => new QueryObserver(new QueryClient(), rosterQuery)
  const hermes = agent('default', { name: 'Hermes', isDefault: true })

  beforeEach(() => {
    kept = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is shown at once on a later open, and Hermes is read all the same', async () => {
    keep(hermes)
    const observer = open()
    expect(observer.getCurrentResult()).toMatchObject({ isPending: false, data: [{ id: 'default' }] })

    const off = observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.map((a) => a.id)).toEqual(['default', 'zed']))
    expect(listProfiles).toHaveBeenCalled()
    expect(keptIds()).toEqual(['default', 'zed'])
    off()
  })

  it('leaves a first open waiting for Hermes, with nothing to show yet', () => {
    expect(open().getCurrentResult()).toMatchObject({ isPending: true, data: undefined })
  })

  it('is ignored when it can’t be read, or is empty', () => {
    kept.set(KEY, 'not json')
    expect(open().getCurrentResult().isPending).toBe(true)
    keep()
    expect(open().getCurrentResult().isPending).toBe(true)
  })

  it('is ignored when another version of Murmur kept it, as its agents may lack what this one needs', () => {
    kept.set(KEY, JSON.stringify({ version: '0.0.1', agents: [hermes] }))
    expect(open().getCurrentResult().isPending).toBe(true)
    // As the first kept rosters were, with no version at all.
    kept.set(KEY, JSON.stringify([hermes]))
    expect(open().getCurrentResult().isPending).toBe(true)
  })

  it('says no agent is gone, and names none to write to, till Hermes has answered', async () => {
    // Kept before Zed was made, and while Old was still there.
    keep(hermes, agent('old'))
    const observer = open()
    const before = observer.getCurrentResult()
    expect(saysGone(before, 'zed')).toBe(false)
    expect(asTheyAre(before)).toBeUndefined()

    const off = observer.subscribe(() => {})
    await vi.waitFor(() => expect(asTheyAre(observer.getCurrentResult())?.map((a) => a.id)).toEqual(['default', 'zed']))
    const after = observer.getCurrentResult()
    expect(saysGone(after, 'zed')).toBe(false)
    expect(saysGone(after, 'old')).toBe(true)
    off()
  })

  it('names the agents to write to once Hermes has answered, on a first open too', async () => {
    const observer = open()
    expect(asTheyAre(observer.getCurrentResult())).toBeUndefined()
    expect(saysGone(observer.getCurrentResult(), 'zed')).toBe(false)
    const off = observer.subscribe(() => {})
    await vi.waitFor(() => expect(asTheyAre(observer.getCurrentResult())?.map((a) => a.id)).toEqual(['default', 'zed']))
    off()
  })

  it('takes a change made before Hermes answers, so it still shows and lands (state/records.ts)', () => {
    keep(hermes, agent('zed', { name: 'Zed' }))
    const qc = new QueryClient()
    const observer = new QueryObserver(qc, rosterQuery)
    const off = observer.subscribe(() => {})
    qc.setQueryData<Agent[]>(agentsKey, (list) => list?.map((a) => (a.id === 'zed' ? { ...a, name: 'Zed 2' } : a)))
    expect(observer.getCurrentResult().data?.map((a) => a.name)).toEqual(['Hermes', 'Zed 2'])
    off()
  })
})
