// Fills an empty, throwaway Hermes with the store screenshots' demo data:
// six agents, one chat each, and a group. Every name and message is invented.
// Never point this at a Hermes that holds anyone's real agents.
//
//   HERMES_URL=http://localhost:18889 CONTAINER=murmur-gallery-hermes \
//   DATA=<its /opt/data folder> MODEL_URL=http://host.docker.internal:18991/v1 \
//   node umbrel/gallery/tools/seed.mjs
//
// Prints the group's id, which capture.mjs needs.

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { connect, rest, sleep } from '../../../docs/hermes/scripts/ar-lib.mjs'

const { CONTAINER, DATA, MODEL_URL = 'http://host.docker.internal:18991/v1' } = process.env
if (!process.env.HERMES_URL || !CONTAINER || !DATA) throw new Error('Set HERMES_URL, CONTAINER and DATA.')
if (/:18789\b/.test(process.env.HERMES_URL)) throw new Error('That looks like the real Hermes. Use a throwaway one.')

const DAY = 86_400
// Each chat is backdated so the roster reads like a real week.
const AGENTS = [
  { id: 'scout', name: 'Scout', hue: 250, template: 'researcher', role: 'Research and fact-checking', ago: 1_500, prompt: 'Is a heat pump worth it for a 1970s house near Boston?' },
  { id: 'wren', name: 'Wren', hue: 160, template: 'planner', role: 'Plans, schedules and to-dos', ago: 7_800, prompt: 'Plan my Saturday: farmers market, a run, and dinner with Sam at 7.' },
  { id: 'basil', name: 'Basil', hue: 28, template: 'chef', role: 'Cooking, recipes and meal plans', ago: 18_000, prompt: 'What can I make tonight with chickpeas, spinach and half a lemon?' },
  { id: 'sunny', name: 'Sunny', hue: 128, template: 'coach', role: 'Goals, habits and motivation', ago: DAY + 7_200, prompt: 'I want to run a 5k by December. Right now I can barely run for 10 minutes.' },
  { id: 'quill', name: 'Quill', hue: 308, template: 'writer', role: 'Writing and editing', ago: 3 * DAY, prompt: 'Make this friendlier: "Reminder that rent is due Friday. Late payments incur a fee."' },
  { id: 'ada', name: 'Ada', hue: 192, template: 'coder', role: 'Writing, explaining and fixing code', ago: 6 * DAY, prompt: 'Can you write a Home Assistant automation that turns the porch light on at sunset?' },
]

const docker = (...args) => execFileSync('docker', args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString()
const waitForHermes = async () => {
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${process.env.HERMES_URL}/api/status`).then((r) => r.ok, () => false)) return
    await sleep(2000)
  }
  throw new Error('Hermes didn’t come up.')
}

await waitForHermes()

// The model, and approvals that ask (smart mode would wave the delete through).
const model = await rest('POST', '/api/providers/custom-endpoints?profile=default', {
  name: 'Ollama', base_url: MODEL_URL, model: 'qwen3:14b', models: ['qwen3:14b', 'llama3.2:3b'],
  discover_models: true, make_default: true, api_mode: '',
})
if (model.status !== 200) throw new Error(`Couldn’t set the model: ${JSON.stringify(model.body)}`)
if (!/^approvals:/m.test(readFileSync(`${DATA}/config.yaml`, 'utf8'))) {
  appendFileSync(`${DATA}/config.yaml`, '\napprovals:\n  mode: manual\n  timeout: 3600\n')
}

// The phone backups the main agent is asked to clear, in its home folder
// (/opt/data/home). Sparse, so they take no room.
const backups = `${DATA}/home/Downloads/phone-backups`
mkdirSync(backups, { recursive: true })
for (const [month, gb] of [['03', 14], ['07', 13], ['11', 14]]) {
  const file = `${backups}/iPhone-backup-2024-${month}.zip`
  writeFileSync(file, '')
  truncateSync(file, gb * 2 ** 30)
}

const ws = await connect({ label: 'seed' })
const created = Date.now() - 30 * DAY * 1000
for (const a of AGENTS) {
  const soul = `# ${a.name}\n\nYou are ${a.name}. You help with ${a.role[0].toLowerCase()}${a.role.slice(1)}.\n`
  await ws.call('profiles.create', { name: a.id, description: a.role, soul, share_auth: true }, 120_000)
  await ws.call('profiles.configure', {
    name: a.id,
    ui_meta: { murmur: { hue: a.hue, template: a.template }, 'hermes-bots': { imageKind: 'shape', created, title: a.name } },
  })
}

for (const a of AGENTS.toReversed()) {
  const s = await ws.call('session.create', { profile: a.id })
  await ws.call('prompt.submit', { session_id: s.session_id, text: a.prompt })
  await ws.waitFor((e) => e.type === 'message.complete' && e.session_id === s.session_id, 120_000)
  await sleep(1500)
}

const room = `murmur-${Date.now().toString(36)}-demo`
await ws.call('groups.create', {
  room_id: room,
  name: 'Lisbon weekend',
  members: ['scout', 'wren', 'basil'].map((id) => ({ member_id: id, profile: id, handle: id, display_name: AGENTS.find((a) => a.id === id).name })),
})
await ws.call('groups.send', {
  room_id: room,
  event_id: `u-${Date.now()}`,
  payload: { text: 'We land in Lisbon on Friday at 9pm and fly home Sunday evening. Can you plan the weekend?', thread_id: 'main' },
})
for (let settled = false; !settled; await sleep(2000)) {
  const { events } = await ws.call('groups.log', { room_id: room, since_seq: 0, limit: 100 })
  settled = events.some((e) => e.kind === 'room.activity' && ['settled', 'bounded'].includes(e.payload?.status))
}
ws.close()

// Backdate the chats, with Hermes stopped so nothing writes underneath.
docker('stop', CONTAINER)
for (const a of AGENTS) {
  const db = new DatabaseSync(`${DATA}/profiles/${a.id}/state.db`)
  for (const { id } of db.prepare("SELECT id FROM sessions WHERE coalesce(hidden, 0) = 0 AND source != 'bot_room'").all()) {
    db.prepare('UPDATE sessions SET started_at = started_at - ?, ended_at = ended_at - ?, last_activity_at = last_activity_at - ? WHERE id = ?').run(a.ago, a.ago, a.ago, id)
    db.prepare('UPDATE messages SET timestamp = timestamp - ? WHERE session_id = ?').run(a.ago, id)
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()
}
docker('start', CONTAINER)
await waitForHermes()
console.log(room)
process.exit(0)
