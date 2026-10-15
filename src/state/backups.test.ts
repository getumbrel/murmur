import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hermes/rest', () => ({ api: {}, hermesHeaders: () => ({}), HermesError: class extends Error {} }))
vi.mock('@/hermes/compat', () => ({ listProfileNames: vi.fn(), listProfiles: vi.fn() }))
vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn(), gateway: {} }))
vi.mock('@/hermes/instance', () => ({ scoped: (key: string) => key }))
vi.mock('./timezone', () => ({ ensureAgentTimezone: vi.fn(() => Promise.resolve()) }))
vi.mock('./toolsets', () => ({ hideDesktopToolsets: vi.fn(() => Promise.resolve()) }))
vi.mock('./umbrel-context', () => ({ ensureUmbrelContext: vi.fn(() => Promise.resolve()) }))
vi.mock('./umbrel-mcp', () => ({ ensureUmbrelMcp: vi.fn(() => Promise.resolve()) }))
vi.mock('./agents', async () => {
  // The real slugs: an import must never take a name Hermes refuses or one that's taken.
  const { slugFor } = await vi.importActual<{ slugFor: (n: string, t: Iterable<string>) => string }>('./agents')
  return { slugFor, updateAgent: vi.fn() }
})

const { exportAgent, freeName, importAgent, importId } = await import('./backups')
const { api } = (await import('@/hermes/rest')) as unknown as { api: Record<string, unknown> }
const { listProfileNames } = (await import('@/hermes/compat')) as unknown as {
  listProfileNames: ReturnType<typeof vi.fn>
}
const { updateAgent } = (await import('./agents')) as unknown as { updateAgent: ReturnType<typeof vi.fn> }
const { hideDesktopToolsets } = (await import('./toolsets')) as unknown as {
  hideDesktopToolsets: ReturnType<typeof vi.fn>
}

describe('backups', () => {
  it('takes a new agent’s id from the file it came in', () => {
    expect(importId('scout-agent-2026-10-05.tar.gz', [])).toBe('scout')
    // Hermes's own export name, and a browser's " (1)" for a second download.
    expect(importId('scout-20261015-090405.tar.gz', [])).toBe('scout')
    expect(importId('scout-agent-2026-10-05 (1).tar.gz', [])).toBe('scout')
    expect(importId('My Research Bot.tgz', [])).toBe('my-research-bot')
  })

  it('never lands on an agent that’s already here, or on the main agent', () => {
    expect(importId('scout-agent-2026-10-05.tar.gz', ['default', 'scout'])).toBe('scout-2')
    expect(importId('default-agent-2026-10-05.tar.gz', ['default'])).toBe('hermes-2')
  })

  it('gives a second Scout its own name', () => {
    expect(freeName('Scout', ['Hermes'])).toBe('Scout')
    expect(freeName('Scout', ['Hermes', 'scout'])).toBe('Scout 2')
    expect(freeName('Scout', ['Scout', 'Scout 2'])).toBe('Scout 3')
  })

})

// Hermes's routes (hermes_cli/web_routers/profiles.py, files.py, ops.py), as fakes.
const calls: string[] = []
const routes: Record<string, (body?: unknown) => unknown> = {}
const call = (method: string) => async (path: string, body?: unknown) => {
  calls.push(`${method} ${path}`)
  const handler = routes[`${method} ${path.split('?')[0]}`]
  if (!handler) throw new Error(`no route: ${method} ${path}`)
  return handler(body)
}
/** Files the browser was told to save. */
const saved: string[] = []

beforeEach(() => {
  calls.length = 0
  saved.length = 0
  for (const key of Object.keys(routes)) delete routes[key]
  Object.assign(api, { get: call('GET'), post: call('POST'), delete: call('DELETE') })
  vi.stubGlobal('document', {
    body: { append: () => {} },
    createElement: () => {
      const a = { href: '', click: () => saved.push(a.href), remove: () => {} }
      return a
    },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('exporting an agent', () => {
  it('packs its look in with it, and downloads through Murmur’s relay', async () => {
    let body: unknown
    routes['POST /api/profiles/scout/export'] = (b) => ((body = b), { archive: '/opt/data/exports/scout-1.tar.gz' })
    await exportAgent({ id: 'scout', name: 'Scout', hue: 210, role: 'Finds things', isDefault: false } as never)
    expect(body).toEqual({
      extra_files: { 'murmur.json': JSON.stringify({ name: 'Scout', hue: 210, role: 'Finds things' }) },
    })
    expect(saved).toEqual(['/hermes/api/fs/download?path=%2Fopt%2Fdata%2Fexports%2Fscout-1.tar.gz'])
  })
})

describe('importing an agent', () => {
  const file = (name: string) => new File(['x'], name)
  const upload = (status = 200) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: status < 300,
        status,
        json: async () => ({ path: '/opt/data/murmur-imports/scout.tar.gz' }),
      })),
    )

  beforeEach(() => {
    listProfileNames.mockResolvedValue(['default'])
    updateAgent.mockReset().mockResolvedValue(undefined)
    routes['GET /api/files'] = () => ({ path: '/opt/data' })
    routes['DELETE /api/files'] = () => ({ ok: true })
  })

  it('turns away a file that isn’t an export', async () => {
    await expect(importAgent(file('notes.zip'), [])).rejects.toThrow(/\.tar\.gz/)
    expect(calls).toEqual([])
  })

  it('brings it in as a new agent with its look back, and tidies the upload away', async () => {
    upload()
    let imported: unknown
    routes['POST /api/profiles/import'] = (b) => ((imported = b), { path: '/opt/data/profiles/scout' })
    routes['GET /api/fs/read-text'] = () => ({
      text: JSON.stringify({ name: 'Scout', hue: 210, role: 'Finds things' }),
    })
    const id = await importAgent(file('scout-20261015-092731.tar.gz'), ['Hermes', 'Scout'])
    expect(id).toBe('scout')
    expect(imported).toEqual({ archive: '/opt/data/murmur-imports/scout.tar.gz', name: 'scout' })
    expect(calls).toContain('DELETE /api/files')
    expect(updateAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'scout' }), {
      name: 'Scout 2',
      hue: 210,
      role: 'Finds things',
      template: undefined,
    })
    // Settled in like any new agent.
    expect(hideDesktopToolsets).toHaveBeenCalledWith('scout')
  })

  it('leaves the name alone for an export from somewhere else', async () => {
    upload()
    routes['POST /api/profiles/import'] = () => ({ path: '/opt/data/profiles/scout' })
    routes['GET /api/fs/read-text'] = () => {
      throw new Error('not found')
    }
    expect(await importAgent(file('scout.tgz'), [])).toBe('scout')
    expect(updateAgent).not.toHaveBeenCalled()
  })

  it('says when the file is too big for Hermes', async () => {
    upload(413)
    await expect(importAgent(file('scout.tar.gz'), [])).rejects.toThrow('That file is too big for Hermes to take.')
  })
})
