// Files that live on the Hermes host, reached through the Murmur proxy.
//
// Agents deliver files by path (MEDIA:/abs/path). The browser can't read the
// host's disk, so everything goes through Hermes's /api/fs routes:
//   /api/fs/download   streams the bytes (Range-aware, so <video> can seek)
//   /api/fs/read-text  returns a 512 KB text preview as JSON
// Both validate the path server-side and refuse credential files.

import { useEffect, useState } from 'react'

/** Where a file lives: its path on the host, and (optionally) the chat it came from. */
export type FileRef = { path: string; sessionId?: string; profile?: string }

export type MediaKind = 'image' | 'video' | 'audio' | 'file'

const ext = (path: string) => /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico', 'apng'])
const VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv'])
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'weba'])
const TEXT = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'ndjson',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'zsh',
  'sql',
  'log',
  'ini',
  'conf',
  'cfg',
  'env',
  'lua',
  'r',
  'tex',
  'srt',
  'vtt',
  'graphql',
  'proto',
  'diff',
  'patch',
])

export function mediaKind(path: string): MediaKind {
  const e = ext(path)
  if (IMAGE.has(e)) return 'image'
  if (VIDEO.has(e)) return 'video'
  if (AUDIO.has(e)) return 'audio'
  return 'file'
}

export const isTextFile = (path: string) => TEXT.has(ext(path)) || !ext(path)
export const extOf = ext
export const baseName = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || path

function query(ref: FileRef) {
  const q = new URLSearchParams({ path: ref.path })
  if (ref.sessionId) q.set('session_id', ref.sessionId)
  if (ref.profile) q.set('profile', ref.profile)
  return q.toString()
}

/** A URL the browser can stream from (img/video/audio src, or a download link). */
export const fileUrl = (ref: FileRef) => `/hermes/api/fs/download?${query(ref)}`

const key = (ref: FileRef) => `${ref.profile ?? ''}|${ref.sessionId ?? ''}|${ref.path}`

// ── Bytes ───────────────────────────────────────────────────────────────────

export class FileError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function fetchOk(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  if (!res.ok) {
    const message =
      res.status === 404
        ? 'This file isn’t there anymore.'
        : res.status === 403
          ? 'This file is private.'
          : res.status === 413
            ? 'This file is too large to show.'
            : 'Couldn’t load this file.'
    throw new FileError(res.status, message)
  }
  return res
}

type Loaded = { blob: Blob; url: string }
const blobs = new Map<string, Promise<Loaded>>()

/**
 * The file's bytes as a blob URL, fetched once per page. Images open in the
 * lightbox, share and save from this same blob, so nothing loads twice.
 */
export function loadBlob(ref: FileRef): Promise<Loaded> {
  const k = key(ref)
  let task = blobs.get(k)
  if (!task) {
    task = fetchOk(fileUrl(ref))
      .then((r) => r.blob())
      .then((blob) => ({ blob, url: URL.createObjectURL(blob) }))
    task.catch(() => blobs.delete(k))
    blobs.set(k, task)
  }
  return task
}

/** Forget a cached file (the agent rewrote it). */
export function forgetBlob(ref: FileRef) {
  const k = key(ref)
  const task = blobs.get(k)
  blobs.delete(k)
  task?.then(
    (l) => URL.revokeObjectURL(l.url),
    () => {},
  )
}

export function useBlob(ref: FileRef | null) {
  const k = ref ? key(ref) : ''
  const [state, setState] = useState<{ key: string; data?: Loaded; error?: FileError }>({ key: k })
  useEffect(() => {
    if (!ref) return
    let live = true
    loadBlob(ref).then(
      (data) => live && setState({ key: k, data }),
      (error) =>
        live &&
        setState({ key: k, error: error instanceof FileError ? error : new FileError(0, 'Couldn’t load this file.') }),
    )
    return () => {
      live = false
    }
  }, [k])
  return state.key === k ? state : { key: k }
}

// ── Size ────────────────────────────────────────────────────────────────────

const sizes = new Map<string, Promise<number | null>>()

/** The file's size, from a one-byte ranged read (Hermes has no stat route). */
export function fileSize(ref: FileRef): Promise<number | null> {
  const k = key(ref)
  let task = sizes.get(k)
  if (!task) {
    task = fetchOk(fileUrl(ref), { headers: { range: 'bytes=0-0' } })
      .then((res) => {
        void res.body?.cancel()
        const total = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? res.headers.get('content-length')
        return total ? Number(total) : null
      })
      .catch(() => null)
    sizes.set(k, task)
  }
  return task
}

export function useFileSize(ref: FileRef | null) {
  const [size, setSize] = useState<number | null>(null)
  const k = ref ? key(ref) : ''
  useEffect(() => {
    if (!ref) return
    let live = true
    fileSize(ref).then((s) => live && setSize(s))
    return () => {
      live = false
    }
  }, [k])
  return size
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / 1024 / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

// ── Text ────────────────────────────────────────────────────────────────────

export type TextFile = { text: string; truncated: boolean; binary: boolean; byteSize: number; language: string }

/** A text preview (Hermes caps it at 512 KB). Never cached: widgets get rewritten. */
export async function readText(path: string): Promise<TextFile> {
  const res = await fetchOk(`/hermes/api/fs/read-text?${new URLSearchParams({ path })}`)
  return res.json()
}

// ── Saving and sharing ──────────────────────────────────────────────────────

/** Save the file to the device. Uses the browser's download (Hermes sends it as an attachment). */
export function download(ref: FileRef, name = baseName(ref.path)) {
  const a = document.createElement('a')
  a.href = fileUrl(ref)
  a.download = name
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
}

export const canShareFiles = () => typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'

/** Open the system share sheet with the file itself. Resolves false if sharing isn't possible. */
export async function shareFile(ref: FileRef, name = baseName(ref.path)) {
  if (!canShareFiles()) return false
  const { blob } = await loadBlob(ref)
  const file = new File([blob], name, { type: blob.type })
  if (!navigator.canShare({ files: [file] })) return false
  try {
    await navigator.share({ files: [file] })
  } catch {
    /* dismissed */
  }
  return true
}
