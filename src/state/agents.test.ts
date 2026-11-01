import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const { agentsKey, createAgent, revealAgent } = await import('./agents')
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
