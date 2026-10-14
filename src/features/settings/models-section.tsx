import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, HardDrive, KeyRound, Plus, Search, Sparkles } from 'lucide-react'
import { ListGroup, ListRow } from '@/ui/list'
import { Sheet } from '@/ui/sheet'
import { Skeleton } from '@/ui/skeleton'
import { Spinner } from '@/ui/spinner'
import { TextField } from '@/ui/field'
import { cn } from '@/lib/cn'
import { useAgent } from '@/state/agents'
import {
  disconnect,
  modelName,
  planUsageLine,
  setMainModel,
  useModels,
  usePlanUsage,
  useRefreshModels,
  type PlanUsage,
  type Service,
} from '@/state/models'
import { ask } from './ask'
import { ConnectFlow } from './connect-flow'
import { Tile } from './page'
import { PicturesRow } from './pictures-row'
import { Swap } from './swap'

// Settings → Models: what the main agent thinks with, and the services that
// make models available.

const confirmExpensive = (message: string) => ask({ title: 'Use this model?', body: message, action: 'Use it' })

export function ModelsSection() {
  const { data, isPending, isError } = useModels()
  const main = useAgent('default')
  const refresh = useRefreshModels()
  const [picking, setPicking] = useState(false)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const chatgpt = data?.services.find((s) => s.slug === 'openai-codex')
  const usage = usePlanUsage(!!chatgpt)

  if (isPending) return <Loading />
  if (isError || !data) return <p className="px-4 text-subhead text-pretty text-ink-2">Can’t reach Hermes right now. Check that it’s running, then try again.</p>

  const current = data.services.find((s) => s.current)
  const others = data.services.filter((s) => s !== chatgpt)

  const trailingFor = (s: Service) =>
    busy === s.slug ? (
      <Spinner className="text-ink-2" />
    ) : s.remove ? (
      <button
        type="button"
        onClick={() => remove(s)}
        className="pressable touch-target relative h-8 flex-none rounded-full bg-fill-2 px-3 text-footnote font-medium text-ink-2 select-none hover:text-ink active:bg-fill-3"
      >
        Disconnect
      </button>
    ) : null

  const remove = async (s: Service) => {
    const yes = await ask({
      title: `Disconnect ${s.name}?`,
      body: s.current
        ? `${main?.name ?? 'Your agent'} is using it right now. Murmur will switch to another service you’ve connected.`
        : 'Your agents won’t be able to use its models until you connect it again.',
      action: 'Disconnect',
      destructive: true,
    })
    if (!yes) return
    setBusy(s.slug)
    try {
      await disconnect(s)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Couldn’t disconnect ${s.name}.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <ListGroup
        title="Default model"
        footer={`New chats with ${main?.name ?? 'your main agent'} start with this model. You can switch in any chat.`}
      >
        <ListRow
          title={data.model ? modelName(data.model) : 'None yet'}
          subtitle={current?.name}
          chevron={data.services.length > 0}
          onClick={data.services.length ? () => setPicking(true) : undefined}
        />
      </ListGroup>

      <ListGroup title="Services">
        {chatgpt && (
          <>
            <ListRow
              icon={<ServiceTile service={chatgpt} />}
              title={<ChatGPTTitle plan={usage.data?.plan} />}
              subtitle={<PlanLine usage={usage.data ?? null} fallback={chatgpt.detail} />}
              trailing={trailingFor(chatgpt)}
            />
            <PicturesRow />
          </>
        )}
        {others.map((s) => (
          <ListRow key={s.slug} icon={<ServiceTile service={s} />} title={s.name} subtitle={s.detail} trailing={trailingFor(s)} />
        ))}
        <ListRow
          icon={<Plus size={20} strokeWidth={2} className="text-accent" />}
          title={<span className="text-accent">Add a service</span>}
          onClick={() => setAdding(true)}
        />
      </ListGroup>

      <ModelPicker open={picking} onOpenChange={setPicking} services={data.services} model={data.model} provider={data.provider} />

      <Sheet open={adding} onOpenChange={setAdding} title="Add a service" description="Another way for your agents to think." width={480}>
        <ConnectFlow
          embedded
          options={chatgpt ? ['local', 'api-key'] : ['chatgpt', 'local', 'api-key']}
          onConnected={() => {
            setAdding(false)
            toast.success('Connected')
          }}
        />
      </Sheet>
    </>
  )
}

function ChatGPTTitle({ plan }: { plan?: string }) {
  return (
    <span className="flex items-center gap-2">
      ChatGPT
      {plan && (
        <span className="animate-fade rounded-full bg-fill-2 px-1.5 py-px text-caption font-medium text-ink-2">{plan}</span>
      )}
    </span>
  )
}

/** "Plenty left this week · resets Tue", rising in once Hermes has asked ChatGPT. */
function PlanLine({ usage, fallback }: { usage: PlanUsage | null; fallback: string }) {
  const line = usage ? planUsageLine(usage) : null
  return (
    <Swap id={line ? 'usage' : 'plan'}>
      {line?.low && <span className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-warning align-middle" />}
      {line ? (
        <>
          {line.parts.lead}
          {line.parts.scope && <span className="max-[479px]:hidden"> {line.parts.scope}</span>}
          {line.parts.reset && ` · ${line.parts.reset}`}
        </>
      ) : (
        fallback
      )}
    </Swap>
  )
}

function ServiceTile({ service }: { service: Service }) {
  const icon: ReactNode =
    service.remove?.kind === 'endpoint' ? <HardDrive size={16} strokeWidth={2} /> : service.remove?.kind === 'key' ? <KeyRound size={16} strokeWidth={2} /> : <Sparkles size={16} strokeWidth={2} />
  return <Tile>{icon}</Tile>
}

function ModelPicker({
  open,
  onOpenChange,
  services,
  model,
  provider,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  services: Service[]
  model: string
  provider: string
}) {
  const refresh = useRefreshModels()
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const total = services.reduce((n, s) => n + s.models.length, 0)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return services
      .map((s) => ({ ...s, models: q ? s.models.filter((m) => `${m} ${modelName(m)} ${s.name}`.toLowerCase().includes(q)) : s.models }))
      .filter((s) => s.models.length)
  }, [services, query])

  const pick = async (s: Service, m: string) => {
    setSaving(`${s.slug}/${m}`)
    try {
      if (await setMainModel(s.slug, m, confirmExpensive)) {
        await refresh()
        onOpenChange(false)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Couldn’t switch models.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Default model" width={460}>
      {total > 12 && (
        <div className="relative mb-5">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-3" />
          <TextField value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models" aria-label="Search models" className="h-11 pl-10" />
        </div>
      )}
      <div className="space-y-6">
        {shown.map((s) => (
          <ListGroup key={s.slug} title={s.name}>
            {s.models.map((m) => {
              const selected = m === model && (s.current || s.slug === provider)
              return (
                <ListRow
                  key={m}
                  title={<span className={cn(selected && 'font-medium')}>{modelName(m)}</span>}
                  onClick={selected || saving ? undefined : () => pick(s, m)}
                  trailing={
                    saving === `${s.slug}/${m}` ? (
                      <Spinner className="text-ink-2" />
                    ) : selected ? (
                      <Check size={18} strokeWidth={2.5} className="flex-none text-accent" />
                    ) : null
                  }
                />
              )
            })}
          </ListGroup>
        ))}
        {!shown.length && <p className="py-8 text-center text-subhead text-ink-2">No models match “{query}”.</p>}
      </div>
    </Sheet>
  )
}

/** The page's own shape while Hermes answers: a model row, then the services. */
function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-fade space-y-8 [animation-delay:120ms]">
      {[[0], [1, 1]].map((rows, g) => (
        <section key={g} className="space-y-2">
          <span className="flex h-[18px] items-center px-4">
            <Skeleton className="h-2.5 w-24 rounded-full opacity-60" />
          </span>
          <div className="list-group overflow-hidden rounded-xl bg-fill-1">
            {rows.map((icon, i) => (
              <div key={i} data-has-icon={icon ? '' : undefined} className="flex min-h-13 items-center gap-3 px-4 py-2.5">
                {!!icon && <Skeleton className="size-7 flex-none rounded-sm" />}
                <span className="flex-1">
                  <span className="flex h-6 items-center">
                    <Skeleton className="h-3 w-2/5 rounded-full" />
                  </span>
                  <span className="flex h-[18px] items-center">
                    <Skeleton className="h-2.5 w-1/4 rounded-full opacity-60" />
                  </span>
                </span>
              </div>
            ))}
          </div>
          {/* Room for the default model's two-line footnote. */}
          {g === 0 && <span className="block h-9" />}
        </section>
      ))}
    </div>
  )
}
