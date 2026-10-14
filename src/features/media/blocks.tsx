import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ChevronDown,
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  ImageOff,
  Presentation,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { Spinner } from '@/ui/spinner'
import { useMediaContext } from './context'
import {
  baseName,
  canShareFiles,
  download,
  extOf,
  fileUrl,
  formatSize,
  isTextFile,
  mediaKind,
  readText,
  shareFile,
  useBlob,
  useFileSize,
  type FileRef,
  type TextFile,
} from './files'
import { Lightbox } from './lightbox'

import { Markdown } from '@/features/chat/lazy-markdown'
const PreviewFrame = lazy(() => import('./preview-frame').then((m) => ({ default: m.PreviewFrame })))

/** A file the agent delivered with MEDIA:, shown the way its type deserves. */
export function MediaBlock({ path }: { path: string }) {
  const { sessionId, profile } = useMediaContext()
  const ref: FileRef = { path, sessionId, profile }
  switch (mediaKind(path)) {
    case 'image':
      return <HostImage fileRef={ref} />
    case 'video':
      return <VideoBlock fileRef={ref} />
    case 'audio':
      return <AudioBlock fileRef={ref} />
    default:
      return <FileCard fileRef={ref} />
  }
}

// ── Images ──────────────────────────────────────────────────────────────────

/** An image on the Hermes host. */
export function HostImage({ fileRef, alt }: { fileRef: FileRef; alt?: string }) {
  const { data, error } = useBlob(fileRef)
  const name = baseName(fileRef.path)
  if (error) return <Broken name={name} message={error.message} />
  return (
    <Photo
      src={data?.url}
      alt={alt ?? name}
      name={name}
      onDownload={() => download(fileRef)}
      onShare={canShareFiles() ? () => void shareFile(fileRef) : undefined}
    />
  )
}

/** A remote image from markdown (![alt](https://…)). */
export function RemoteImage({ src, alt }: { src: string; alt?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <Broken name={alt || hostOf(src)} message="Couldn’t load this image." />
  return (
    <Photo
      src={src}
      alt={alt ?? ''}
      name={alt || hostOf(src)}
      remote
      onError={() => setFailed(true)}
      onDownload={() => window.open(src, '_blank', 'noopener')}
    />
  )
}

const hostOf = (src: string) => {
  try {
    return new URL(src).hostname
  } catch {
    return 'Image'
  }
}

type PhotoProps = {
  src?: string
  alt: string
  name: string
  remote?: boolean
  onError?: () => void
  onDownload?: () => void
  onShare?: () => void
}

/**
 * The thumbnail in the thread: a calm placeholder while it loads, a soft
 * reveal when it lands, and a tap opens it full screen.
 */
function Photo({ src, alt, name, remote, onError, onDownload, onShare }: PhotoProps) {
  const img = useRef<HTMLImageElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [ratio, setRatio] = useState<number>()

  return (
    <span className="my-1 flex">
      <button
        type="button"
        onClick={() => loaded && setOpen(true)}
        aria-label={`Open ${alt || 'image'}`}
        className={cn(
          'media-photo relative block max-w-full overflow-hidden rounded-lg bg-fill-1 ring-[0.5px] ring-line',
          loaded ? 'cursor-zoom-in' : 'media-skeleton',
        )}
        style={loaded ? undefined : { width: 'min(100%, 360px)', aspectRatio: ratio ? String(ratio) : '4 / 3' }}
      >
        {src && (
          <img
            ref={img}
            src={src}
            alt={alt}
            loading={remote ? 'lazy' : undefined}
            decoding="async"
            draggable={false}
            referrerPolicy={remote ? 'no-referrer' : undefined}
            onLoad={(e) => {
              const el = e.currentTarget
              if (el.naturalWidth) setRatio(el.naturalWidth / el.naturalHeight)
              setLoaded(true)
            }}
            onError={onError}
            className={cn(
              'block h-auto max-h-[min(62vh,520px)] w-auto max-w-full object-contain transition-[opacity,scale] duration-[420ms] ease-(--ease-out)',
              loaded ? 'scale-100 opacity-100' : 'absolute inset-0 size-full scale-[1.015] object-cover opacity-0',
            )}
          />
        )}
      </button>
      {open && img.current && (
        <Lightbox
          src={src!}
          alt={alt}
          name={name}
          origin={img.current}
          radius={16}
          onClose={() => setOpen(false)}
          onDownload={onDownload}
          onShare={onShare}
        />
      )}
    </span>
  )
}

function Broken({ name, message }: { name: string; message: string }) {
  return (
    <span className="flex max-w-[420px] items-center gap-3 rounded-lg bg-fill-1 px-3.5 py-3 ring-[0.5px] ring-line">
      <ImageOff size={18} strokeWidth={1.75} className="flex-none text-ink-3" aria-hidden />
      <span className="block min-w-0">
        <span className="block truncate text-subhead font-medium">{name}</span>
        <span className="block text-footnote text-ink-3">{message}</span>
      </span>
    </span>
  )
}

// ── Video and audio ─────────────────────────────────────────────────────────

function VideoBlock({ fileRef }: { fileRef: FileRef }) {
  const [ready, setReady] = useState(false)
  return (
    <div className="my-1 flex">
      <video
        src={fileUrl(fileRef)}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={() => setReady(true)}
        className={cn(
          'block max-h-[min(62vh,520px)] max-w-full rounded-lg bg-black ring-[0.5px] ring-line',
          !ready && 'media-skeleton aspect-video w-[min(100%,420px)]',
        )}
      />
    </div>
  )
}

function AudioBlock({ fileRef }: { fileRef: FileRef }) {
  const name = baseName(fileRef.path)
  return (
    <div className="flex max-w-[420px] flex-col gap-2 rounded-lg bg-fill-1 p-3 ring-[0.5px] ring-line">
      <div className="flex items-center gap-2.5 px-0.5">
        <TypeIcon path={fileRef.path} />
        <p className="min-w-0 flex-1 truncate text-subhead font-medium">{name}</p>
        <DownloadButton fileRef={fileRef} />
      </div>
      <audio src={fileUrl(fileRef)} controls preload="metadata" className="media-audio w-full" />
    </div>
  )
}

// ── Other files ─────────────────────────────────────────────────────────────

const KIND_NAMES: Record<string, string> = {
  csv: 'Spreadsheet',
  tsv: 'Spreadsheet',
  xlsx: 'Spreadsheet',
  xls: 'Spreadsheet',
  numbers: 'Spreadsheet',
  md: 'Document',
  markdown: 'Document',
  txt: 'Text',
  doc: 'Document',
  docx: 'Document',
  pdf: 'PDF',
  rtf: 'Document',
  json: 'JSON',
  html: 'Web page',
  htm: 'Web page',
  zip: 'Archive',
  gz: 'Archive',
  tar: 'Archive',
  '7z': 'Archive',
  pptx: 'Presentation',
  key: 'Presentation',
  ppt: 'Presentation',
}

export function kindName(path: string) {
  const e = extOf(path)
  const k = mediaKind(path)
  if (k === 'image') return 'Image'
  if (k === 'video') return 'Video'
  if (k === 'audio') return 'Audio'
  return KIND_NAMES[e] ?? (e ? e.toUpperCase() : 'File')
}

export function TypeIcon({ path, className }: { path: string; className?: string }) {
  const e = extOf(path)
  const k = mediaKind(path)
  const Icon =
    k === 'image'
      ? FileImage
      : k === 'video'
        ? FileVideo
        : k === 'audio'
          ? FileAudio
          : ['csv', 'tsv', 'xlsx', 'xls', 'numbers'].includes(e)
            ? FileSpreadsheet
            : ['json', 'jsonl', 'ndjson'].includes(e)
              ? FileJson
              : ['zip', 'gz', 'tar', '7z', 'rar', 'tgz'].includes(e)
                ? FileArchive
                : ['pptx', 'ppt', 'key'].includes(e)
                  ? Presentation
                  : ['md', 'markdown', 'txt', 'pdf', 'doc', 'docx', 'rtf'].includes(e)
                    ? FileText
                    : isTextFile(path)
                      ? FileCode
                      : FileIcon
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 flex-none items-center justify-center rounded-md bg-accent-soft text-accent',
        className,
      )}
    >
      <Icon size={20} strokeWidth={1.75} />
    </span>
  )
}

function DownloadButton({ fileRef, className }: { fileRef: FileRef; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        download(fileRef)
      }}
      aria-label={`Download ${baseName(fileRef.path)}`}
      title="Download"
      className={cn(
        'pressable relative flex size-9 flex-none items-center justify-center rounded-full text-ink-2 hover:bg-fill-2 hover:text-ink after:absolute after:-inset-1',
        className,
      )}
    >
      <Download size={18} strokeWidth={1.9} />
    </button>
  )
}

const spring = { type: 'spring', stiffness: 420, damping: 40 } as const

/** A file the agent made: what it is, how big, a preview when it's text, and Download. */
export function FileCard({ fileRef }: { fileRef: FileRef }) {
  const name = baseName(fileRef.path)
  const size = useFileSize(fileRef)
  const e = extOf(fileRef.path)
  const isHtml = e === 'html' || e === 'htm'
  const previewable = isHtml || (isTextFile(fileRef.path) && mediaKind(fileRef.path) === 'file')
  const [open, setOpen] = useState(false)
  const reduce = useReducedMotion()
  const meta = [kindName(fileRef.path), size != null ? formatSize(size) : null].filter(Boolean).join(' · ')

  const head = (
    <>
      <TypeIcon path={fileRef.path} />
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-subhead font-medium tracking-[-0.01em] text-ink">{name}</p>
        <p className="truncate text-footnote text-ink-3">{meta}</p>
      </div>
    </>
  )

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg bg-fill-1 ring-[0.5px] ring-line transition-[max-width] duration-300',
        open ? 'max-w-full' : 'max-w-[420px]',
      )}
    >
      <div className="flex items-center gap-1 p-2 pr-2">
        {previewable ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-left"
          >
            {head}
            <ChevronDown
              size={18}
              strokeWidth={1.9}
              aria-hidden
              className={cn(
                'mr-1 flex-none text-ink-3 transition-transform duration-300 ease-(--ease-sheet)',
                open && 'rotate-180',
              )}
            />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 p-1">{head}</div>
        )}
        <DownloadButton fileRef={fileRef} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { height: spring, opacity: { duration: 0.2 } }}
            className="overflow-hidden"
          >
            <div className="border-t-[0.5px] border-line">
              {isHtml ? (
                <Suspense fallback={<Loading />}>
                  <div className="p-3">
                    <PreviewFrame file={fileRef.path} />
                  </div>
                </Suspense>
              ) : (
                <TextPreview path={fileRef.path} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex h-24 items-center justify-center text-ink-3">
      <Spinner />
    </div>
  )
}

function TextPreview({ path }: { path: string }) {
  const [file, setFile] = useState<TextFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    readText(path).then(
      (f) => live && setFile(f),
      (e) => live && setError(e instanceof Error ? e.message : 'Couldn’t read this file.'),
    )
    return () => {
      live = false
    }
  }, [path])

  if (error) return <p className="px-4 py-3 text-footnote text-ink-3">{error}</p>
  if (!file) return <Loading />
  if (file.binary)
    return <p className="px-4 py-3 text-footnote text-ink-3">This file can’t be previewed. Download it to open it.</p>

  const e = extOf(path)
  let body: ReactNode
  if (e === 'csv' || e === 'tsv') body = <CsvTable text={file.text} tab={e === 'tsv'} />
  else if (e === 'md' || e === 'markdown') {
    body = (
      <div className="px-4 py-3 text-subhead">
        <Suspense fallback={<Loading />}>
          <Markdown text={file.text} />
        </Suspense>
      </div>
    )
  } else {
    let text = file.text
    if (e === 'json') {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        /* show as is */
      }
    }
    body = (
      <pre className="px-4 py-3 font-mono text-[0.8125rem] leading-[1.65] tracking-normal whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">
        {text}
      </pre>
    )
  }
  return (
    <div className="max-h-[360px] overflow-auto overscroll-contain">
      {body}
      {file.truncated && <p className="px-4 pb-3 text-caption text-ink-3">Preview shows the start of the file.</p>}
    </div>
  )
}

/** A light CSV reader: quoted fields, escaped quotes, first 200 rows. */
export function parseCsv(text: string, sep = ',') {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length && rows.length < 200; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && !field) quoted = true
    else if (c === sep) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) rows.push([...row, field])
  return rows.filter((r) => r.some((c) => c.trim()))
}

function CsvTable({ text, tab }: { text: string; tab: boolean }) {
  const [head, ...rows] = parseCsv(text, tab ? '\t' : ',')
  if (!head) return <p className="px-4 py-3 text-footnote text-ink-3">This file is empty.</p>
  return (
    <table className="w-full border-collapse text-footnote tabular-nums">
      <thead className="bg-fill-1">
        <tr>
          {head.map((h, i) => (
            <th
              key={i}
              className="px-3.5 py-2 text-left font-semibold whitespace-nowrap text-ink-2 shadow-[inset_0_-0.5px_0_var(--line-strong)]"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="[&+tr>td]:shadow-[inset_0_0.5px_0_var(--line)]">
            {head.map((_, j) => (
              <td key={j} className="px-3.5 py-2 align-top text-ink">
                {r[j] ?? ''}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
