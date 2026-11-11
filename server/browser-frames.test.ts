import http from 'node:http'
import net, { type AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useEnv } from './config.ts'
import {
  FRAME_BYTES,
  forgetHermes,
  framesOf,
  handleBrowserFrames,
  isJpeg,
  keepFrame,
  makeRoom,
  readFrame,
  safeId,
} from './browser-frames.ts'

/** A JPEG as far as its first and last bytes go, `size` bytes long. */
const jpeg = (size = 64, fill = 7) => {
  const body = Buffer.alloc(size, fill)
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(body)
  Buffer.from([0xff, 0xd9]).copy(body, size - 2)
  return body
}

let dir: string
const frames = () => join(dir, 'browser-frames')

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'murmur-browser-frames-'))
  useEnv({ DATA_DIR: dir })
})
beforeEach(() => rmSync(frames(), { recursive: true, force: true }))
afterAll(() => {
  useEnv(process.env)
  rmSync(dir, { recursive: true, force: true })
})

describe('what counts as a picture, and as a name for one', () => {
  it('is a whole JPEG by its bytes, whatever it says it is', () => {
    expect(isJpeg(jpeg())).toBe(true)
    expect(isJpeg(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))).toBe(false)
    expect(isJpeg(Buffer.from('<svg onload="alert(1)"/>'))).toBe(false)
    expect(isJpeg(jpeg().subarray(0, 40))).toBe(false)
    expect(isJpeg(Buffer.alloc(0))).toBe(false)
  })

  it('takes ids Hermes makes, and nothing that could leave its folder', () => {
    for (const id of ['20261111_154820_a1b2c3', 'call_9Xk2', 'toolu_01AbC-dEf', 'h_1f3a9c']) expect(safeId(id)).toBe(id)
    for (const id of ['', '.', '..', '../murmur', 'a/b', 'a\\b', 'a.jpg', 'a b', 'a%2fb', 'x'.repeat(97), 7, null]) {
      expect(safeId(id)).toBeNull()
    }
  })
})

describe('keeping pictures', () => {
  it('keeps one per step, the newest in place of the one before, for Murmur alone to read', () => {
    keepFrame('main', 'chat1', 'call_1', jpeg(64, 1))
    keepFrame('main', 'chat1', 'call_1', jpeg(80, 2))
    keepFrame('main', 'chat1', 'call_2', jpeg(64, 3))
    expect(readFrame('main', 'chat1', 'call_1')?.equals(jpeg(80, 2))).toBe(true)
    expect(framesOf('main', 'chat1').sort()).toEqual(['call_1', 'call_2'])
    expect(readdirSync(join(frames(), 'main', 'chat1')).sort()).toEqual(['call_1.jpg', 'call_2.jpg'])
    if (process.platform !== 'win32') {
      expect(statSync(join(frames(), 'main', 'chat1', 'call_1.jpg')).mode & 0o777).toBe(0o600)
      expect(statSync(join(frames(), 'main', 'chat1')).mode & 0o777).toBe(0o700)
    }
  })

  it('keeps each Hermes’s apart, and forgets one’s with it', () => {
    keepFrame('main', 'chat1', 'call_1', jpeg(64, 1))
    keepFrame('vps', 'chat1', 'call_1', jpeg(64, 2))
    expect(readFrame('vps', 'chat1', 'call_1')?.equals(jpeg(64, 2))).toBe(true)
    forgetHermes('main')
    expect(readFrame('main', 'chat1', 'call_1')).toBeNull()
    expect(readFrame('vps', 'chat1', 'call_1')?.equals(jpeg(64, 2))).toBe(true)
    forgetHermes('../vps')
    expect(framesOf('vps', 'chat1')).toEqual(['call_1'])
  })

  it('makes room when there’s too much, the oldest first', () => {
    const at = (step: string, minutesAgo: number) => {
      const when = new Date(Date.now() - minutesAgo * 60_000)
      utimesSync(join(frames(), 'main', step === 'old' ? 'chatA' : 'chatB', `${step}.jpg`), when, when)
    }
    keepFrame('main', 'chatA', 'old', jpeg(1000))
    keepFrame('main', 'chatB', 'mid', jpeg(1000))
    keepFrame('main', 'chatB', 'new', jpeg(1000))
    at('old', 30)
    at('mid', 20)
    at('new', 10)
    expect(makeRoom(5000)).toBe(0)
    // 3000 bytes kept and room for 2000: down to 90% of that, so two go.
    expect(makeRoom(2000)).toBe(2)
    expect(framesOf('main', 'chatB')).toEqual(['new'])
    // An emptied chat leaves no folder behind.
    expect(existsSync(join(frames(), 'main', 'chatA'))).toBe(false)
  })

  it('makes room as a picture arrives', () => {
    keepFrame('main', 'chat1', 'call_1', jpeg(1000), 2500)
    const before = new Date(Date.now() - 60_000)
    utimesSync(join(frames(), 'main', 'chat1', 'call_1.jpg'), before, before)
    keepFrame('main', 'chat1', 'call_2', jpeg(1000), 2500)
    keepFrame('main', 'chat2', 'call_3', jpeg(1000), 2500)
    expect(framesOf('main', 'chat1')).toEqual(['call_2'])
    expect(framesOf('main', 'chat2')).toEqual(['call_3'])
  })
})

describe('/murmur/browser-frames', () => {
  let server: http.Server
  let base: string
  let hermes: string | null = 'main'

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      if (!(await handleBrowserFrames(req, res, url, hermes))) res.writeHead(418).end()
    })
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/murmur/browser-frames`
  })
  beforeEach(() => void (hermes = 'main'))
  afterAll(() => new Promise((done) => server.close(done)))

  const put = (path: string, body: Buffer, type = 'image/jpeg') =>
    fetch(`${base}/${path}`, { method: 'PUT', headers: { 'content-type': type }, body })

  it('keeps a picture and serves it back as an image that can’t run anything', async () => {
    expect((await put('chat1/call_1', jpeg(200))).status).toBe(200)
    const res = await fetch(`${base}/chat1/call_1`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'")
    expect(Buffer.from(await res.arrayBuffer()).equals(jpeg(200))).toBe(true)
  })

  it('lists a chat’s pictures, and says there’s none for a step without one', async () => {
    await put('chat1/call_1', jpeg())
    await put('chat1/call_2', jpeg())
    expect(((await (await fetch(`${base}/chat1`)).json()) as { frames: string[] }).frames.sort()).toEqual(['call_1', 'call_2'])
    expect(await (await fetch(`${base}/chat2`)).json()).toEqual({ frames: [] })
    expect((await fetch(`${base}/chat1/call_3`)).status).toBe(404)
  })

  it('answers for the Hermes the request is for, and no other', async () => {
    await put('chat1/call_1', jpeg())
    hermes = 'vps'
    expect((await fetch(`${base}/chat1/call_1`)).status).toBe(404)
    expect(await (await fetch(`${base}/chat1`)).json()).toEqual({ frames: [] })
    hermes = null
    expect((await fetch(`${base}/chat1/call_1`)).status).toBe(409)
  })

  it('takes only a JPEG, and only one the size of a page', async () => {
    expect((await put('chat1/call_1', jpeg(), 'image/png')).status).toBe(415)
    expect((await put('chat1/call_1', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).status).toBe(415)
    expect((await put('chat1/call_1', Buffer.from('<html><script>alert(1)</script>'), 'text/html')).status).toBe(415)
    expect((await put('chat1/call_1', jpeg(FRAME_BYTES + 1))).status).toBe(413)
    expect((await put('chat1/call_1', jpeg(FRAME_BYTES))).status).toBe(200)
    expect(framesOf('main', 'chat1')).toEqual(['call_1'])
  })

  it('says one is too large without hanging up while it’s still being sent', async () => {
    // Windows loses the answer when the line drops mid-send. Anywhere, the
    // same line takes the next request once the refused picture is in.
    const socket = net.connect((server.address() as AddressInfo).port, '127.0.0.1')
    let heard = ''
    socket.on('data', (chunk) => void (heard += chunk.toString('latin1')))
    socket.on('error', () => {})
    socket.write(
      `PUT /murmur/browser-frames/chat1/call_1 HTTP/1.1\r\nhost: x\r\ncontent-type: image/jpeg\r\ncontent-length: ${FRAME_BYTES + 1}\r\n\r\n`,
    )
    socket.write(jpeg(FRAME_BYTES + 1))
    socket.write('GET /murmur/browser-frames/chat1 HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n')
    await new Promise((closed) => socket.on('close', closed))
    expect(heard.match(/^HTTP\/1\.1 \d+/gm)).toEqual(['HTTP/1.1 413', 'HTTP/1.1 200'])
  })

  it('refuses a name that could reach outside its folder', async () => {
    for (const path of ['..%2f..%2fmurmur/call_1', 'chat1/..%2fcall_1', 'chat1/call_1.jpg', 'chat1/call_1/more', 'chat1/']) {
      expect((await put(path, jpeg())).status, path).toBe(400)
      expect((await fetch(`${base}/${path}`)).status, path).toBe(400)
    }
    expect(existsSync(frames())).toBe(false)
    expect(readdirSync(dir)).not.toContain('murmur')
  })

  it('forgets a chat’s pictures with the chat, and leaves the others', async () => {
    await put('chat1/call_1', jpeg())
    await put('chat2/call_2', jpeg())
    expect((await fetch(`${base}/chat1`, { method: 'DELETE' })).status).toBe(200)
    expect((await fetch(`${base}/chat1/call_1`)).status).toBe(404)
    expect((await fetch(`${base}/chat2/call_2`)).status).toBe(200)
    expect(existsSync(join(frames(), 'main', 'chat1'))).toBe(false)
  })

  it('leaves everything else to the rest of the server', async () => {
    expect((await fetch(`${base}-other/chat1`)).status).toBe(418)
    expect((await fetch(`${base}/chat1`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/chat1/call_1`, { method: 'DELETE' })).status).toBe(405)
  })
})
