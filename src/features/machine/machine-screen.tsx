import './machine.css'
import { useEffect, useRef, useState } from 'react'
import { Maximize2, Monitor } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMediaContext } from '@/features/media/context'
import { fileUrl, loadBlob, type FileRef } from '@/features/media/files'
import { Lightbox, type AlbumPhoto } from '@/features/media/lightbox'
import { count } from '@/features/umbrel/finds'
import { machineName, type Screen, type Shot } from './shots'

/** Pictures already decoded this page, by path: a view that moves or comes back shows its screen at once. */
const ready = new Map<string, string>()

/**
 * A machine the agent drove, as one screen: its latest picture, which the
 * next replaces in place, a ring where the agent pressed, and every picture
 * before it a swipe away in the viewer. In an earlier reply, once a later one
 * shows the same machine, it folds to a line, so a chat has one screen per
 * machine.
 */
export function MachineScreen({ screen, live, folded }: { screen: Screen; live: boolean; folded?: boolean }) {
  const { sessionId, profile } = useMediaContext()
  const [open, setOpen] = useState(false)
  const origin = useRef<HTMLButtonElement>(null)
  const name = machineName(screen.machine)
  const album: AlbumPhoto[] = screen.shots.map((s) => ({
    src: fileUrl({ path: s.path, sessionId, profile }),
    name,
    size: s.w && s.h ? { w: s.w, h: s.h } : undefined,
  }))
  const latest = screen.shots.at(-1)!
  const fileRef = { path: latest.path, sessionId, profile }
  const viewer = open && origin.current && (
    <Lightbox
      src={album.at(-1)!.src}
      alt={`${name}’s screen`}
      name={name}
      origin={origin.current}
      radius={folded ? 8 : 14}
      album={album}
      start={album.length - 1}
      onClose={() => setOpen(false)}
    />
  )

  if (folded)
    return (
      <>
        <button
          ref={origin}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`See ${name}’s screen`}
          className="pressable flex w-fit max-w-full items-center gap-3 rounded-[18px] bg-fill-1 py-2 pr-5 pl-2 text-left hover:bg-fill-2"
        >
          <Frames shot={latest} fileRef={fileRef} name={name} className="w-16 flex-none rounded-[8px] ring-[0.5px] ring-line" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-footnote font-medium text-ink">{name}</span>
            <span className="block truncate text-caption text-ink-3">{count(screen.shots.length, 'screenshot')}</span>
          </span>
        </button>
        {viewer}
      </>
    )

  return (
    <>
      <button
        ref={origin}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`See ${name}’s screen`}
        className="group pressable relative block w-full max-w-[560px] overflow-hidden rounded-[14px] text-left"
      >
        <Frames shot={latest} fileRef={fileRef} name={name} press={live} />
        <span className="pointer-events-none absolute inset-0 rounded-[14px] shadow-[inset_0_0_0_0.5px_var(--line-strong)]" />
        <span className="glass pointer-events-none absolute bottom-2.5 left-2.5 flex h-7 max-w-[calc(100%-20px)] items-center gap-1.5 rounded-full px-2.5 text-caption font-medium shadow-[inset_0_0_0_0.5px_var(--line-strong)]">
          {live ? (
            <>
              <span className="live-dot relative flex size-2 flex-none">
                <span className="size-2 rounded-full bg-accent" />
              </span>
              <span className="flex-none">Live</span>
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              <span className="truncate text-ink-2">{name}</span>
            </>
          ) : (
            <>
              <Monitor size={13} strokeWidth={2} aria-hidden className="flex-none text-ink-2" />
              <span className="truncate">{name}</span>
            </>
          )}
        </span>
        <span className="glass absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100">
          <Maximize2 size={14} strokeWidth={2} aria-hidden />
        </span>
      </button>
      {viewer}
    </>
  )
}

type Frame = { path: string; url: string; shot: Shot; fresh: boolean }

/**
 * The screen itself: each new picture fades in over the last once it has
 * decoded, so it never blinks, and with `press`, a ring where the agent
 * pressed to get there.
 */
function Frames({
  shot,
  fileRef,
  name,
  press,
  className,
}: {
  shot: Shot
  fileRef: FileRef
  name: string
  press?: boolean
  className?: string
}) {
  const [frames, setFrames] = useState<Frame[]>(() => {
    const url = ready.get(shot.path)
    return url ? [{ path: shot.path, url, shot, fresh: false }] : []
  })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (frames[0]?.path === shot.path) return
    let alive = true
    loadBlob(fileRef)
      .then(async ({ url }) => {
        const img = new Image()
        img.src = url
        await img.decode().catch(() => {})
        ready.set(shot.path, url)
        if (alive) setFrames((f) => [{ path: shot.path, url, shot, fresh: f.length > 0 || !!press }, ...f].slice(0, 2))
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [shot.path])

  const top = frames[0]
  const at = press && top?.fresh ? top.shot.at : undefined
  const w = top?.shot.w ?? shot.w
  const h = top?.shot.h ?? shot.h
  return (
    <span
      className={cn('relative isolate block overflow-hidden bg-sunken', !top && !failed && 'skeleton rounded-none', className)}
      style={{ aspectRatio: w && h ? `${w} / ${h}` : '16 / 10' }}
    >
      {frames.map((f, i) => (
        <img
          key={f.path}
          src={f.url}
          alt={i === 0 ? `${name}’s screen` : ''}
          draggable={false}
          // The one underneath goes once the new one is in.
          onAnimationEnd={i === 0 ? () => setFrames((all) => all.slice(0, 1)) : undefined}
          className={cn(
            'absolute inset-0 block size-full object-cover select-none',
            i === 0 ? 'z-[1]' : 'z-0',
            i === 0 && f.fresh && 'machine-frame-in',
          )}
        />
      ))}
      {failed && !top && (
        <Monitor size={28} strokeWidth={1.5} aria-hidden className="absolute inset-0 m-auto text-ink-3" />
      )}
      {at && w && h && (
        <span
          key={top.path}
          aria-hidden
          className="machine-press z-[2]"
          style={{ left: `${(at[0] / w) * 100}%`, top: `${(at[1] / h) * 100}%` }}
        />
      )}
    </span>
  )
}
