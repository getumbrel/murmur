import type { ReactNode } from 'react'
import { ArrowUpRight, Container, Server, Terminal } from 'lucide-react'
import { Sheet } from '@/ui/sheet'
import { Tile } from '@/features/settings/page'

// "Don't have Hermes yet?": for a Murmur without one built in (the desktop
// app, or Docker without the bundle). Three ways to get one, each a link out;
// Murmur looks again by itself when the sheet closes.

const WAYS = [
  {
    icon: <Server size={16} strokeWidth={2} />,
    title: 'On an Umbrel',
    detail: 'Install Murmur from the App Store. Hermes comes with it.',
    // The App Store listing (apps.umbrel.com/app/murmur) once it's live.
    href: 'https://umbrel.com',
  },
  {
    icon: <Container size={16} strokeWidth={2} />,
    title: 'With Docker',
    detail: 'One command runs Murmur and Hermes together.',
    href: 'https://github.com/getumbrel/murmur/blob/master/docs/STANDALONE.md',
  },
  {
    icon: <Terminal size={16} strokeWidth={2} />,
    title: 'Install Hermes yourself',
    detail: 'On a Mac, Linux or a server.',
    href: 'https://github.com/NousResearch/hermes-agent',
  },
]

export function NoHermesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Don’t have Hermes yet?"
      description="Murmur talks to Hermes, a free agent that runs on your own hardware. The easiest way to get both is Murmur with Hermes built in."
      width={440}
    >
      <section className="space-y-2 pt-1">
        <div className="list-group overflow-hidden rounded-xl bg-fill-1">
          {WAYS.map((w) => (
            <WayRow key={w.title} {...w} />
          ))}
        </div>
        <p className="px-4 text-footnote text-ink-3">
          Once it’s running, come back here. Murmur looks for it by itself.
        </p>
      </section>
    </Sheet>
  )
}

/** A real link (it can be long-pressed or copied); the desktop app opens it in the browser. */
function WayRow({ icon, title, detail, href }: { icon: ReactNode; title: string; detail: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-has-icon=""
      className="flex min-h-13 w-full items-center gap-3 px-4 py-3 transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2"
    >
      <span className="flex size-7 flex-none items-center justify-center self-start pt-0.5">
        <Tile>{icon}</Tile>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body">{title}</span>
        <span className="block text-footnote text-pretty text-ink-2">{detail}</span>
      </span>
      <ArrowUpRight size={16} strokeWidth={2} className="-mr-1 flex-none text-ink-3" aria-label="Opens in a new tab" />
    </a>
  )
}
