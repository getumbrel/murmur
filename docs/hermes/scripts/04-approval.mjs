// Trigger a dangerous-command approval and answer it.
// Usage: CHOICE=once|session|always|deny|none  DELAY_MS=1500  PROFILE=<name>  node 04-approval.mjs
//   CHOICE=none -> never answer (observe timeout -> request.cancel). CHOICE=interrupt -> session.interrupt instead.
import { mkdirSync } from 'node:fs'
import { connect, sleep } from './lib.mjs'
const choice = process.env.CHOICE || 'deny'
const delay = Number(process.env.DELAY_MS || 1500)
let sid
const c = await connect({
  label: 'c', maxLog: 1200,
  onRequest: async (f, cl) => {
    if (f.method !== 'approval') return cl.fail(f.id, -32601, 'unhandled')
    if (choice === 'none') return
    await sleep(delay)
    if (choice === 'interrupt') return void cl.rpc('session.interrupt', { session_id: sid })
    cl.respond(f.id, { choice })
  },
})
if (!process.env.NO_CAPS) await c.rpc('client.capabilities', { server_requests: true }) // NO_CAPS=1 to see the no-capability behaviour
const profile = process.env.PROFILE || undefined
const created = await c.rpc('session.create', { profile })
sid = created.session_id
const done = c.waitEvent(e => e.session_id === sid && e.type === 'message.complete', 900000)
await c.rpc('prompt.submit', { session_id: sid, profile,
  text: 'Run exactly this shell command with your terminal tool, nothing else, do not use any other tool: rm -rf /tmp/murmur-approval-test . Then tell me whether it ran.' })
await done
await sleep(1500)
c.close()
