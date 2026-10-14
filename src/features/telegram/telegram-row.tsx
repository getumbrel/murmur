import { ListRow } from '@/ui/list'
import { Skeleton } from '@/ui/skeleton'
import type { Agent } from '@/state/agents'
import { usePairings, useTelegram } from '@/state/telegram'
import { TelegramGlyph } from './telegram-glyph'

/**
 * "Telegram · Connected as @atlas_bot" / "Text Atlas from Telegram", for the
 * agent sheet. Sits in a ListGroup; opens <TelegramSheet> via `onOpen`.
 */
export function TelegramRow({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const { data, isPending } = useTelegram(agent.id)
  const pairing = usePairings((s) => s.byAgent[agent.id]?.phase)
  const subtitle =
    pairing === 'waiting' || pairing === 'starting' ? (
      'Finishing setup…'
    ) : pairing === 'saving' ? (
      'Connecting…'
    ) : isPending ? (
      <Skeleton className="inline-block h-2.5 w-36 rounded-full align-middle" />
    ) : !data || data.state === 'off' ? (
      `Text ${agent.name} from Telegram`
    ) : data.state === 'connected' ? (
      data.username ? (
        `Connected as @${data.username}`
      ) : (
        'Connected'
      )
    ) : data.state === 'starting' ? (
      'Connecting…'
    ) : (
      'Not connected right now'
    )
  return (
    <ListRow
      icon={<TelegramGlyph size={28} />}
      title="Telegram"
      subtitle={subtitle}
      onClick={onOpen}
      trailing={
        data?.state === 'connected' ? (
          <span className="size-2 flex-none rounded-full bg-success" aria-label="Connected" />
        ) : undefined
      }
      chevron
    />
  )
}
