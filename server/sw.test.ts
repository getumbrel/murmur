import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

// The service worker the server hands browsers (public/sw.js), run here against a stand-in for
// the browser: a cache store, a server that can be taken away, and the events
// a browser would send it.

const SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const SHELL = { version: 'v1', files: ['/assets/app.js', '/assets/app.css', '/icon.svg'] }
const ORIGIN = 'https://murmur.test'

type Served = Record<string, () => Response | Promise<Response>>

function browser({ shell = SHELL as typeof SHELL | null, patience = 3000 } = {}) {
  const stores = new Map<string, Map<string, Response>>()
  const path = (r: string | Request) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      match: async (r: string | Request) => store.get(path(r))?.clone(),
      put: async (r: string | Request, res: Response) => void store.set(path(r), res),
      keys: async () => [...store.keys()].map((p) => ({ url: ORIGIN + p })),
    }
  }
  const caches = {
    open: async (name: string) => open(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (r: string | Request) => {
      for (const store of stores.values()) if (store.has(path(r))) return store.get(path(r))!.clone()
    },
  }
  let served: Served = {}
  const asked: string[] = []
  const fetch = async (r: string | Request) => {
    asked.push(path(r))
    const answer = served[path(r)]
    if (!answer) throw new TypeError('Failed to fetch')
    const res = await answer()
    // What a browser says of a same-origin answer.
    Object.defineProperty(res, 'type', { value: 'basic' })
    return res
  }
  const listeners: Record<string, (event: any) => void> = {}
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: any) => void) => (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  }
  const source = SOURCE.replace('const SHELL = null', `const SHELL = ${JSON.stringify(shell)}`).replace(
    'const PATIENCE = 3000',
    `const PATIENCE = ${patience}`,
  )
  runInNewContext(source, { self, caches, fetch, URL, Response, Headers, Promise, setTimeout, Set, Error, console })

  const file = (body: string, type = 'text/javascript') => () => new Response(body, { headers: { 'content-type': type } })
  const server = (version = 'v1'): Served => ({
    '/index.html': file(`<html>${version}</html>`, 'text/html; charset=utf-8'),
    '/': file(`<html>${version}</html>`, 'text/html; charset=utf-8'),
    '/assets/app.js': file('js'),
    '/assets/app.css': file('css', 'text/css'),
    '/icon.svg': file('svg', 'image/svg+xml'),
  })
  /** Send an event and wait for everything it asked to be waited on. */
  const send = async (type: string, event: object = {}) => {
    const waits: Promise<unknown>[] = []
    let answer: Promise<Response> | undefined
    listeners[type]?.({ waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (r: Promise<Response>) => (answer = Promise.resolve(r)), ...event })
    await Promise.all(waits)
    return answer
  }
  const get = (url: string, mode = 'navigate') => send('fetch', { request: { url: ORIGIN + url, method: 'GET', mode } })
  return {
    stores,
    asked,
    serve: (next: Served) => (served = next),
    server,
    keep: () => send('message', { data: { type: 'murmur:keep' } }),
    get,
  }
}

describe('the service worker keeping the app', () => {
  it('keeps every file of the build, and the page last', async () => {
    const b = browser()
    b.serve(b.server())
    await b.keep()
    expect([...b.stores.get('murmur-app-v1')!.keys()].sort()).toEqual(['/assets/app.css', '/assets/app.js', '/icon.svg', '/index.html'])
    expect(b.asked.at(-1)).toBe('/index.html')
  })

  it('keeps no page until every file is in, and finishes the next time it’s asked', async () => {
    const b = browser()
    const { ['/assets/app.css']: _, ...partial } = b.server()
    b.serve(partial)
    await b.keep()
    expect(b.stores.get('murmur-app-v1')!.has('/index.html')).toBe(false)
    // Nothing kept whole: an unreachable server is the browser's to report, as before.
    b.serve({})
    await expect(b.get('/')).rejects.toThrow()

    b.serve(b.server())
    b.asked.length = 0
    await b.keep()
    expect(b.stores.get('murmur-app-v1')!.has('/index.html')).toBe(true)
    // Only what was missing is asked for again.
    expect(b.asked).toEqual(['/assets/app.css', '/index.html'])
  })

  it('never keeps a sign-in page it was sent to, or an error, in a file’s place', async () => {
    const b = browser()
    b.serve({
      ...b.server(),
      '/index.html': () => Object.defineProperty(new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html' } }), 'redirected', { value: true }),
    })
    await b.keep()
    expect(b.stores.get('murmur-app-v1')!.has('/index.html')).toBe(false)
  })

  it('opens the page from the server while it answers', async () => {
    const b = browser()
    b.serve(b.server())
    await b.keep()
    b.serve({ '/chat/default/abc': b.server('fresh')['/'] })
    const res = await b.get('/chat/default/abc')
    expect(await res!.text()).toBe('<html>fresh</html>')
    expect(res!.headers.get('server-timing')).toBeNull()
  })

  it('opens the kept page, marked, when the server can’t be reached', async () => {
    const b = browser()
    b.serve(b.server())
    await b.keep()
    b.serve({})
    const res = await b.get('/chat/default/abc')
    expect(await res!.text()).toBe('<html>v1</html>')
    expect(res!.headers.get('server-timing')).toBe('murmur-kept')
    expect(res!.headers.get('content-type')).toMatch(/text\/html/)
    // And what it's made of.
    expect(await (await b.get('/assets/app.js', 'no-cors'))!.text()).toBe('js')
  })

  it('opens the kept page when the server takes too long, or something in front of it says it’s away', async () => {
    const b = browser({ patience: 20 })
    b.serve(b.server())
    await b.keep()
    b.serve({ '/': () => new Promise<Response>(() => {}) })
    expect((await b.get('/'))!.headers.get('server-timing')).toBe('murmur-kept')
    b.serve({ '/': () => new Response('Bad gateway', { status: 502 }) })
    expect((await b.get('/'))!.headers.get('server-timing')).toBe('murmur-kept')
    // Any other answer is the server's own, and stands.
    b.serve({ '/': () => new Response('Not here', { status: 404 }) })
    expect((await b.get('/'))!.status).toBe(404)
  })

  it('lets go of the build before once the new one is whole, and not before', async () => {
    const old = browser()
    old.serve(old.server())
    await old.keep()
    const b = browser({ shell: { version: 'v2', files: SHELL.files } })
    for (const [name, store] of old.stores) b.stores.set(name, store)
    // The new build can't be fetched yet: the one before still opens.
    b.serve({})
    await b.keep()
    expect(await (await b.get('/'))!.text()).toBe('<html>v1</html>')
    b.serve(b.server('v2'))
    await b.keep()
    expect([...b.stores.keys()]).toEqual(['murmur-app-v2'])
    b.serve({})
    expect(await (await b.get('/'))!.text()).toBe('<html>v2</html>')
  })

  it('never answers for Hermes or Murmur’s server, or anything that isn’t a screen of the app', async () => {
    const b = browser()
    b.serve(b.server())
    await b.keep()
    b.serve({})
    for (const url of ['/hermes/api/sessions', '/murmur/session', '/murmur', '/sw.js', '/manifest.webmanifest']) {
      expect(await b.get(url), url).toBeUndefined()
    }
    expect(await b.get('/hermes/api/sessions', 'cors')).toBeUndefined()
    expect(await b.get('/assets/unknown.js', 'no-cors')).toBeUndefined()
  })

  it('touches nothing in development, where the build hasn’t written its files in', async () => {
    const b = browser({ shell: null })
    b.serve(b.server())
    await b.keep()
    expect(b.stores.size).toBe(0)
    expect(await b.get('/')).toBeUndefined()
  })
})
