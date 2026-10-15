// Dev-only page for Murmur's primitives: /ui.html
import { StrictMode, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster, toast } from 'sonner'
import { Plus, Settings } from 'lucide-react'
import { Button, IconButton } from './button'
import { Orb, OrbStack, type OrbState } from './orb'
import { Sheet } from './sheet'
import { Segmented } from './segmented'
import { Toggle } from './toggle'
import { Skeleton, SkeletonText } from './skeleton'
import { ListGroup, ListRow } from './list'
import * as Icons from './icons'
import { Island } from '@/screens/connection-banner'
import '../styles.css'

const STATES: OrbState[] = [
  'idle',
  'listening',
  'thinking',
  'working',
  'speaking',
  'waiting',
  'done',
  'error',
  'offline',
]
const SIZES = [20, 28, 44, 96]
const ICONS = Object.entries(Icons).filter(([name]) => name.endsWith('Icon')) as [string, (p: Icons.IconProps) => ReactNode][]
const param = new URLSearchParams(location.search)

function Lab() {
  const [sheet, setSheet] = useState<'a' | 'b' | null>(param.get('sheet') as never)
  const [confirm, setConfirm] = useState(false)
  const [on, setOn] = useState(true)
  const [seg, setSeg] = useState('day')
  const [loading, setLoading] = useState(false)
  const [island, setIsland] = useState<'hidden' | 'reconnecting' | 'lost' | 'back'>(
    (param.get('island') as never) ?? 'hidden',
  )

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      <Island phase={island} />
      <Section title="Orb" id="orbs">
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-x-3 border-spacing-y-2">
            <tbody>
              {STATES.map((s) => (
                <tr key={s}>
                  <td className="pr-2 text-footnote text-ink-2">{s}</td>
                  {SIZES.map((size, i) => (
                    <td key={size} className="align-middle">
                      <Orb hue={[278, 192, 28, 128][i]} size={size} state={s} seed={s + size} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <OrbStack hues={[278, 160, 28]} size={44} />
          <OrbStack hues={[222, 338]} size={44} />
          {[278, 250, 222, 192, 160, 128, 82, 52, 28, 4, 338, 308].map((h) => (
            <Orb key={h} hue={h} size={28} seed={String(h)} />
          ))}
        </div>
      </Section>

      <Section title="Icons" id="icons">
        {/* Murmur's own set (./icons): bare in the accent and in ink, then on its lit chip. */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
          {ICONS.map(([name, Icon]) => (
            <div key={name} className="flex flex-col items-center gap-2 rounded-xl bg-fill-1 px-1 pt-3 pb-2">
              <span className="flex items-center gap-2">
                <Icon size={24} className="text-accent" />
                <Icon size={20} className="text-ink-2" />
                <Icons.IconChip icon={Icon} size={29} />
              </span>
              <span className="text-caption text-ink-3">{name.replace(/Icon$/, '')}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons" id="buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button
            variant="accent"
            loading={loading}
            onClick={() => (setLoading(true), setTimeout(() => setLoading(false), 1600))}
          >
            Save
          </Button>
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <Button variant="accent" disabled>
            Pick 2 more
          </Button>
          <Button disabled>Continue</Button>
          <IconButton label="Add">
            <Plus size={20} />
          </IconButton>
          <IconButton label="Settings" variant="filled">
            <Settings size={18} />
          </IconButton>
          <IconButton label="New" variant="primary">
            <Plus size={20} />
          </IconButton>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-5">
          <Toggle checked={on} onChange={setOn} label="Pictures" />
          <Toggle checked={!on} onChange={(v) => setOn(!v)} label="Other" />
          <Segmented
            className="w-72"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'day', label: 'Every day' },
              { value: 'week', label: 'Weekdays' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        </div>
        <p className="mt-4 space-x-3 text-subhead">
          <span>ink</span>
          <span className="text-ink-2">ink-2 secondary</span>
          <span className="text-ink-3">ink-3 tertiary</span>
          <span className="text-accent">accent</span>
          <span className="text-danger">danger</span>
        </p>
      </Section>

      <Section title="Skeleton" id="skeleton">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-full" />
          <SkeletonText lines={2} className="flex-1" />
        </div>
        <Skeleton className="mt-4 h-40 rounded-xl" />
      </Section>

      <Section title="Sheets, toasts, island" id="sheets">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setSheet('a')}>
            Open sheet
          </Button>
          <Button variant="secondary" onClick={() => toast('Took back your last message.')}>
            Toast
          </Button>
          <Button variant="secondary" onClick={() => toast.success('Renamed to “Trip to Lisbon”')}>
            Success
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.error('Can’t start a chat right now. Check that Hermes is running, then try again.')}
          >
            Error
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const id = toast.loading('Juniper is working on “Morning brief”…')
              setTimeout(
                () => toast.success('Morning brief is ready', { id, action: { label: 'See it', onClick: () => {} } }),
                1800,
              )
            }}
          >
            Loading → action
          </Button>
          <Segmented
            className="w-full max-w-md"
            value={island}
            onChange={setIsland}
            options={[
              { value: 'hidden', label: 'Hidden' },
              { value: 'reconnecting', label: 'Retry' },
              { value: 'lost', label: 'Lost' },
              { value: 'back', label: 'Back' },
            ]}
          />
        </div>
      </Section>

      <Sheet
        open={sheet === 'a'}
        onOpenChange={(o) => setSheet(o ? 'a' : null)}
        title="Juniper"
        description="Writes your morning brief."
      >
        <ListGroup>
          <ListRow title="Confirm something" chevron onClick={() => setConfirm(true)} />
          <ListRow
            title="Hand off to another sheet"
            chevron
            onClick={() => (setSheet(null), setTimeout(() => setSheet('b'), 140))}
          />
          <ListRow title="Pictures" trailing={<Toggle checked={on} onChange={setOn} label="Pictures" />} />
        </ListGroup>
        <p className="mt-4 text-subhead text-ink-2">Drag the handle down to dismiss. The scrim lifts with it.</p>
        <div className="h-40" />
      </Sheet>
      <Sheet open={sheet === 'b'} onOpenChange={(o) => setSheet(o ? 'b' : null)} title="Memory">
        <SkeletonText lines={4} />
        <div className="h-24" />
      </Sheet>
      <Nested open={confirm} onClose={() => setConfirm(false)} />
      <Toaster position="top-center" toastOptions={{ className: 'murmur-toast' }} />
    </div>
  )
}

/** A confirm stacked over the first sheet: the one underneath recedes. */
function Nested({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Forget everything?"
      description="Juniper will start fresh."
      width={380}
    >
      <div className="grid grid-cols-2 gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onClose}>
          Forget
        </Button>
      </div>
    </Sheet>
  )
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section id={id}>
      <h2 className="mb-4 text-title font-semibold tracking-[-0.02em]">{title}</h2>
      {children}
    </section>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Lab />
    </QueryClientProvider>
  </StrictMode>,
)
