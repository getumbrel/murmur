import { ArrowUpRight, Globe } from 'lucide-react'
import { RemoteImage, MediaBlock } from './blocks'

const IMAGE = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i

/** What a tool made (a generated picture, a page it opened), shown under its step. */
export function ToolMedia({ items }: { items: string[] }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((m) =>
        /^data:/i.test(m) || (/^https?:/i.test(m) && IMAGE.test(m)) ? (
          <RemoteImage key={m} src={m} />
        ) : /^https?:/i.test(m) ? (
          <PageLink key={m} url={m} />
        ) : (
          <MediaBlock key={m} path={m} />
        ),
      )}
    </div>
  )
}

/** A page the agent opened for you to look at. */
function PageLink({ url }: { url: string }) {
  let host = url
  let path = ''
  try {
    const u = new URL(url)
    host = u.host.replace(/^www\./, '')
    path = `${u.pathname}${u.search}`.replace(/\/$/, '')
  } catch {
    /* shown as written */
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="pressable group flex max-w-sm items-center gap-3 rounded-[18px] bg-fill-1 py-2.5 pr-3 pl-2.5 hover:bg-fill-2"
    >
      <span className="flex size-9 flex-none items-center justify-center rounded-[11px] bg-accent-soft text-accent">
        <Globe size={18} strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-footnote font-medium text-ink">{host}</span>
        {path && <span className="block truncate text-caption text-ink-3">{path}</span>}
      </span>
      <ArrowUpRight
        size={16}
        strokeWidth={2}
        aria-hidden
        className="flex-none text-ink-3 transition-transform duration-150 group-hover:translate-x-px group-hover:-translate-y-px"
      />
    </a>
  )
}
