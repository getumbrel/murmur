// Moving an agent between Hermes servers: out as its profile (.tar.gz, keys
// and sign-ins left behind), back in as a new agent. Backing up everything is
// umbrelOS's job (or the Hermes host's), not Murmur's. Hermes makes the archive
// on its own disk, so Murmur asks for one there, then the browser streams it
// down through Murmur's relay, never holding it in memory.

import { api, hermesHeaders, HermesError } from '@/hermes/rest'
import { listProfileNames } from '@/hermes/compat'
import { slugFor, updateAgent, type Agent } from './agents'
import { ensureAgentTimezone } from './timezone'
import { hideDesktopToolsets } from './toolsets'
import { ensureUmbrelContext } from './umbrel-context'
import { ensureUmbrelMcp } from './umbrel-mcp'

/** What Murmur adds on top of a profile (agents.ts), carried inside an export so it comes back looking the same. */
const LOOK_FILE = 'murmur.json'
type Look = { name?: unknown; hue?: unknown; role?: unknown; template?: unknown }

/**
 * Let the browser fetch it to disk (streamed, with Murmur's relay attaching
 * the credentials). Hermes names the file itself, sensibly: "scout-20261015-090405.tar.gz".
 */
function save(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
}

export async function exportAgent(agent: Agent) {
  const look = {
    name: agent.name,
    hue: agent.hue,
    role: agent.role,
    ...(agent.template ? { template: agent.template } : {}),
  }
  const res = await api.post<{ archive: string }>(`/api/profiles/${encodeURIComponent(agent.id)}/export`, {
    extra_files: { [LOOK_FILE]: JSON.stringify(look) },
  })
  save(`/hermes/api/fs/download?${new URLSearchParams({ path: res.archive })}`)
}

/**
 * The agent's id from the file's name: ours ("scout-agent-2026-10-15"),
 * Hermes's own ("scout-20261015-090405"), or anything else, made unique.
 */
export function importId(fileName: string, taken: Iterable<string>) {
  const base = fileName
    .replace(/\.(tar\.gz|tgz)$/i, '')
    .replace(/ ?\(\d+\)$/, '')
    .replace(/-agent-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-\d{8}-\d{6}$/, '')
  // The main agent's export comes back as an agent of its own.
  return slugFor(base === 'default' ? 'hermes' : base, taken)
}

/** "Scout", or "Scout 2" when there's already a Scout. */
export function freeName(name: string, taken: readonly string[]) {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()))
  if (!used.has(name.trim().toLowerCase())) return name
  let n = 2
  while (used.has(`${name} ${n}`.toLowerCase())) n++
  return `${name} ${n}`
}

/** Brings an exported agent in as a new one, and returns its id. */
export async function importAgent(file: File, takenNames: readonly string[]) {
  if (!/\.(tar\.gz|tgz)$/i.test(file.name))
    throw new Error('That isn’t an exported agent. Look for a file ending in .tar.gz.')
  const id = importId(file.name, await listProfileNames())

  // Up to Hermes's own disk first, beside where it keeps files.
  const home = (await api.get<{ path: string }>('/api/files')).path
  const form = new FormData()
  form.append('file', file)
  form.append('path', `${home}/murmur-imports/${id}.tar.gz`)
  form.append('overwrite', 'true')
  const up = await fetch('/hermes/api/files/upload-stream', { method: 'POST', body: form, headers: hermesHeaders() })
  if (!up.ok)
    throw new Error(
      up.status === 413 ? 'That file is too big for Hermes to take.' : 'Couldn’t send the file to Hermes.',
    )
  const staged = ((await up.json()) as { path: string }).path

  let path: string
  try {
    path = (await api.post<{ path: string }>('/api/profiles/import', { archive: staged, name: id })).path
  } catch (e) {
    throw new Error(
      e instanceof HermesError && e.status === 400
        ? 'That file isn’t an agent Hermes can read.'
        : 'Hermes couldn’t bring that agent in.',
    )
  } finally {
    void api.delete('/api/files', { path: staged }).catch(() => {})
  }

  // Exported from Murmur: put its name, colour and role back.
  const look = await api
    .get<{ text?: string }>(`/api/fs/read-text?${new URLSearchParams({ path: `${path}/${LOOK_FILE}` })}`)
    .then((r) => JSON.parse(r.text ?? '{}') as Look)
    .catch(() => null)
  if (look && typeof look.name === 'string' && typeof look.hue === 'number') {
    const agent = { id, name: look.name, hue: look.hue, role: '', isDefault: false } as Agent
    await updateAgent(agent, {
      name: freeName(look.name, takenNames),
      hue: look.hue,
      role: typeof look.role === 'string' ? look.role : '',
      template: typeof look.template === 'string' ? look.template : undefined,
    }).catch(() => {})
  }
  // Settled in here as any new agent is (agents.ts createAgent): its timezone, its tools, and Umbrel.
  void ensureAgentTimezone(id, { restart: false }).catch(() => {})
  void hideDesktopToolsets(id).catch(() => {})
  void ensureUmbrelContext(id).catch(() => {})
  void ensureUmbrelMcp(id).catch(() => {})
  return id
}
