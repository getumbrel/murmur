import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hermes's MCP routes (hermes_cli/web_routers/mcp.py, 0.22), as fakes.
class HermesError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const calls: string[] = []
const routes: Record<string, (body?: unknown) => unknown> = {}
const call = (method: string) => async (path: string, body?: unknown) => {
  const route = `${method} ${path.split('?')[0]}`
  calls.push(route)
  const handler = routes[route]
  if (!handler) throw new HermesError(404, 'not found')
  return handler(body)
}
vi.mock('@/hermes/rest', () => ({
  HermesError,
  api: { get: call('GET'), post: call('POST'), put: call('PUT'), delete: call('DELETE') },
}))
vi.mock('@/hermes/gateway', () => ({ rpc: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/desktop', () => ({ isDesktop: false }))

const apps = await import('./apps')
const {
  arrange,
  cancelConnect,
  connectApp,
  friendlyError,
  healthOf,
  removeApp,
  returnUrl,
  setAppEnabled,
  useConnections,
} = apps

const qc = { invalidateQueries: vi.fn(() => Promise.resolve()) } as never
const notion = {
  name: 'notion',
  description: 'Pages',
  auth_type: 'oauth',
  required_env: [],
  url: 'https://mcp.notion.com/mcp',
  needs_install: false,
}
const deepwiki = { ...notion, name: 'deepwiki', auth_type: 'none', url: 'https://mcp.deepwiki.com/mcp' }
const connection = (app: string) => useConnections.getState()[`atlas\n${app}`]

beforeEach(() => {
  calls.length = 0
  for (const key of Object.keys(routes)) delete routes[key]
  useConnections.setState({}, true)
  vi.stubGlobal('location', { origin: 'https://murmur.example', protocol: 'https:', hostname: 'murmur.example' })
  vi.stubGlobal('window', { open: vi.fn(() => ({ opener: {}, closed: false, location: { replace: vi.fn() } })) })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the catalog', () => {
  it('leads with everyday apps in order, then developer tools by name, and leaves out ones that can’t sign in', () => {
    const entries = ['sentry', 'dropbox', 'linear', 'notion', 'airtable', 'strava', 'context7'].map((name) => ({
      ...notion,
      name,
    }))
    const { everyday, developer } = arrange(entries, (n) => n)
    expect(everyday.map((a) => a.name)).toEqual(['notion', 'linear', 'airtable'])
    expect(developer.map((a) => a.name)).toEqual(['context7', 'sentry'])
  })
})

describe('an app’s health', () => {
  it('is fine when Hermes reached it', () => expect(healthOf({ auth: 'oauth' }, { ok: true })).toBe('ok'))
  it('needs a sign-in when its keys are missing or turned down', () => {
    expect(healthOf({ auth: 'oauth' }, { ok: false, error: 'OAuth authentication required — no token found.' })).toBe(
      'signin',
    )
    expect(healthOf({ auth: 'oauth' }, { ok: false, error: 'Registration failed: 400 invalid_redirect_uri' })).toBe(
      'signin',
    )
  })
  it('is down otherwise', () =>
    expect(healthOf({ auth: null }, { ok: false, error: 'Connection refused' })).toBe('down'))
})

describe('what went wrong', () => {
  it('says so plainly', () => {
    expect(friendlyError('Strava', "'strava' only allows pre-approved OAuth clients", true)).toMatch(
      /doesn’t let Hermes/,
    )
    expect(friendlyError('Notion', 'Redirect URI must use HTTPS unless it is a loopback HTTP URI', false)).toMatch(
      /over https/,
    )
    expect(friendlyError('Notion', 'invalid_redirect_uri', true)).toMatch(/Murmur’s address/)
    expect(friendlyError('Notion', 'expired', true)).toMatch(/too long/)
    expect(friendlyError('Notion', 'boom', true)).toBe('Couldn’t connect Notion. Try again in a moment.')
  })
})

describe('connecting an app', () => {
  it('sends the sign-in back through Murmur', () => {
    expect(returnUrl('http://umbrel.local:3200', 'wordpress-com')).toBe(
      'http://umbrel.local:3200/hermes/api/mcp/oauth/callback/wordpress-com',
    )
  })

  it('adds one that needs no sign-in and is done', async () => {
    routes['POST /api/mcp/catalog/install'] = () => ({ ok: true })
    await connectApp(qc, 'atlas', deepwiki, { name: 'DeepWiki', added: false })
    expect(calls).toEqual(['POST /api/mcp/catalog/install'])
    expect(connection('deepwiki')).toMatchObject({ phase: 'done', added: true })
  })

  it('points the sign-in at Murmur, opens it, and waits for Hermes to save the keys', async () => {
    vi.useFakeTimers()
    let config: unknown
    let status = 'authorization_required'
    routes['POST /api/mcp/catalog/install'] = () => ({ ok: true })
    routes['PUT /api/config'] = (body) => ((config = body), { ok: true })
    routes['POST /api/mcp/servers/notion/auth'] = () => ({
      flow_id: 'f1',
      status,
      authorization_url: 'https://notion/authorize',
    })
    routes['GET /api/mcp/oauth/flows/f1'] = () => ({ flow_id: 'f1', status })
    const tab = { opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() }

    await connectApp(qc, 'atlas', notion, { name: 'Notion', tab: tab as never, added: false })
    expect(config).toEqual({
      config: {
        mcp_servers: {
          notion: { oauth: { redirect_uri: 'https://murmur.example/hermes/api/mcp/oauth/callback/notion' } },
        },
      },
      profile: 'atlas',
    })
    expect(tab.location.replace).toHaveBeenCalledWith('https://notion/authorize')
    expect(connection('notion')).toMatchObject({ phase: 'signing-in', flowId: 'f1' })

    await vi.advanceTimersByTimeAsync(1600)
    expect(connection('notion').phase).toBe('signing-in')
    status = 'approved'
    await vi.advanceTimersByTimeAsync(1600)
    expect(connection('notion').phase).toBe('done')
  })

  it('asks for a tap when the browser blocks the tab', async () => {
    routes['POST /api/mcp/catalog/install'] = () => ({ ok: true })
    routes['PUT /api/config'] = () => ({ ok: true })
    routes['POST /api/mcp/servers/notion/auth'] = () => ({
      flow_id: 'f2',
      status: 'authorization_required',
      authorization_url: 'https://notion/authorize',
    })
    vi.stubGlobal('window', { open: vi.fn(() => null) })
    await connectApp(qc, 'atlas', notion, { name: 'Notion', added: false })
    expect(connection('notion')).toMatchObject({ phase: 'blocked', url: 'https://notion/authorize' })
    await cancelConnect(qc, 'atlas', 'notion')
  })

  it('takes the app away again when its sign-in can’t start', async () => {
    routes['POST /api/mcp/catalog/install'] = () => ({ ok: true })
    routes['PUT /api/config'] = () => ({ ok: true })
    routes['POST /api/mcp/servers/notion/auth'] = () => ({
      flow_id: 'f3',
      status: 'error',
      error: "'notion' only allows pre-approved OAuth clients",
    })
    routes['DELETE /api/mcp/servers/notion'] = () => ({ ok: true })
    await connectApp(qc, 'atlas', notion, { name: 'Notion', added: false })
    expect(calls).toContain('DELETE /api/mcp/servers/notion')
    expect(connection('notion')).toMatchObject({
      phase: 'failed',
      message: 'Notion doesn’t let Hermes sign in to it yet.',
    })
  })

  it('keeps an app it already had when signing in again fails', async () => {
    routes['PUT /api/config'] = () => ({ ok: true })
    routes['POST /api/mcp/servers/notion/auth'] = () => ({ flow_id: 'f4', status: 'error', error: 'boom' })
    await connectApp(qc, 'atlas', notion, { name: 'Notion', added: true })
    expect(calls).not.toContain('POST /api/mcp/catalog/install')
    expect(calls).not.toContain('DELETE /api/mcp/servers/notion')
    expect(connection('notion').phase).toBe('failed')
  })

  it('waits out a sign-in that was just cancelled', async () => {
    vi.useFakeTimers()
    let tries = 0
    routes['PUT /api/config'] = () => ({ ok: true })
    routes['POST /api/mcp/servers/notion/auth'] = () => {
      if (++tries < 3) throw new HermesError(409, "MCP OAuth for 'notion' is already in progress")
      return { flow_id: 'f5', status: 'authorization_required', authorization_url: 'https://notion/authorize' }
    }
    const done = connectApp(qc, 'atlas', notion, { name: 'Notion', added: true })
    await vi.advanceTimersByTimeAsync(2500)
    await done
    expect(tries).toBe(3)
    expect(connection('notion').phase).toBe('signing-in')
    await cancelConnect(qc, 'atlas', 'notion')
  })

  it('lets go of a sign-in left open before starting another', async () => {
    useConnections.setState({ 'atlas\nnotion': { phase: 'signing-in', flowId: 'old' } })
    routes['DELETE /api/mcp/oauth/flows/old'] = () => ({ ok: true })
    routes['PUT /api/config'] = () => ({ ok: true })
    routes['POST /api/mcp/servers/notion/auth'] = () => ({ flow_id: 'f7', status: 'error', error: 'boom' })
    await connectApp(qc, 'atlas', notion, { name: 'Notion', added: true })
    expect(calls[0]).toBe('DELETE /api/mcp/oauth/flows/old')
  })

  it('cancelling stops the sign-in and takes away what it added', async () => {
    routes['POST /api/mcp/catalog/install'] = () => ({ ok: true })
    routes['PUT /api/config'] = () => ({ ok: true })
    routes['POST /api/mcp/servers/notion/auth'] = () => ({
      flow_id: 'f6',
      status: 'authorization_required',
      authorization_url: 'https://notion/authorize',
    })
    routes['DELETE /api/mcp/oauth/flows/f6'] = () => ({ ok: true })
    routes['DELETE /api/mcp/servers/notion'] = () => ({ ok: true })
    await connectApp(qc, 'atlas', notion, { name: 'Notion', added: false })
    await cancelConnect(qc, 'atlas', 'notion')
    expect(calls.slice(-2)).toEqual(['DELETE /api/mcp/oauth/flows/f6', 'DELETE /api/mcp/servers/notion'])
    expect(connection('notion')).toBeUndefined()
  })
})

describe('a sign-in that doesn’t finish', () => {
  const signIn = (flow: () => unknown) => {
    routes['POST /api/mcp/catalog/install'] = () => ({ ok: true })
    routes['PUT /api/config'] = () => ({ ok: true })
    routes['POST /api/mcp/servers/notion/auth'] = () => ({
      flow_id: 'f8',
      status: 'authorization_required',
      authorization_url: 'https://notion/authorize',
    })
    routes['GET /api/mcp/oauth/flows/f8'] = flow
    routes['DELETE /api/mcp/servers/notion'] = () => ({ ok: true })
  }

  it('turned down in the other tab, takes away the app it added', async () => {
    vi.useFakeTimers()
    signIn(() => ({ flow_id: 'f8', status: 'error', error: 'access_denied' }))
    await connectApp(qc, 'atlas', notion, { name: 'Notion', added: false })
    await vi.advanceTimersByTimeAsync(1600)
    expect(calls).toContain('DELETE /api/mcp/servers/notion')
    expect(connection('notion')).toMatchObject({ phase: 'failed', message: expect.stringMatching(/^Couldn’t connect/) })
  })

  it('forgotten by Hermes, says it took too long', async () => {
    vi.useFakeTimers()
    signIn(() => {
      throw new HermesError(404, 'flow not found')
    })
    await connectApp(qc, 'atlas', notion, { name: 'Notion', added: false })
    await vi.advanceTimersByTimeAsync(1600)
    expect(connection('notion')).toMatchObject({ phase: 'failed', message: 'The sign-in took too long. Try again.' })
  })

  it('left open for six minutes, is let go', async () => {
    vi.useFakeTimers()
    signIn(() => ({ flow_id: 'f8', status: 'authorization_required' }))
    routes['DELETE /api/mcp/oauth/flows/f8'] = () => ({ ok: true })
    await connectApp(qc, 'atlas', notion, { name: 'Notion', added: false })
    await vi.advanceTimersByTimeAsync(6 * 60_000 + 2000)
    expect(calls).toContain('DELETE /api/mcp/oauth/flows/f8')
    expect(connection('notion').phase).toBe('failed')
  })
})

describe('managing an app', () => {
  const cached = () => {
    let list: unknown = [
      { name: 'notion', enabled: true },
      { name: 'linear', enabled: true },
    ]
    const client = {
      setQueryData: (_: unknown, fn: (old: unknown) => unknown) => void (list = fn(list)),
      invalidateQueries: vi.fn(() => Promise.resolve()),
    }
    return { list: () => list, qc: client as never }
  }

  it('switches it off at once', async () => {
    routes['PUT /api/mcp/servers/notion/enabled'] = () => ({ ok: true })
    const { list, qc } = cached()
    await setAppEnabled(qc, 'atlas', 'notion', false)
    expect(list()).toEqual([
      { name: 'notion', enabled: false },
      { name: 'linear', enabled: true },
    ])
  })

  it('takes it away at once, also when Hermes had already let it go', async () => {
    const { list, qc } = cached()
    await removeApp(qc, 'atlas', 'notion')
    expect(calls).toEqual(['DELETE /api/mcp/servers/notion'])
    expect(list()).toEqual([{ name: 'linear', enabled: true }])
  })
})
