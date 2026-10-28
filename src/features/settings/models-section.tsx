import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, Plus, RotateCw } from 'lucide-react'
import { ListGroup, ListRow } from '@/ui/list'
import { Sheet, SheetPin } from '@/ui/sheet'
import { Skeleton } from '@/ui/skeleton'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'
import { useAgent } from '@/state/agents'
import { disconnect, LOCAL_SLUG, modelName, planUsageLine, setMainModel, useModels, useOlderPlanUsage, useRefreshModels, type Service } from '@/state/models'
import { restingUntil } from '@/state/limits'
import { PlanGauge, Resting, ServiceHeading } from '@/features/model/plan'
import { SearchField } from '@/features/search/search-field'
import { ask } from './ask'
import { ConnectFlow } from './connect-flow'
import { LocalService } from './local-service'
import { ServerSheet } from './server-sheet'
import { Tile } from './page'
import { PicturesRow } from './pictures-row'
import { Swap } from './swap'
import { KeyIcon, ModelServerIcon, ModelsIcon, SparkIcon } from '@/ui/icons'

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
  // The model server being looked at, as last seen: it stays in its sheet while that closes, even once disconnected.
  const [server, setServer] = useState<{ service: Service; open: boolean } | null>(null)

  const chatgpt = data?.services.find((s) => s.slug === 'openai-codex')
  // (A Hermes before 0.22 only says per chat; models.ts.)
  const olderPlan = useOlderPlanUsage(!!chatgpt && !chatgpt.plan)

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
        onClick={() => void remove(s)}
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
    if (!yes) return false
    setBusy(s.slug)
    try {
      await disconnect(s)
      await refresh()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Couldn’t disconnect ${s.name}.`)
      return false
    } finally {
      setBusy(null)
    }
  }
  const shownServer = server && (data.services.find((s) => s.slug === server.service.slug) ?? server.service)

  return (
    <>
      <ListGroup
        title="Default model"
        footer={`New chats with ${main?.name ?? 'your main agent'} start with this model. You can switch in any chat.`}
      >
        <ListRow
          // Only a model a connected service still offers (one removed leaves its name behind).
          title={current && data.model ? modelName(data.model) : 'None yet'}
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
              title="ChatGPT"
              subtitle={<PlanLine service={{ ...chatgpt, plan: chatgpt.plan ?? olderPlan }} />}
              trailing={trailingFor(chatgpt)}
            />
            <PicturesRow />
          </>
        )}
        {others.map((s) =>
          s.slug === LOCAL_SLUG ? (
            <LocalService key={s.slug} service={s} services={data.services} />
          ) : s.server ? (
            // A server can be moved, or given a new key: its own sheet, with Disconnect inside.
            <ListRow
              key={s.slug}
              icon={<ServiceTile service={s} />}
              title={s.name}
              subtitle={<PlanLine service={s} />}
              chevron
              onClick={() => setServer({ service: s, open: true })}
            />
          ) : (
            <ListRow key={s.slug} icon={<ServiceTile service={s} />} title={s.name} subtitle={<PlanLine service={s} />} trailing={trailingFor(s)} />
          ),
        )}
        <ListRow
          icon={<Plus size={20} strokeWidth={2} className="text-accent" />}
          title={<span className="text-accent">Add a service</span>}
          onClick={() => setAdding(true)}
        />
      </ListGroup>

      <ServerSheet
        service={shownServer ?? null}
        main={data.model}
        open={!!server?.open}
        onOpenChange={(open) => setServer((v) => v && { ...v, open })}
        onDisconnect={remove}
      />

      <ModelPicker open={picking} onOpenChange={setPicking} services={data.services} model={data.model} provider={data.provider} />

      <Sheet open={adding} onOpenChange={setAdding} title="Add a service" description="Another way for your agents to think." width={480}>
        <ConnectFlow
          embedded
          options={chatgpt ? ['device', 'local', 'api-key'] : ['chatgpt', 'device', 'local', 'api-key']}
          onConnected={() => {
            setAdding(false)
            toast.success('Connected')
          }}
        />
      </Sheet>
    </>
  )
}

/** "Plenty left this week · resets Tue" by a little gauge, rising in once Hermes has asked; or when a resting service is back. */
function PlanLine({ service }: { service: Service }) {
  const resting = restingUntil(service.limit)
  const line = service.plan ? planUsageLine(service.plan) : null
  return (
    <Swap id={resting ? 'resting' : line ? 'usage' : 'plan'}>
      {resting ? (
        <Resting until={resting} />
      ) : line ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <PlanGauge left={line.left} />
          <span className="truncate">
            {line.parts.lead}
            {line.parts.scope && <span className="max-[479px]:hidden"> {line.parts.scope}</span>}
            {line.parts.reset && (
              <>
                {' · '}
                {/* Phones say "resets" with a glyph, so the time still fits beside Disconnect. */}
                <RotateCw size={11} strokeWidth={2.5} aria-hidden className="mr-0.5 inline -translate-y-px min-[480px]:hidden" />
                <span className="max-[479px]:sr-only">resets </span>
                {line.parts.reset.replace(/^resets /, '')}
              </>
            )}
          </span>
        </span>
      ) : (
        service.detail
      )}
    </Swap>
  )
}

function ServiceTile({ service }: { service: Service }) {
  const icon: ReactNode =
    // As each was connected (connect.tsx): a ChatGPT plan's spark, a model server, a key.
    service.slug === 'openai-codex' ? (
      <SparkIcon size={19} />
    ) : service.server ? (
      <ModelServerIcon size={19} />
    ) : service.remove?.kind === 'key' ? (
      <KeyIcon size={19} />
    ) : (
      <ModelsIcon size={19} />
    )
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
        <SheetPin query={query} className="mb-5">
          <SearchField value={query} onValueChange={setQuery} placeholder="Search models" />
        </SheetPin>
      )}
      <div className="space-y-6">
        {shown.map((s) => (
          <section key={s.slug}>
            <ServiceHeading name={s.name} plan={s.plan} resting={restingUntil(s.limit)} />
            <div className="list-group overflow-hidden rounded-xl bg-fill-1">
              {s.models.map((m) => {
                const selected = m === model && (s.current || s.slug === provider)
                const resting = restingUntil(s.limit, m)
                return (
                  <ListRow
                    key={m}
                    title={<span className={cn(selected && 'font-medium', resting && !selected && 'text-ink-2')}>{modelName(m)}</span>}
                    onClick={selected || saving ? undefined : () => pick(s, m)}
                    trailing={
                      saving === `${s.slug}/${m}` ? (
                        <Spinner className="text-ink-2" />
                      ) : selected ? (
                        <Check size={18} strokeWidth={2.5} className="flex-none text-accent" />
                      ) : resting && !restingUntil(s.limit) ? (
                        <Resting until={resting} className="flex-none text-footnote text-ink-3" />
                      ) : null
                    }
                  />
                )
              })}
            </div>
          </section>
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
