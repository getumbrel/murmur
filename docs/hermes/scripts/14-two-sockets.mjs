// Two sockets attached to the same live session (e.g. two browser tabs): does a turn fan out to both?
import { connect } from './lib.mjs'
const c1 = await connect({ label: 'c1', log: false }), c2 = await connect({ label: 'c2', log: false })
for (const c of [c1, c2]) await c.rpc('client.capabilities', { server_requests: true })
const s = await c1.rpc('session.create', {})
const t1 = c1.waitEvent(e => e.session_id === s.session_id && e.type === 'message.complete', 120000)
await c1.rpc('prompt.submit', { session_id: s.session_id, text: 'Say "one".' }); await t1
const r = await c2.rpc('session.resume', { session_id: s.stored_session_id })
console.log('c2 resume -> runtime id', r.session_id, '(c1 has', s.session_id + ')', 'resumed', r.resumed, 'messages', r.message_count)
const n = { c1: 0, c2: 0 }
c1.on(e => { if (e.session_id === s.session_id) n.c1++ }); c2.on(e => { if (e.session_id === r.session_id) n.c2++ })
const d1 = c1.waitEvent(e => e.session_id === s.session_id && e.type === 'message.complete', 120000).catch(() => null)
const d2 = c2.waitEvent(e => e.session_id === r.session_id && e.type === 'message.complete', 120000).catch(() => null)
await c2.rpc('prompt.submit', { session_id: r.session_id, text: 'Say "two".' })
const [a, b] = await Promise.all([d1, d2])
console.log('c1 got complete:', !!a, 'events', n.c1, '| c2 got complete:', !!b, 'events', n.c2)
c1.close(); c2.close()
