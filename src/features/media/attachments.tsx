import { useRef, useState } from 'react'
import type { UserAttachment } from '@/features/chat/types'
import { cn } from '@/lib/cn'
import { useMediaContext } from './context'
import { TypeIcon, kindName } from './blocks'
import { canShareFiles, download, formatSize, shareFile, useBlob, useFileSize, type FileRef } from './files'
import { Lightbox } from './lightbox'

/** What the person attached, above their bubble: photos as thumbnails, files as chips. */
export function UserAttachments({ items, className }: { items: UserAttachment[]; className?: string }) {
  const images = items.filter((a) => a.kind === 'image')
  const files = items.filter((a) => a.kind === 'file')
  return (
    <div className={cn('flex max-w-[85%] flex-col items-end gap-1.5', className)}>
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {images.map((a, i) => (
            <Thumb key={`${a.url ?? a.path}-${i}`} item={a} single={images.length === 1} />
          ))}
        </div>
      )}
      {files.map((a, i) => (
        <FileChip key={`${a.name}-${i}`} item={a} />
      ))}
    </div>
  )
}

/**
 * Where something you attached lives. Hermes stages attachments in its own
 * folder (refs like `profiles/<agent>/attachments/note.txt` are relative to
 * it), so they're found without the chat being live: no session needed.
 */
function useAttachmentRef(path?: string): FileRef | null {
  const { profile } = useMediaContext()
  return path ? { path, profile } : null
}

function Thumb({ item, single }: { item: Extract<UserAttachment, { kind: 'image' }>; single: boolean }) {
  const ref = useAttachmentRef(item.url ? undefined : item.path)
  const loaded = useBlob(ref)
  const src = item.url ?? loaded.data?.url
  const img = useRef<HTMLImageElement>(null)
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  // One photo keeps its shape; several sit as a grid of squares.
  const size = single ? (ready ? '' : 'size-40') : 'size-24 sm:size-28'

  if (loaded.error) {
    return (
      <span
        className={cn(
          'flex size-28 items-center justify-center rounded-lg bg-fill-1 p-2 text-center text-caption text-ink-3 ring-[0.5px] ring-line',
        )}
      >
        Image unavailable
      </span>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => ready && setOpen(true)}
        aria-label={`Open ${item.name}`}
        className={cn(
          'media-photo relative overflow-hidden rounded-lg bg-fill-1 ring-[0.5px] ring-line-strong',
          size,
          !ready && 'media-skeleton',
        )}
      >
        {src && (
          <img
            ref={img}
            src={src}
            alt={item.name}
            draggable={false}
            onLoad={() => setReady(true)}
            className={cn(
              'transition-opacity duration-300',
              single && ready ? 'block h-auto max-h-64 w-auto max-w-[min(15rem,70vw)]' : 'size-full object-cover',
              ready ? 'opacity-100' : 'opacity-0',
            )}
          />
        )}
      </button>
      {open && img.current && src && (
        <Lightbox
          src={src}
          alt={item.name}
          name={item.name}
          origin={img.current}
          radius={16}
          onClose={() => setOpen(false)}
          onDownload={() => {
            if (ref) return download(ref, item.name)
            const a = document.createElement('a')
            a.href = src
            a.download = item.name
            a.click()
          }}
          onShare={ref && canShareFiles() ? () => void shareFile(ref, item.name) : undefined}
        />
      )}
    </>
  )
}

function FileChip({ item }: { item: Extract<UserAttachment, { kind: 'file' }> }) {
  const ref = useAttachmentRef(item.path)
  const fetched = useFileSize(item.size == null ? ref : null)
  const size = item.size ?? fetched
  const meta = [kindName(item.name), size != null ? formatSize(size) : null].filter(Boolean).join(' · ')
  const body = (
    <>
      <TypeIcon path={item.name} className="size-9 rounded-[10px]" />
      <span className="min-w-0 text-left">
        <span className="block truncate text-subhead font-medium tracking-[-0.01em] text-ink">{item.name}</span>
        <span className="block truncate text-caption text-ink-3">{meta}</span>
      </span>
    </>
  )
  const chip = 'flex max-w-full min-w-0 items-center gap-2.5 rounded-[18px] rounded-br-md bg-user-bubble py-2 pr-4 pl-2'
  return ref ? (
    <button type="button" onClick={() => download(ref, item.name)} title="Download" className={cn(chip, 'pressable')}>
      {body}
    </button>
  ) : (
    <div className={chip}>{body}</div>
  )
}
