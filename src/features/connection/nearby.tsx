import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check } from 'lucide-react'
import { Spinner } from '@/ui/spinner'
import { BuddyStack } from '@/ui/buddy'
import { cn } from '@/lib/cn'
import { connectionApi, type HermesConnection } from '@/state/connection'
import { orderedAgents, plural, type FoundHermes } from '@/state/setup'
import { Tile } from '@/features/settings/page'
import { agentHue } from '@/features/onboarding/setup-copy'
import { ComputerIcon, ServerIcon } from '@/ui/icons'

// Hermes people are likely to have, offered above the address field so most
// never type one: the dashboard on this computer (its default port, or the
// Umbrel app's), and an Umbrel on the network. Each is checked once, all at
// the same time, through Murmur's server (POST /murmur/connection/test, which
// saves nothing); whatever answers in time is listed, and the rest stay quiet.
// What Murmur's server found on its own (GET /murmur/setup: the Hermes Agent
// app on an Umbrel, say) joins the list too, with its agents' faces.

const CANDIDATES = [
  'http://localhost:9119',
  'http://127.0.0.1:9119',
  'http://localhost:18789',
  'http://umbrel.local:18790',
  'http://umbrel-home.local:18790',
]

/** Long enough for a sleepy .local name to answer, short enough not to hang about. */
const PROBE_MS = 4000

export type NearbyHermes = {
  url: string
  title: string
  detail: string
  connection: HermesConnection
  /** Too old for Murmur: shown, but it can't be picked. */
  outdated: boolean
  /** Found by Murmur's server: chosen by this id, never by typing its address. */
  foundId?: string
  /** Its first agents, when known: the row's icon. */
  faces?: { hue: number; seed: string }[]
}

const isLoopback = (host: string) => host === 'localhost' || /^127\./.test(host) || host === '[::1]'

/** One Hermes may answer at several of the addresses (localhost and 127.0.0.1): list it once. */
export function placeOf(url: string) {
  try {
    const u = new URL(url)
    return `${isLoopback(u.hostname) ? 'loopback' : u.hostname}:${u.port}`
  } catch {
    return url
  }
}

function describe(c: HermesConnection): NearbyHermes {
  let host = c.url
  let where = c.url
  try {
    const u = new URL(c.url)
    host = u.host
    // Loopback is the computer Murmur's server runs on: the one in front of you
    // only when the page is local too (the desktop app, or a browser beside it).
    where = !isLoopback(u.hostname) ? u.hostname : isLoopback(location.hostname) ? 'this computer' : location.hostname
  } catch {
    // Shown as given.
  }
  const outdated = !!c.outdated
  const state = c.status === 'connected' ? undefined : 'Needs a password'
  return {
    url: c.url,
    title: `Hermes on ${where}`,
    detail: [state, host, c.hermesVersion && `Hermes ${c.hermesVersion}`].filter(Boolean).join(' · '),
    connection: c,
    outdated,
  }
}

/** A Hermes Murmur's server found, as a row: its agents' faces, how many, and where. */
export function fromFound(f: FoundHermes): NearbyHermes {
  const agents = orderedAgents(f)
  const count = Math.max(f.agentCount ?? 0, agents.length)
  return {
    url: f.url,
    title: f.name,
    detail: [
      f.needsSignIn && 'Needs a password',
      count > 0 && plural(count, 'agent'),
      f.where === 'umbrel' ? 'On this Umbrel' : f.host,
      f.version && `Hermes ${f.version}`,
    ]
      .filter(Boolean)
      .join(' · '),
    connection: {
      url: f.url,
      managed: false,
      source: 'saved',
      mode: f.needsSignIn ? 'password' : 'token',
      status: f.needsSignIn ? 'needs-login' : 'connected',
      hermesVersion: f.version,
      outdated: f.outdated,
    },
    outdated: !!f.outdated,
    foundId: f.id,
    faces: agents.slice(0, 3).map((a) => ({ hue: agentHue(a), seed: a.id })),
  }
}

/** Answers from the last few seconds, so a form that opens twice in a row (or React's dev double run) asks once. */
const recent = new Map<string, { at: number; answer: Promise<HermesConnection | null> }>()
const REUSE_MS = 10_000

function probe(url: string, fresh = false) {
  const hit = recent.get(url)
  if (hit && !fresh && Date.now() - hit.at < REUSE_MS) return hit.answer
  const answer = ask(url)
  recent.set(url, { at: Date.now(), answer })
  return answer
}

async function ask(url: string): Promise<HermesConnection | null> {
  try {
    // Hanging up also tells Murmur's server to stop asking.
    const answer = await connectionApi.test({ url }, AbortSignal.timeout(PROBE_MS))
    return answer.status !== 'unreachable' ? answer : null
  } catch {
    // Too slow, already added, or Murmur's server didn't answer: nothing to offer.
    return null
  }
}

/**
 * Looks once, when `enabled` (and again when `round` changes); lists what it
 * finds as it finds it, in the order above, less those at `known` addresses.
 */
export function useNearbyHermes(enabled: boolean, known: string[] = [], round = 0) {
  const [found, setFound] = useState<{ order: number; connection: HermesConnection }[]>([])
  useEffect(() => {
    if (!enabled) return
    let live = true
    CANDIDATES.forEach((url, order) => {
      void probe(url, round > 0).then((connection) => {
        if (!live || !connection) return
        setFound((list) =>
          list.some((f) => placeOf(f.connection.url) === placeOf(connection.url))
            ? list
            : [...list, { order, connection }].sort((a, b) => a.order - b.order),
        )
      })
    })
    return () => {
      live = false
    }
  }, [enabled, round])
  const taken = new Set(known.map(placeOf))
  return found.filter((f) => !taken.has(placeOf(f.connection.url))).map((f) => describe(f.connection))
}

/**
 * The list itself: a row per Hermes found. Tapping one connects to it (or,
 * with a password, opens the sign-in fields). Nothing until something's found;
 * then it opens, and later finds join it.
 */
export function NearbyList({
  found,
  picked,
  phase,
  onPick,
}: {
  found: NearbyHermes[]
  /** The address being connected to (or just connected). */
  picked?: string
  phase: 'idle' | 'connecting' | 'connected'
  onPick: (hermes: NearbyHermes) => void
}) {
  return (
    <AnimatePresence initial={false}>
      {found.length > 0 && (
        <motion.section
          key="nearby"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] } }}
          transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
          className="-mx-1 overflow-hidden px-1"
          aria-label="Hermes found nearby"
        >
          <div className="space-y-2 pb-6">
            <h3 className="px-4 text-footnote font-medium text-ink-2">Found nearby</h3>
            <div className="list-group overflow-hidden rounded-xl bg-fill-1">
              <AnimatePresence initial={false}>
                {found.map((n) => (
                  <motion.div
                    key={n.url}
                    data-has-icon=""
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                  >
                    <NearbyRow hermes={n} busy={picked === n.url ? phase : 'idle'} locked={phase !== 'idle'} onPick={() => onPick(n)} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  )
}

function NearbyRow({
  hermes: n,
  busy,
  locked,
  onPick,
}: {
  hermes: NearbyHermes
  busy: 'idle' | 'connecting' | 'connected'
  locked: boolean
  onPick: () => void
}) {
  const local = n.title.endsWith('this computer')
  return (
    <button
      type="button"
      onClick={n.outdated || locked ? undefined : onPick}
      aria-disabled={n.outdated || undefined}
      title={n.outdated ? `${n.title} needs an update before Murmur can use it` : `Connect to ${n.title}`}
      className={cn(
        'flex min-h-13 w-full items-center gap-3 px-4 py-2.5 text-left select-none focus-visible:-outline-offset-2',
        n.outdated ? 'cursor-default' : 'transition-colors hover:bg-fill-1 active:bg-fill-2',
      )}
    >
      <span className={cn('flex size-7 flex-none items-center justify-center', n.outdated && 'opacity-50')}>
        {n.faces?.length ? (
          <BuddyStack
            size={28}
            hues={n.faces.map((f) => f.hue)}
            seeds={n.faces.map((f) => f.seed)}
            states={n.faces.map(() => (n.outdated ? 'offline' : 'idle'))}
          />
        ) : (
          <Tile>{local ? <ComputerIcon size={19} /> : <ServerIcon size={19} />}</Tile>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-body', n.outdated && 'opacity-50')}>{n.title}</span>
        <span className="block truncate text-footnote text-ink-2">
          {n.outdated && <span className="font-medium text-warning">Needs update · </span>}
          <span className={cn(n.outdated && 'opacity-60')}>{n.detail}</span>
        </span>
      </span>
      {n.outdated ? null : busy === 'connecting' ? (
        <Spinner size={16} className="flex-none text-ink-3" />
      ) : busy === 'connected' ? (
        <Check size={20} strokeWidth={2.25} className="flex-none text-success" aria-label="Connected" />
      ) : null}
    </button>
  )
}
