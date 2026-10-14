// Pending approval survives a reconnect: drop the socket while an approval is open, reconnect,
// session.resume -> open_requests, answer the replayed request id from the new socket.
// Needs a profile with approvals.mode: manual (PROFILE, default murmur-test-a).
import { connect, sleep } from './lib.mjs'
const profile = process.env.PROFILE || 'murmur-test-a'
let gotReq
const reqP = new Promise(r => { gotReq = r })
const c1 = await connect({ label: 'c1', log: false, onRequest: f => gotReq(f) })
await c1.rpc('client.capabilities', { server_requests: true })
const s = await c1.rpc('session.create', { profile })
await c1.rpc('prompt.submit', { session_id: s.session_id, text: 'Run exactly this with your terminal tool and nothing else: rm -rf /tmp/murmur-reconnect-test' })
const req = await reqP
console.log('c1 got', req.method, req.id)
c1.close()
await sleep(1500)
const c2 = await connect({ label: 'c2', log: false, onRequest: f => console.log('c2 onRequest (live frame?)', f.id) })
await c2.rpc('client.capabilities', { server_requests: true })
const r = await c2.rpc('session.resume', { session_id: s.stored_session_id, profile })
console.log('resume -> runtime', r.session_id, 'status', r.status, 'open_requests', JSON.stringify(r.open_requests), 'pending_approval', JSON.stringify(r.pending_approval))
const done = c2.waitEvent(e => e.session_id === r.session_id && e.type === 'message.complete', 120000)
if (r.open_requests?.[0]) c2.respond(r.open_requests[0].id, { choice: 'once' })
const toolDone = await c2.waitEvent(e => e.session_id === r.session_id && e.type === 'tool.complete', 60000)
console.log('tool.complete approval note:', toolDone.payload.result?.approval || toolDone.payload.result?.error)
await done
c2.close()
