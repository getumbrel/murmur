import { useState } from 'react'
import { ListGroup, ListRow } from '@/ui/list'
import { Sheet } from '@/ui/sheet'
import { Spinner } from '@/ui/spinner'
import { ServerForm } from '@/features/onboarding/server-panel'
import { findServer, updateServer, useRefreshModels, type Service } from '@/state/models'

// A model server in Settings → Models: where it is and its key, to change,
// and the way to disconnect it, kept well apart from Save.

export function ServerSheet({
  service,
  main,
  open,
  onOpenChange,
  onDisconnect,
}: {
  service: Service | null
  /** The main agent's model, kept when the server moves. */
  main?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Asks first; resolves once it's gone (or the person changed their mind). */
  onDisconnect: (service: Service) => Promise<boolean>
}) {
  const refresh = useRefreshModels()
  const [leaving, setLeaving] = useState(false)
  const server = service?.server

  const disconnect = async () => {
    if (!service || leaving) return
    setLeaving(true)
    try {
      if (await onDisconnect(service)) onOpenChange(false)
    } finally {
      setLeaving(false)
    }
  }

  return (
    <Sheet
      open={open && !!server}
      onOpenChange={onOpenChange}
      title={service?.name ?? ''}
      description={service?.detail}
      width={460}
    >
      {service && server && (
        <div className="space-y-8">
          <ServerForm
            key={server.id}
            saved={{ address: server.baseUrl, hasKey: server.hasKey }}
            onCheck={findServer}
            onSubmit={async (fields) => {
              await updateServer(service, fields, main)
              await refresh()
            }}
            submitLabel="Save"
            doneLabel="Saved"
            onDone={() => onOpenChange(false)}
          />
          <ListGroup>
            <ListRow
              title={`Disconnect ${service.name}`}
              destructive
              onClick={leaving ? undefined : () => void disconnect()}
              trailing={leaving ? <Spinner size={16} className="flex-none text-ink-3" /> : undefined}
            />
          </ListGroup>
        </div>
      )}
    </Sheet>
  )
}
