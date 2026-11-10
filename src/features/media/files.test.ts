import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const device = { ios: false, standalone: false }
vi.mock('@/lib/device', () => ({
  get ios() {
    return device.ios
  },
  standalone: () => device.standalone,
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const { save, savesByShare } = await import('./files')

const ref = (path: string) => ({ path, profile: 'default' })
/** The download link the page would click: what it points at, and under which name. */
type Link = { href: string; download: string }
let clicked: Link[]
let share: ReturnType<typeof vi.fn>

beforeEach(() => {
  clicked = []
  share = vi.fn(async () => {})
  vi.stubGlobal('document', {
    createElement: () => {
      const a = { href: '', download: '', rel: '', remove: () => {}, click: () => void clicked.push({ href: a.href, download: a.download }) }
      return a
    },
    body: { append: () => {} },
  })
  vi.stubGlobal('navigator', { canShare: () => true, share })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:here')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Blob(['milk, eggs'], { type: 'text/markdown; charset=utf-8' }))),
  )
})
afterEach(() => {
  device.ios = device.standalone = false
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('saving a file', () => {
  it('downloads it in a browser, on an iPhone too', async () => {
    await save(ref('/a/list.md'))
    device.ios = true
    await save(ref('/a/list.md'))
    const link = { href: '/hermes/api/fs/download?path=%2Fa%2Flist.md&profile=default', download: 'list.md' }
    expect(clicked).toEqual([link, link])
    expect(share).not.toHaveBeenCalled()
  })

  it('downloads it from a Home Screen app that isn’t on an iPhone', async () => {
    device.standalone = true
    expect(savesByShare()).toBe(false)
    await save(ref('/a/list.md'))
    expect(clicked).toHaveLength(1)
  })

  it('hands it to the share sheet from an iPhone’s Home Screen, and never leaves the page', async () => {
    device.ios = device.standalone = true
    await save(ref('/b/list.md'), 'My list.md')
    expect(clicked).toEqual([])
    const [{ files }] = share.mock.calls[0] as [{ files: File[] }]
    expect([files[0].name, files[0].type, await files[0].text()]).toEqual(['My list.md', 'text/markdown', 'milk, eggs'])
  })

  it('stays put when iOS won’t open the sheet, with the file ready for the next tap', async () => {
    device.ios = device.standalone = true
    share.mockRejectedValueOnce(new DOMException('no gesture', 'NotAllowedError'))
    await save(ref('/c/list.md'))
    await save(ref('/c/list.md'))
    expect(clicked).toEqual([])
    expect(share).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('says a file is gone rather than opening the sheet', async () => {
    device.ios = device.standalone = true
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }))
    await expect(save(ref('/d/gone.md'))).rejects.toThrow('This file isn’t there anymore.')
    expect(share).not.toHaveBeenCalled()
  })
})
