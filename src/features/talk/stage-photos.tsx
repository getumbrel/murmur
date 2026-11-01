import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight, Play } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { linkOut } from '@/lib/device'
import { Lightbox } from '@/features/media/lightbox'
import { photoSrc, taken, useUmbrelLink } from '@/features/umbrel/cards'
import { count, sentence, type Find } from '@/features/umbrel/finds'
import { useMediaContext } from '@/features/media/context'
import { arrange, type Box } from './photo-layout'
import { useTalk } from './talk'

// Photos on a call's stage: as large as the room under the island allows, in
// their own shapes, a tap from full screen. While there's nothing to read they
// reach down to the call's buttons; words coming, they ease up out of the way.

export type StagePhoto = { id: string; src: string; name: string; video?: boolean; at?: number }

type Size = { w: number; h: number }

/** The date and link beneath the photos. */
const FOOT = 38
/** How much of their room the captions need back (.talk-pictures). */
const CAPTIONS = 72
/** A row of them ready, or this long waiting for the slowest. */
const FIRST = 9
const PATIENCE = 1600
/** Roughly what's coming, while it looks. */
const COMING = [1.5, 0.75, 1.5, 1, 1.5]

/** Each photo's size once its picture has come: photos are laid out by their real shapes. */
function useSizes(photos: StagePhoto[]) {
  const [sizes, setSizes] = useState<Record<string, Size | null>>({})
  const asked = useRef(new Set<string>())
  useEffect(() => {
    for (const { id, src } of photos) {
      if (asked.current.has(id)) continue
      asked.current.add(id)
      const img = new Image()
      img.onload = () => setSizes((s) => ({ ...s, [id]: { w: img.naturalWidth, h: img.naturalHeight } }))
      img.onerror = () => setSizes((s) => ({ ...s, [id]: null }))
      img.src = src
    }
  }, [photos])
  return sizes
}

function useRoom() {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box>()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [])
  return [ref, box] as const
}

function useWaited(ms: number) {
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), ms)
    return () => window.clearTimeout(timer)
  }, [ms])
  return waited
}

type Props = {
  photos: StagePhoto[]
  /** How many there are, which can be more than came back. */
  total: number
  /** The first is the one being talked about. */
  lead?: boolean
  pending?: boolean
  title: string
  meta?: string
  link?: { to: ReturnType<typeof linkOut>; label: string }
}

/** The photos, all at their own shapes; what doesn't fit is counted on the last one. */
export function StagePhotos({ photos, total, lead, pending, title, meta, link }: Props) {
  const [room, box] = useRoom()
  const reduce = useReducedMotion()
  // Something to read: the agent's words, or yours.
  const captioned = useTalk((s) => !!s.spoken || !!(s.phase === 'hearing' ? s.hearing : s.you))
  const sizes = useSizes(photos)
  const waited = useWaited(PATIENCE)
  const usable = useMemo(() => photos.filter((p) => sizes[p.id] !== null), [photos, sizes])
  const settled = photos.slice(0, FIRST).every((p) => p.id in sizes)
  const shapes = useMemo(
    () =>
      usable.map((p) => {
        const size = sizes[p.id]
        return size ? size.w / size.h : 4 / 3
      }),
    [usable, sizes],
  )
  const ready = usable.length > 0 && (settled || waited)
  const layout = useMemo(
    () => box && arrange(ready ? shapes : COMING, { width: box.width, height: box.height - FOOT }, ready && lead),
    [box, ready, shapes, lead],
  )
  const [open, setOpen] = useState<{ at: number; from: HTMLElement }>()
  const tiles = useRef(new Map<string, HTMLElement>())
  const hidden = total - (photos.length - usable.length) - (ready ? (layout?.tiles.length ?? 0) : 0)
  const album = useMemo(() => usable.map((p) => ({ src: p.src, name: p.name, size: sizes[p.id] ?? undefined })), [usable, sizes])
  const looking = pending || !ready
  // Out of the captions' way: as it is if it fits above them, a little smaller if not.
  const height = layout?.height ?? 0
  const scale = box && captioned && height ? Math.max(0.3, Math.min(1, (box.height - CAPTIONS - FOOT) / height)) : 1
  const rise = box && captioned ? (box.height - height - FOOT) / 2 - (box.height - CAPTIONS - height * scale - FOOT) / 2 : 0
  const ease = reduce ? { duration: 0 } : { type: 'spring' as const, duration: 0.6, bounce: 0 }
  return (
    <div ref={room} className="talk-photos">
      {layout && (
        <motion.div
          className="talk-photos-wall"
          style={{ width: layout.width, height: layout.height, transformOrigin: 'top center' }}
          initial={false}
          animate={{ y: -rise, scale }}
          transition={ease}
        >
          {layout.tiles.map((tile, i) => {
            const photo = ready ? usable[tile.index] : undefined
            return photo ? (
              <Tile
                key={photo.id}
                ref={(el) => void (el ? tiles.current.set(photo.id, el) : tiles.current.delete(photo.id))}
                photo={photo}
                tile={tile}
                order={i}
                more={i === layout.tiles.length - 1 && layout.tiles.length > 1 && hidden > 0 ? hidden : 0}
                onOpen={(from) => setOpen({ at: tile.index, from })}
              />
            ) : (
              <span
                key={tile.index}
                className="talk-photo media-skeleton"
                style={{ left: tile.x, top: tile.y, width: tile.width, height: tile.height, animationDelay: `${i * 0.12}s` }}
              />
            )
          })}
        </motion.div>
      )}
      <motion.footer
        className="talk-photos-foot"
        style={{ width: `max(${layout?.width ?? 0}px, min(100%, 300px))` }}
        initial={false}
        animate={{ y: -rise - height * (1 - scale) }}
        transition={ease}
      >
        <p className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-ink">{title}</span>
          {looking ? (
            <span className="text-shimmer"> · Looking…</span>
          ) : (
            (meta || (hidden > 0 && layout?.tiles.length === 1)) && (
              <span className="text-ink-3"> · {[meta, layout?.tiles.length === 1 && hidden > 0 && `${hidden} more`].filter(Boolean).join(' · ')}</span>
            )
          )}
        </p>
        {link && !looking && (
          <a className="found-link pressable" {...link.to}>
            {link.label}
            <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden />
          </a>
        )}
      </motion.footer>
      {open && album[open.at] && (
        <Lightbox
          src={album[open.at].src}
          name={album[open.at].name}
          alt={album[open.at].name}
          origin={open.from}
          radius={4}
          album={album}
          start={open.at}
          total={total}
          thumbnail={(i) => tiles.current.get(usable[i].id)}
          onClose={() => setOpen(undefined)}
        />
      )}
    </div>
  )
}

type TileProps = {
  ref: (el: HTMLButtonElement | null) => void
  photo: StagePhoto
  tile: Box & { x: number; y: number }
  order: number
  more: number
  onOpen: (from: HTMLElement) => void
}

function Tile({ ref, photo, tile, order, more, onOpen }: TileProps) {
  const reduce = useReducedMotion()
  const [loaded, setLoaded] = useState(false)
  const place = { left: tile.x, top: tile.y, width: tile.width, height: tile.height }
  return (
    <motion.button
      ref={ref}
      type="button"
      className={cn('found-tile talk-photo', !loaded && 'media-skeleton')}
      aria-label={more ? `${photo.name}, and ${more} more` : photo.name}
      onClick={(e) => loaded && onOpen(e.currentTarget)}
      initial={reduce ? false : { ...place, opacity: 0, scale: 0.94 }}
      animate={{ ...place, opacity: 1, scale: 1 }}
      transition={{ type: 'spring', duration: 0.55, bounce: 0.1, delay: reduce ? 0 : Math.min(order, 6) * 0.04 }}
    >
      <img src={photo.src} alt="" decoding="async" draggable={false} data-loaded={loaded || undefined} onLoad={() => setLoaded(true)} />
      {(photo.video || photo.at != null) && (
        <span className="found-badge">
          <Play size={9} strokeWidth={0} fill="currentColor" aria-hidden />
          {photo.at != null ? `${Math.floor(photo.at / 60)}:${String(Math.floor(photo.at % 60)).padStart(2, '0')}` : null}
        </span>
      )}
      {more > 0 && <span className="found-more">+{more}</span>}
    </motion.button>
  )
}

type PhotosFind = Extract<Find, { kind: 'photos' }>

/** What a search on the Umbrel turned up; the one the agent opened leads, with when it was taken. */
export function FindPhotos({ find }: { find: PhotosFind }) {
  const agent = useMediaContext().profile
  const umbrelUrl = useUmbrelLink(find.server)
  const leading = find.pending ? undefined : find.looked.at(-1)
  const photos = useMemo(() => {
    const led = [...find.photos].sort((a, b) => Number(b.id === leading) - Number(a.id === leading))
    return led.map((p): StagePhoto => {
      const { date } = taken(p)
      return { id: p.id, src: photoSrc(p, find.server, agent), name: date ?? (p.video ? 'Video' : 'Photo'), video: p.video, at: p.at }
    })
  }, [find.photos, find.server, leading, agent])
  const total = Math.max(find.total ?? 0, find.photos.length)
  const query = find.query && sentence(find.query)
  const { date, time } = taken(find.photos.find((p) => p.id === leading))
  const q = find.query ? `?${new URLSearchParams({ q: find.query })}` : ''
  const link = umbrelUrl && find.photos.length ? { to: umbrelUrl(`/photos${q}`), label: 'Photos' } : undefined
  return leading ? (
    <StagePhotos photos={photos} total={total} lead title={date ?? 'Photo'} meta={[time, query].filter(Boolean).join(' · ')} link={link} />
  ) : (
    <StagePhotos
      photos={photos}
      total={total}
      pending={find.pending}
      title={query ?? (photos.length ? count(total, 'photo') : 'Photos')}
      meta={query && photos.length ? count(total, 'photo') : undefined}
      link={link}
    />
  )
}
