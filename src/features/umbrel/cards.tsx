// What an agent found on its Umbrel, shown rather than told: the photos a
// search turned up (the one it looked at, large), the files with the words
// that matched, the apps it listed, an app as it installs, the Umbrel's
// health. The same cards sit in the chat under the step that found them and
// on a call's stage, where photos get a view of their own (talk/stage-photos).
// Pictures come through Murmur's server, which asks umbrelOS for them with the
// agent's own key (server/umbrel.ts).

import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight, Folder, Play, SearchX } from 'lucide-react'
import { cn } from '@/lib/cn'
import { linkOut } from '@/lib/device'
import { TypeIcon } from '@/features/media/blocks'
import { useMediaContext } from '@/features/media/context'
import { fileUrl } from '@/features/media/files'
import { Lightbox } from '@/features/media/lightbox'
import { useHermesOnUmbrel, useOtherUmbrels, UMBREL_SERVER } from '@/state/umbrel-mcp'
import { appName, count, sentence, type AppHit, type FileHit, type Find, type Photo, type Vitals } from './finds'
import './cards.css'

/**
 * Where a card's links go: umbrelOS on the Umbrel that found it (its Photos,
 * Files and App Store). This Umbrel is the one serving Murmur; another is at
 * the address it was connected at. Undefined when there's nowhere to go.
 */
export function useUmbrelLink(server: string) {
  const onUmbrel = useHermesOnUmbrel().data
  const other = useOtherUmbrels(server !== UMBREL_SERVER).data?.find((u) => u.name === server)
  if (other) return (path: string) => linkOut(`${other.origin}${path}`)
  if (server.includes('_') || !onUmbrel) return undefined
  return (path: string) => linkOut(`${location.protocol}//${location.hostname}${path}`)
}

export function photoSrc(photo: Photo, server: string, agent?: string) {
  // One the agent looked at is already on Hermes, full size.
  if (photo.media) return fileUrl({ path: photo.media, profile: agent })
  const q = new URLSearchParams({ agent: agent ?? 'default', server, id: photo.id, v: __MURMUR_VERSION__ })
  return `/murmur/umbrel/photo?${q}`
}

/** Cards for what was found (finds.ts `gather`, or a turn's share of them from `placeFinds`). */
export function Finds({ finds, agent }: { finds: Find[]; agent?: string }) {
  if (!finds.length) return null
  return (
    <div className="flex flex-col gap-3">
      {finds.map((f) => (
        <FindCard key={f.key} find={f} agent={agent} />
      ))}
    </div>
  )
}

/** One card. One still waiting on its result shows what it's waiting for. */
export function FindCard({ find, agent }: { find: Find; agent?: string }) {
  const profile = useMediaContext().profile
  const who = agent ?? profile
  switch (find.kind) {
    case 'photos':
      return <PhotosCard find={find} agent={who} />
    case 'folder':
      return (
        <section className="found">
          <Head
            title={find.path.split('/').filter(Boolean).pop() ?? 'Files'}
            meta={find.files.length ? count(find.files.length, 'item') : find.pending ? undefined : 'Empty'}
            busy={find.pending}
          />
          {find.files.length ? <Files files={find.files} server={find.server} /> : find.pending && <Rows />}
        </section>
      )
    case 'apps':
      if (!find.apps.length && find.pending)
        return (
          <section className="found">
            <Head title={find.store ? 'App Store' : 'Apps'} busy />
            <Rows />
          </section>
        )
      return find.store ? <StoreCard apps={find.apps} server={find.server} /> : <AppsCard apps={find.apps} />
    case 'app':
      return <AppCard app={find.app} />
    case 'vitals':
      return <VitalsCard vitals={find.vitals} pending={find.pending} />
  }
}

/** Sizes the way umbrelOS writes them: 812 GB of 2 TB. */
function bytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (n >= 1000 && i < units.length - 1) (n /= 1000), i++
  return `${n < 10 && i > 0 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n)} ${units[i]}`
}

/** `busy`: still looking. The meta line says so, shimmering, until the result comes. */
function Head({ title, meta, link, busy }: { title: string; meta?: string; link?: { to: ReturnType<typeof linkOut>; label: string }; busy?: boolean }) {
  return (
    <header className="found-head">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-subhead font-semibold tracking-[-0.015em] text-ink">{title}</h3>
        {busy ? (
          <p className="truncate text-footnote text-shimmer">{meta ? `${meta} · Looking…` : 'Looking…'}</p>
        ) : (
          meta && <p className="truncate text-footnote text-ink-3">{meta}</p>
        )}
      </div>
      {link && (
        <a className="found-link pressable" {...link.to}>
          {link.label}
          <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden />
        </a>
      )}
    </header>
  )
}

// ── Photos ──────────────────────────────────────────────────────────────────

/** When a photo was taken, in words. */
export function taken(photo?: Photo) {
  const when = photo?.takenAt ? new Date(photo.takenAt.slice(0, 19)) : undefined
  if (!when || Number.isNaN(+when)) return {}
  return {
    date: when.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
    time: when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  }
}

function PhotosCard({ find, agent }: { find: Extract<Find, { kind: 'photos' }>; agent?: string }) {
  const umbrelUrl = useUmbrelLink(find.server)
  // The one it looked at leads: it's the one it's talking about.
  const photos = useMemo(
    () => [...find.photos].sort((a, b) => Number(find.looked.includes(b.id)) - Number(find.looked.includes(a.id))),
    [find.photos, find.looked],
  )
  const total = Math.max(find.total ?? 0, photos.length)
  // A hero and two beside it; six once there are enough for a row beneath.
  const shown = photos.length >= 6 ? 6 : photos.length >= 3 ? 3 : photos.length
  const title = find.query ? sentence(find.query) : 'Photos'
  const meta = [find.filters.filter((f) => f.toLowerCase() !== 'photos').join(' · '), photos.length ? count(total, 'photo') : '']
    .filter(Boolean)
    .join(' · ')
  const q = find.query ? `?${new URLSearchParams({ q: find.query })}` : ''
  // Found nothing: says so plainly, where it looked.
  if (!find.pending && !photos.length && !find.files.length)
    return (
      <section className="found found-none">
        <span aria-hidden className="found-none-icon">
          <SearchX size={20} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-subhead font-semibold tracking-[-0.015em] text-ink">{title}</h3>
          <p className="truncate text-footnote text-ink-3">Nothing in your photos or files</p>
        </div>
      </section>
    )
  return (
    <section className="found">
      <Head
        title={title}
        meta={meta}
        busy={find.pending}
        link={umbrelUrl && photos.length ? { to: umbrelUrl(`/photos${q}`), label: 'Photos' } : undefined}
      />
      {/* The shape of what's coming, while it looks. */}
      {shown === 0 && find.pending && (
        <div className="found-mosaic" data-count={3} aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="found-tile media-skeleton" style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
      )}
      {shown > 0 && (
        <div className="found-mosaic" data-count={shown}>
          {photos.slice(0, shown).map((p, i) => (
            <Tile
              key={p.id}
              photo={p}
              src={photoSrc(p, find.server, agent)}
              index={i}
              looked={find.looked.includes(p.id)}
              more={i === shown - 1 && total > shown ? total - shown : 0}
            />
          ))}
        </div>
      )}
      {find.files.length > 0 && <Files files={find.files} server={find.server} />}
    </section>
  )
}

/** Rows shaped like what's coming. */
function Rows() {
  return (
    <div className="found-rows" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="found-row" style={{ animationDelay: `${i * 0.12}s` }}>
          <span className="media-skeleton found-row-icon" />
          <span className="media-skeleton found-row-line" />
        </span>
      ))}
    </div>
  )
}

function Tile({ photo, src, index, looked, more }: { photo: Photo; src: string; index: number; looked: boolean; more: number }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const reduce = useReducedMotion()
  const label = taken(photo).date ?? 'Photo'
  return (
    <motion.button
      ref={ref}
      type="button"
      className={cn('found-tile', !loaded && !failed && 'media-skeleton')}
      data-looked={looked || undefined}
      aria-label={`${photo.video ? 'Video' : 'Photo'}, ${label}`}
      onClick={() => loaded && setOpen(true)}
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', duration: 0.5, bounce: 0.1, delay: Math.min(index, 6) * 0.045 }}
    >
      {!failed && (
        <img
          src={src}
          alt=""
          decoding="async"
          draggable={false}
          data-loaded={loaded || undefined}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      {(photo.video || photo.at != null) && (
        <span className="found-badge">
          <Play size={9} strokeWidth={0} fill="currentColor" aria-hidden />
          {photo.at != null ? clock(photo.at) : null}
        </span>
      )}
      {more > 0 && <span className="found-more">+{more}</span>}
      {open && ref.current && (
        <Lightbox src={src} alt={label} name={label} origin={ref.current} radius={10} onClose={() => setOpen(false)} />
      )}
    </motion.button>
  )
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// ── Files ───────────────────────────────────────────────────────────────────

const SHOWN_FILES = 4

function Files({ files, server }: { files: FileHit[]; server: string }) {
  const umbrelUrl = useUmbrelLink(server)
  const rest = files.length - SHOWN_FILES
  return (
    <ul className="found-files">
      {files.slice(0, SHOWN_FILES).map((f) => {
        const folder = f.path.slice(0, f.path.lastIndexOf('/')) || '/'
        const where = [folder.split('/').filter(Boolean).pop(), f.modified ? shortDate(f.modified) : undefined].filter(Boolean).join(' · ')
        const marks = [f.page ? `Page ${f.page}` : undefined, f.at != null ? `At ${clock(f.at)}` : undefined].filter(Boolean)
        const body = (
          <>
            {f.folder ? (
              <span aria-hidden className="flex size-10 flex-none items-center justify-center rounded-md bg-accent-soft text-accent">
                <Folder size={20} strokeWidth={1.75} />
              </span>
            ) : (
              <TypeIcon path={f.name} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-subhead font-medium tracking-[-0.01em] text-ink">{f.name}</span>
              {f.snippet && (f.match === 'text' || f.match === 'speech') ? (
                <span className="found-snippet">{f.match === 'speech' ? `“${f.snippet}”` : f.snippet}</span>
              ) : (
                <span className="block truncate text-footnote text-ink-3">{where || (f.size != null ? bytes(f.size) : '')}</span>
              )}
              {marks.length > 0 && <span className="mt-0.5 block text-caption font-medium text-accent">{marks.join(' · ')}</span>}
            </span>
          </>
        )
        // Where it lives, in Files: the folder opens with the file in it.
        return (
          <li key={f.path}>
            {umbrelUrl ? (
              <a
                className="found-file pressable"
                {...umbrelUrl(`/files${(f.folder ? f.path : folder).split('/').map(encodeURIComponent).join('/')}`)}
                title={`Show in Files: ${f.path}`}
              >
                {body}
              </a>
            ) : (
              <div className="found-file" title={f.path}>
                {body}
              </div>
            )}
          </li>
        )
      })}
      {rest > 0 && <li className="px-3 pt-1 text-footnote text-ink-3">{count(rest, 'more file')}</li>}
    </ul>
  )
}

const shortDate = (ms: number) => {
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Apps ────────────────────────────────────────────────────────────────────

/** An Umbrel app's icon, from the App Store's gallery; its initial if that doesn't load. */
function UmbrelAppIcon({ id, name, size = 52, dim }: { id: string; name?: string; size?: number; dim?: boolean }) {
  const [failed, setFailed] = useState(false)
  const style = { width: size, height: size, borderRadius: size * 0.2237 } as CSSProperties
  return (
    <span aria-hidden className="found-icon" style={style} data-dim={dim || undefined}>
      {failed ? (
        <span className="text-[1.15em] font-semibold" style={{ fontSize: size * 0.42 }}>
          {(name ?? appName(id)).charAt(0)}
        </span>
      ) : (
        <img src={`https://getumbrel.github.io/umbrel-apps-gallery/${encodeURIComponent(id)}/icon.svg`} alt="" draggable={false} onError={() => setFailed(true)} />
      )}
    </span>
  )
}

const RUNNING = new Set(['ready', 'running'])

function AppsCard({ apps }: { apps: AppHit[] }) {
  const running = apps.filter((a) => RUNNING.has(a.state ?? '')).length
  const updates = apps.filter((a) => a.update).length
  const meta = [`${running} running`, updates ? count(updates, 'update') : ''].filter(Boolean).join(' · ')
  return (
    <section className="found">
      <Head title={count(apps.length, 'app')} meta={meta} />
      <ul className="found-apps">
        {apps.map((a, i) => (
          <motion.li
            key={a.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', duration: 0.45, bounce: 0.1, delay: Math.min(i, 8) * 0.035 }}
            className="found-app"
          >
            <span className="relative">
              <UmbrelAppIcon id={a.id} name={a.name} dim={!RUNNING.has(a.state ?? 'ready')} />
              {a.update && <span className="found-update" title="Update available" />}
            </span>
            <span className="w-full truncate text-center text-caption text-ink-2">{a.name ?? appName(a.id)}</span>
            {!RUNNING.has(a.state ?? 'ready') && <span className="-mt-1 text-[10px] leading-3 text-ink-3">{stateLabel(a)}</span>}
          </motion.li>
        ))}
      </ul>
    </section>
  )
}

function StoreCard({ apps, server }: { apps: AppHit[]; server: string }) {
  const umbrelUrl = useUmbrelLink(server)
  return (
    <section className="found">
      <Head title="App Store" meta={count(apps.length, 'app')} />
      <ul className="found-files">
        {apps.slice(0, 5).map((a) => {
          const body = (
            <>
              <UmbrelAppIcon id={a.id} name={a.name} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-subhead font-medium tracking-[-0.01em] text-ink">{a.name ?? appName(a.id)}</span>
                {a.tagline && <span className="block truncate text-footnote text-ink-3">{a.tagline}</span>}
              </span>
              {a.installed && <span className="found-pill">Installed</span>}
            </>
          )
          return (
            <li key={a.id}>
              {umbrelUrl ? (
                <a className="found-file pressable" {...umbrelUrl(`/app-store/${encodeURIComponent(a.id)}`)}>
                  {body}
                </a>
              ) : (
                <div className="found-file">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const BUSY: Record<string, string> = {
  installing: 'Installing',
  starting: 'Starting',
  stopping: 'Stopping',
  restarting: 'Restarting',
  updating: 'Updating',
  uninstalling: 'Removing',
}

function stateLabel(a: AppHit) {
  const s = a.state ?? ''
  if (RUNNING.has(s)) return 'Running'
  if (s === 'stopped') return 'Stopped'
  if (s === 'not-installed') return 'Not installed'
  if (s === 'removed') return 'Removed'
  return BUSY[s] ?? (s ? sentence(s.replace(/-/g, ' ')) : '')
}

/** What umbrelOS measures as it goes: a download. Starting or removing an app has no percentage. */
const MEASURED = new Set(['installing', 'updating'])

/** One app, kept up to date as the agent installs, starts or checks on it. */
function AppCard({ app }: { app: AppHit }) {
  const busy = !!BUSY[app.state ?? '']
  const ready = RUNNING.has(app.state ?? '')
  const measured = busy && MEASURED.has(app.state ?? '')
  const progress = measured && app.progress != null ? Math.max(4, Math.min(100, app.progress)) : undefined
  const usage = app.usage
  const meta = ready && usage ? [usage.memory != null && `${bytes(usage.memory)} memory`, usage.disk != null && `${bytes(usage.disk)} on disk`].filter(Boolean).join(' · ') : app.tagline
  return (
    <section className="found found-one">
      <div className="flex items-center gap-3">
        <UmbrelAppIcon id={app.id} name={app.name} size={56} dim={!ready && !busy} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-semibold tracking-[-0.02em] text-ink">{app.name ?? appName(app.id)}</h3>
          <p className={cn('truncate text-footnote', busy ? 'text-shimmer' : 'text-ink-3')}>
            {busy
              ? `${stateLabel(app)}${progress != null ? ` · ${Math.round(app.progress ?? 0)}%` : ''}`
              : app.state === 'removed'
                ? 'Removed'
                : (meta ?? stateLabel(app))}
          </p>
        </div>
        {ready && app.url && (
          <a className="found-open pressable" {...linkOut(app.url)}>
            Open
          </a>
        )}
      </div>
      {progress != null ? (
        <div className="found-progress" role="progressbar" aria-valuenow={Math.round(app.progress ?? 0)} aria-valuemin={0} aria-valuemax={100}>
          <motion.i initial={false} animate={{ width: `${progress}%` }} transition={{ type: 'spring', duration: 0.9, bounce: 0 }} />
        </div>
      ) : (
        busy && (
          // Going, with no way to say how far: a sweep, not a bar stuck at nothing.
          <div className="found-progress" data-sweep role="progressbar" aria-label={stateLabel(app)}>
            <i />
          </div>
        )
      )}
    </section>
  )
}

// ── The Umbrel itself ───────────────────────────────────────────────────────

function VitalsCard({ vitals, pending }: { vitals: Vitals; pending?: boolean }) {
  const rings = [
    vitals.storage && { label: 'Storage', value: vitals.storage.used / vitals.storage.size, detail: `${bytes(vitals.storage.used)} of ${bytes(vitals.storage.size)}` },
    vitals.memory && { label: 'Memory', value: vitals.memory.used / vitals.memory.size, detail: `${bytes(vitals.memory.used)} of ${bytes(vitals.memory.size)}` },
    vitals.cpu != null && {
      label: 'Processor',
      value: vitals.cpu / 100,
      detail: vitals.temperature != null ? `${Math.round(vitals.temperature)}°C` : `${Math.round(vitals.cpu)}%`,
    },
  ].filter((r): r is { label: string; value: number; detail: string } => !!r)
  const title = vitals.device ?? 'Your Umbrel'
  const meta = vitals.version
  // Checking: the rings are there, empty, until the numbers come.
  const shown = rings.length || !pending ? rings : ['Storage', 'Memory', 'Processor'].map((label) => ({ label, value: 0, detail: '' }))
  return (
    <section className="found">
      <Head title={title} meta={meta || undefined} busy={pending} />
      {shown.length > 0 && (
        <div className="found-rings">
          {shown.map((r, i) => (
            <Ring key={r.label} {...r} index={i} />
          ))}
        </div>
      )}
    </section>
  )
}

function Ring({ label, value, detail, index }: { label: string; value: number; detail: string; index: number }) {
  const reduce = useReducedMotion()
  const v = Math.max(0, Math.min(1, value))
  const R = 26
  const C = 2 * Math.PI * R
  return (
    <figure className="found-ring" data-high={v > 0.85 || undefined}>
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden>
        <circle cx="32" cy="32" r={R} className="found-ring-track" />
        <motion.circle
          cx="32"
          cy="32"
          r={R}
          className="found-ring-fill"
          strokeDasharray={C}
          initial={reduce ? false : { strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - v) }}
          transition={{ type: 'spring', duration: 1.1, bounce: 0, delay: 0.1 + index * 0.08 }}
        />
      </svg>
      <span className="found-ring-value">{detail ? `${Math.round(v * 100)}%` : ''}</span>
      <figcaption>
        <span className="block text-footnote font-medium text-ink">{label}</span>
        <span className="block text-caption text-ink-3 tabular-nums">{detail || '\u00a0'}</span>
      </figcaption>
    </figure>
  )
}
