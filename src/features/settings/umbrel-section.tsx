import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion } from 'motion/react'
import { ArrowUpRight, Check, KeyRound, X } from 'lucide-react'
import { Button } from '@/ui/button'
import { Orb, OrbStack } from '@/ui/orb'
import { TextArea, Label } from '@/ui/field'
import { ListGroup, ListRow } from '@/ui/list'
import { Spinner } from '@/ui/spinner'
import { UmbrelIcon } from '@/ui/brand'
import { cn } from '@/lib/cn'
import { useAgents, type Agent } from '@/state/agents'
import {
  connectUmbrel,
  disconnectUmbrel,
  findUmbrelKey,
  maskKey,
  clearHandoffKey,
  handoffKey,
  UmbrelKeyError,
  umbrelSettingsUrl,
  useUmbrelMcp,
} from '@/state/umbrel-mcp'
import { ask } from './ask'

// Settings → Umbrel: lets every agent use this Umbrel through umbrelOS's MCP
// server. umbrelOS makes the key (Settings → AI agents (MCP)); you paste
// whatever it shows here and Murmur adds it to each agent itself (umbrel-mcp.ts),
// so no chat or model provider ever sees it.

const openUmbrelOS = () => window.open(umbrelSettingsUrl(), '_blank', 'noopener')

export function UmbrelSection() {
  const qc = useQueryClient()
  const agents = useAgents().data ?? []
  const ids = agents.map((a) => a.id)
  const status = useUmbrelMcp(ids)
  const connected = status.data?.connected ?? []
  // A key umbrelOS handed over ("Connect in Murmur"): offered, never applied without a tap.
  const [handed] = useState(handoffKey)
  // Offered once: the screen that shows it uses it up.
  useEffect(() => clearHandoffKey(), [])
  const [replacing, setReplacing] = useState(!!handed)
  // Agents done so far while connecting, or null when not.
  const [progress, setProgress] = useState<string[] | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['umbrel-mcp'] })
  const on = connected.length > 0 && !replacing && !progress

  const connect = async (key: string) => {
    setProgress([])
    try {
      await connectUmbrel(key, ids, (id) => setProgress((done) => [...(done ?? []), id]))
      await refresh()
      setReplacing(false)
      toast.success(agents.length > 1 ? 'Your agents can use this Umbrel now' : 'Connected to this Umbrel')
      return null
    } catch (e) {
      void refresh()
      if (e instanceof UmbrelKeyError) return 'umbrelOS didn’t accept that key. Make a new one and paste it again.'
      toast.error('Couldn’t reach Hermes. Check that it’s running, then try again.')
      return null
    } finally {
      setProgress(null)
    }
  }

  const disconnect = async () => {
    const yes = await ask({
      title: 'Disconnect this Umbrel?',
      body: 'Your agents won’t be able to use it until you connect it again. To retire the key too, remove it in umbrelOS.',
      action: 'Disconnect',
      destructive: true,
    })
    if (!yes) return
    try {
      await disconnectUmbrel(connected)
      toast.success('Disconnected')
    } catch {
      toast.error('Couldn’t reach Hermes. Check that it’s running, then try again.')
    } finally {
      void refresh()
    }
  }

  return (
    <div className="space-y-8">
      <Hero agents={agents} on={on} />

      {status.isPending ? (
        <div className="grid place-items-center py-6">
          <Spinner />
        </div>
      ) : on ? (
        <>
          <AgentList agents={agents} has={(id) => connected.includes(id)} />
          <ListGroup>
            <ListRow
              title="Choose what they can use"
              subtitle="In umbrelOS"
              onClick={openUmbrelOS}
              trailing={<ArrowUpRight size={18} className="-mr-1 flex-none text-ink-3" />}
            />
            <ListRow title="Use a new key" chevron onClick={() => setReplacing(true)} />
          </ListGroup>
          <ListGroup>
            <ListRow title="Disconnect" destructive onClick={() => void disconnect()} />
          </ListGroup>
        </>
      ) : (
        <>
          <ConnectForm
            initial={handed ?? ''}
            count={agents.length}
            busy={!!progress}
            onConnect={connect}
            onCancel={replacing && connected.length ? () => setReplacing(false) : undefined}
          />
          {progress && <AgentList agents={agents} has={(id) => progress.includes(id)} working />}
        </>
      )}
    </div>
  )
}

/** The Umbrel and the agents, joined once they're connected. */
function Hero({ agents, on }: { agents: Agent[]; on: boolean }) {
  return (
    <div className="flex flex-col items-center pt-2 text-center">
      <div className="flex items-center">
        <UmbrelIcon size={64} className="drop-shadow-[0_6px_14px_rgb(91_66_255/0.28)]" />
        {/* The link between them: dotted and drifting while it's only a promise, drawn solid once it's real. */}
        <span aria-hidden className="umbrel-link relative mx-3.5 h-[3px] w-12 overflow-hidden rounded-full">
          <motion.span
            className="umbrel-link-fill absolute inset-0 origin-left rounded-full"
            initial={false}
            animate={{ scaleX: on ? 1 : 0 }}
            transition={{ type: 'spring', duration: 0.7, bounce: 0 }}
          />
        </span>
        <OrbStack
          hues={agents.map((a) => a.hue)}
          seeds={agents.map((a) => a.id)}
          states={agents.map(() => (on ? 'done' : 'idle'))}
          size={64}
        />
      </div>
      <h2 className="mt-5 text-title font-semibold tracking-[-0.02em]">
        {on ? 'Connected to this Umbrel' : 'Let your agents use this Umbrel'}
      </h2>
      <p className="mt-1 max-w-80 text-subhead text-balance text-ink-2">
        Apps, files and more, only as far as you allow in umbrelOS.
      </p>
    </div>
  )
}

function ConnectForm({
  initial,
  count,
  busy,
  onConnect,
  onCancel,
}: {
  initial: string
  count: number
  busy: boolean
  /** Resolves to a problem with the key, or null. */
  onConnect: (key: string) => Promise<string | null>
  onCancel?: () => void
}) {
  const [text, setText] = useState(initial)
  const [problem, setProblem] = useState<string | null>(null)
  const key = findUmbrelKey(text)

  const submit = async () => {
    if (!key) return
    setProblem(await onConnect(key))
  }

  return (
    <div className="space-y-6">
      <ListGroup footer="Turn it on, choose what agents can use, then copy what it shows.">
        <ListRow
          icon={<UmbrelIcon size={29} />}
          title="Open AI agents in umbrelOS"
          onClick={openUmbrelOS}
          trailing={<ArrowUpRight size={18} className="-mr-1 flex-none text-ink-3" />}
        />
      </ListGroup>

      {key ? (
        // Found it: the key itself stays off screen.
        <div className="space-y-2">
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.2 }}
            className="flex items-center gap-3 rounded-xl bg-fill-1 py-3 pr-2 pl-4"
          >
            <span
              className={cn(
                'grid size-8 flex-none place-items-center rounded-full',
                problem ? 'bg-danger/12 text-danger' : 'bg-success/15 text-success',
              )}
              aria-hidden
            >
              {problem ? <X size={16} strokeWidth={2.5} /> : <KeyRound size={16} strokeWidth={2.25} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body">Key from umbrelOS</span>
              <span className="block truncate font-mono text-footnote text-ink-3">{maskKey(key)}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-ink-2"
              disabled={busy}
              onClick={() => {
                setText('')
                setProblem(null)
              }}
            >
              Clear
            </Button>
          </motion.div>
          {problem && (
            <p role="alert" className="px-4 text-footnote text-danger">
              {problem}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Label>Paste it here</Label>
          <TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="The message from umbrelOS, or just its key"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            className="min-h-24 text-subhead"
          />
          {text.trim() && (
            <p className="px-4 text-footnote text-ink-3">No umbrelOS key in that yet. It starts with umbrelmcp_.</p>
          )}
        </div>
      )}

      <div className="grid gap-2">
        <Button variant="accent" size="lg" disabled={!key} loading={busy} onClick={() => void submit()}>
          {count > 1 ? `Connect ${count} agents` : 'Connect'}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="lg" className="text-ink-2" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

function AgentList({ agents, has, working }: { agents: Agent[]; has: (id: string) => boolean; working?: boolean }) {
  return (
    <ListGroup title="Agents" footer={working ? undefined : 'Agents you make later get it too.'}>
      {agents.map((a) => {
        const done = has(a.id)
        return (
          <ListRow
            key={a.id}
            icon={<Orb hue={a.hue} seed={a.id} size={29} state={done ? 'done' : working ? 'thinking' : 'idle'} />}
            title={a.name}
            trailing={
              done ? (
                <motion.span
                  // Each check lands as its agent connects; ones already there just are.
                  initial={working ? { scale: 0.4, opacity: 0 } : false}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', duration: 0.45, bounce: 0.45 }}
                  className="flex flex-none"
                >
                  <Check size={18} strokeWidth={2.5} className="text-success" aria-label="Connected" />
                </motion.span>
              ) : working ? (
                <Spinner />
              ) : (
                <span className="flex-none text-subhead text-ink-3">Not yet</span>
              )
            }
          />
        )
      })}
    </ListGroup>
  )
}
