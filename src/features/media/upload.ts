// Getting what you attach to Hermes. Photos go to the model as they are, made
// smaller first if Hermes would turn them away. Other files stream to Hermes's
// disk over HTTP, so their size and a slow connection only cost time: as one
// message on the chat's socket, a big file held the socket's heartbeat back
// until the connection was given up on.

import { listProfiles } from '@/hermes/compat'
import { api, HermesError, hermesHeaders, on } from '@/hermes/rest'
import { firstHermes, hermesOf } from '@/hermes/instance'

/** Pictures Hermes hands the model as they are. Anything else is a file. */
export const isPhoto = (f: File) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(f.type)

/** The most Hermes takes in one upload. */
export const MAX_UPLOAD = 100 * 1024 * 1024

/** The biggest photo Hermes takes. */
const MAX_PHOTO = 25 * 1024 * 1024
/** A photo past that comes down to this, on its long edge: more than any model looks at. */
const PHOTO_EDGE = 4096

/** A photo Hermes would turn away, made small enough for it; any other comes back as it is. */
export async function fitPhoto(file: File): Promise<File> {
  if (file.size <= MAX_PHOTO) return file
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`“${file.name}” couldn’t be opened. Try a smaller photo.`)
  })
  const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  // JPEG has no transparency: what was see-through comes out white, not black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.9))
  if (!blob) throw new Error(`“${file.name}” couldn’t be opened. Try a smaller photo.`)
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' })
}

/** Where Hermes keeps what's sent to an agent: the attachments folder in its home. */
export async function attachmentsDir(agent: string) {
  const home = (await listProfiles<{ name: string; is_default: boolean; path?: string }>({}, hermesOf(agent))).find(
    (p) => p.name === agent,
  )?.path
  if (!home) throw new Error('Hermes didn’t say where this agent keeps its files.')
  return `${home}/attachments`
}

/**
 * Put a file in `dir` on Hermes, under its own name or, when that's taken,
 * the next free one ("notes-2.txt", the way Hermes names them). Says how far
 * along it is, in hundredths. Returns where it landed. `hermes` is the one
 * `dir` is on (`hermesOf(agentId)`).
 */
export async function upload(
  file: File,
  dir: string,
  onProgress?: (done: number) => void,
  hermes: string | null = firstHermes(),
): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  form.append('path', `${dir}/${await freeName(dir, file.name || 'file', hermes)}`)
  form.append('overwrite', 'false')
  // XHR, not fetch: only XHR says how much has gone.
  const xhr = new XMLHttpRequest()
  xhr.open('POST', '/hermes/api/files/upload-stream')
  for (const [key, value] of Object.entries(hermesHeaders({}, hermes))) xhr.setRequestHeader(key, value)
  let shown = 0
  xhr.upload.onprogress = (e) => {
    const done = Math.floor((e.loaded / e.total) * 100) / 100
    if (done > shown) onProgress?.((shown = done))
  }
  const landed = await new Promise<{ path?: string }>((resolve, reject) => {
    xhr.onload = () => {
      const body = parse(xhr.responseText)
      if (xhr.status < 300) return resolve(body)
      const said = typeof body.detail === 'string' ? body.detail : `Hermes returned ${xhr.status}`
      reject(new HermesError(xhr.status, xhr.status === 413 ? 'That file is too large to send.' : said))
    }
    xhr.onerror = () => reject(new HermesError(0, 'Can’t reach Hermes. Check that it’s running.'))
    xhr.send(form)
  })
  if (!landed.path) throw new HermesError(502, 'Hermes didn’t say where the file went.')
  return landed.path
}

async function freeName(dir: string, name: string, hermes: string | null) {
  const listed = await api
    .get<{ entries: { name: string }[] }>(`/api/files?${new URLSearchParams({ path: dir })}`, on(hermes))
    .catch((e) => {
      // Not there yet: Hermes makes it with the first file.
      if (e instanceof HermesError && e.status === 404) return { entries: [] }
      throw e
    })
  const taken = new Set(listed.entries.map((e) => e.name))
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let free = name
  for (let n = 2; taken.has(free); n++) free = `${stem}-${n}${ext}`
  return free
}

function parse(text: string): { path?: string; detail?: unknown } {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
