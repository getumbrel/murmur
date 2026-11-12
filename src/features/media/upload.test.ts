import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class HermesError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
vi.mock('@/hermes/rest', () => ({
  api: { get: vi.fn() },
  hermesHeaders: () => ({ 'x-murmur-hermes': 'h1' }),
  on: () => undefined,
  HermesError,
}))
vi.mock('@/hermes/compat', () => ({ listProfiles: vi.fn() }))

const { attachmentsDir, fitPhoto, upload } = await import('./upload')
const { api } = (await import('@/hermes/rest')) as unknown as { api: { get: ReturnType<typeof vi.fn> } }
const { listProfiles } = (await import('@/hermes/compat')) as unknown as { listProfiles: ReturnType<typeof vi.fn> }

/** A stand-in for the browser's XHR: answers with `reply`, after reporting `steps` of progress. */
class FakeXhr {
  static made: FakeXhr[] = []
  static reply = { status: 200, body: '{}' }
  static steps: number[] = []
  url = ''
  headers: Record<string, string> = {}
  form?: FormData
  status = 0
  responseText = ''
  upload: { onprogress?: (e: { loaded: number; total: number }) => void } = {}
  onload?: () => void
  onerror?: () => void
  open(_method: string, url: string) {
    this.url = url
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }
  send(form: FormData) {
    this.form = form
    FakeXhr.made.push(this)
    queueMicrotask(() => {
      for (const loaded of FakeXhr.steps) this.upload.onprogress?.({ loaded, total: 100 })
      this.status = FakeXhr.reply.status
      this.responseText = FakeXhr.reply.body
      this.onload?.()
    })
  }
}

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name)

beforeEach(() => {
  FakeXhr.made = []
  FakeXhr.steps = []
  FakeXhr.reply = { status: 200, body: JSON.stringify({ path: '/opt/data/attachments/notes.txt' }) }
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  api.get.mockResolvedValue({ entries: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('upload', () => {
  it('streams the file to Hermes, for the Hermes it’s on, and says where it landed', async () => {
    expect(await upload(file('notes.txt'), '/opt/data/attachments')).toBe('/opt/data/attachments/notes.txt')
    const [xhr] = FakeXhr.made
    expect(xhr.url).toBe('/hermes/api/files/upload-stream')
    expect(xhr.headers).toEqual({ 'x-murmur-hermes': 'h1' })
    expect(xhr.form?.get('path')).toBe('/opt/data/attachments/notes.txt')
    expect(xhr.form?.get('overwrite')).toBe('false')
  })

  it('never lands on a file that’s there, taking the next free name the way Hermes does', async () => {
    api.get.mockResolvedValue({ entries: [{ name: 'notes.txt' }, { name: 'notes-2.txt' }, { name: 'README' }] })
    await upload(file('notes.txt'), '/d')
    await upload(file('README'), '/d')
    await upload(file('photo.final.png'), '/d')
    expect(FakeXhr.made.map((x) => x.form?.get('path'))).toEqual([
      '/d/notes-3.txt',
      '/d/README-2',
      '/d/photo.final.png',
    ])
    expect(api.get).toHaveBeenCalledWith('/api/files?path=%2Fd', undefined)
  })

  it('makes the folder with the first file', async () => {
    api.get.mockRejectedValue(new HermesError(404, 'Path not found'))
    await upload(file('notes.txt'), '/opt/data/profiles/scout/attachments')
    expect(FakeXhr.made[0].form?.get('path')).toBe('/opt/data/profiles/scout/attachments/notes.txt')
  })

  it('says how far along it is in hundredths, only when that moves', async () => {
    FakeXhr.steps = [0, 0.4, 12.5, 12.9, 60, 100]
    const seen: number[] = []
    await upload(file('notes.txt'), '/d', (done) => seen.push(done))
    expect(seen).toEqual([0.12, 0.6, 1])
  })

  it('tells a file too big for Hermes from one that couldn’t go', async () => {
    FakeXhr.reply = { status: 413, body: JSON.stringify({ detail: 'File is too large' }) }
    await expect(upload(file('big.mov'), '/d')).rejects.toThrow('That file is too large to send.')
    FakeXhr.reply = { status: 403, body: JSON.stringify({ detail: 'Path outside managed files root' }) }
    await expect(upload(file('notes.txt'), '/d')).rejects.toThrow('Path outside managed files root')
  })
})

describe('attachmentsDir', () => {
  it('is the attachments folder in the agent’s own home', async () => {
    listProfiles.mockResolvedValue([
      { name: 'default', is_default: true, path: '/opt/data' },
      { name: 'scout', is_default: false, path: '/opt/data/profiles/scout' },
    ])
    expect(await attachmentsDir('default')).toBe('/opt/data/attachments')
    expect(await attachmentsDir('scout')).toBe('/opt/data/profiles/scout/attachments')
    await expect(attachmentsDir('gone')).rejects.toThrow()
  })
})

describe('fitPhoto', () => {
  it('leaves a photo Hermes takes as it is', async () => {
    const photo = new File([new Uint8Array(1024)], 'teal.png', { type: 'image/png' })
    expect(await fitPhoto(photo)).toBe(photo)
  })
})
