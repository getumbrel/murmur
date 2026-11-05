import { useEffect, type CSSProperties } from 'react'
import { useLocation } from 'wouter'
import { joinNames } from '@shared/groups.ts'
import { Sheet } from '@/ui/sheet'
import { ListRow } from '@/ui/list'
import { Buddy, BuddyStack } from '@/ui/buddy'
import { SiteIcon } from '@/features/vault/site-icon'
import { addToDraft, groupDraft, newChatDraft } from '@/features/chat/use-draft'
import { useGroupRows, type GroupRow } from '@/features/home/groups'
import { agentAt } from '@/features/home/roster'
import { useAgents, type Agent } from '@/state/agents'
import { useGroupSummaries } from '@/state/groups'
import { useAgentStatus, useBusyAgents } from '@/state/status'
import { takeShare, useShared, type Shared } from './share'

// Where something shared into Murmur goes (./share.ts). With one agent there's
// no one to pick: it opens a new chat with them, what was shared in the
// message box. With more, a sheet shows what's being shared over everyone it
// can go to, in Home's order; a tap does the same there. Nothing is sent
// until you send it.

type To = { kind: 'agent'; agent: Agent } | { kind: 'group'; group: GroupRow }

export function ShareSheet() {
  const shared = useShared()
  const [location, navigate] = useLocation()
  const agents = useAgents().data
  const groups = useGroupRows()
  const groupsIn = !useGroupSummaries().isPending
  const busy = useBusyAgents()
  // Setting up comes first; what was shared waits for it.
  const away = location.startsWith('/welcome') || location === '/settings/hermes'
  // One agent and no groups (once groups are in): no one to choose between.
  const solo = agents?.length === 1 && groupsIn && !groups.length ? agents[0] : undefined
  const choosing = !!shared && !away && !!agents?.length && (agents.length > 1 || groupsIn) && !solo

  // Taken once, so it lands in one box however often this runs.
  const put = (to: To) => {
    const what = takeShare()
    if (!what) return
    if (to.kind === 'agent') {
      addToDraft(newChatDraft(to.agent.id), what.text)
      navigate(`/chat/${to.agent.id}/new`)
    } else {
      addToDraft(groupDraft(to.group.id), what.text)
      navigate(`/group/${to.group.id}`)
    }
  }
  useEffect(() => {
    if (shared && solo && !away) put({ kind: 'agent', agent: solo })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, solo, away])

  // As Home has them: who you talked to last first, the main agent winning ties.
  const at = (to: To) => (to.kind === 'agent' ? agentAt(to.agent, busy) : to.group.at)
  const main = (to: To) => Number(to.kind === 'agent' && to.agent.isDefault)
  const everyone: To[] = [
    ...(agents ?? []).map((agent) => ({ kind: 'agent' as const, agent })),
    ...groups.map((group) => ({ kind: 'group' as const, group })),
  ].sort((a, b) => at(b) - at(a) || main(b) - main(a))
  const names = new Map(agents?.map((a) => [a.id, a.name]))

  return (
    <Sheet open={choosing} onOpenChange={(open) => !open && takeShare()} title="Share with" width={400}>
      {shared && <Preview shared={shared} />}
      <div className="mt-5 list-group overflow-hidden rounded-xl bg-fill-1">
        {everyone.map((to) =>
          to.kind === 'agent' ? (
            <AgentChoice key={to.agent.id} agent={to.agent} onPick={() => put(to)} />
          ) : (
            <ListRow
              key={to.group.id}
              onClick={() => put(to)}
              icon={<BuddyStack hues={to.group.memberHues} seeds={to.group.memberIds} size={28} />}
              title={to.group.name}
              subtitle={joinNames(to.group.memberIds.map((id) => names.get(id) ?? id))}
            />
          ),
        )}
      </div>
    </Sheet>
  )
}

/** An agent as one of the people it could go to: its live face, its name and what it's for. */
function AgentChoice({ agent, onPick }: { agent: Agent; onPick: () => void }) {
  const { state } = useAgentStatus(agent.id)
  return (
    <div className="hue-scope" style={{ '--hue': agent.hue } as CSSProperties}>
      <ListRow
        onClick={onPick}
        icon={<Buddy hue={agent.hue} size={28} seed={agent.id} state={state} />}
        title={agent.name}
        subtitle={agent.role || (agent.isDefault ? 'Your main agent' : 'Your agent')}
      />
    </div>
  )
}

/** What's being shared: a link as its site's icon, what it is and where, else the words themselves. */
function Preview({ shared: { text, url, title } }: { shared: Shared }) {
  const host = url && hostOf(url)
  if (!url || !host) {
    return (
      <blockquote className="line-clamp-4 rounded-xl bg-fill-1 px-4 py-3 text-subhead whitespace-pre-line text-ink">
        {text}
      </blockquote>
    )
  }
  const what = title ?? text.replace(url, '').trim()
  return (
    <div className="flex items-center gap-3 rounded-xl bg-fill-1 py-3 pr-4 pl-3">
      <SiteIcon host={host} size={40} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-subhead font-medium tracking-[-0.01em] text-ink">{what || host}</p>
        {what && <p className="mt-0.5 truncate text-footnote text-ink-2">{host}</p>}
      </div>
    </div>
  )
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}
