// Reconnect mid-turn: drop the socket, reconnect, replay via session.events.since, re-attach via session.resume.
import { connect, sleep } from './lib.mjs'
const c1 = await connect({ label: 'c1', maxLog: 400 })
await c1.rpc('client.capabilities', { server_requests: true })
const { session_id: sid, stored_session_id: key } = await c1.rpc('session.create', {})
let lastSeq = 0
c1.on(e => { if (e.session_id === sid && typeof e.seq === 'number') lastSeq = Math.max(lastSeq, e.seq) })
await c1.rpc('prompt.submit', { session_id: sid, text: 'Use the terminal tool to run `sleep 6; echo done-sleeping`, then write a 120-word paragraph about lighthouses.' })
await c1.waitEvent(e => e.session_id === sid && e.type === 'tool.start', 60000)
console.log('--- dropping c1 at seq', lastSeq)
c1.close()
await sleep(3000)
const c2 = await connect({ label: 'c2', maxLog: 700 })
await c2.rpc('client.capabilities', { server_requests: true })
let liveBeforeResume = 0
const off = c2.on(e => { if (e.session_id === sid) liveBeforeResume++ })
const replay = await c2.rpc('session.events.since', { session_id: sid, last_seen: lastSeq })
console.log('REPLAY summary', JSON.stringify({ ...replay, events: replay.events.map(e => `${e.seq}:${e.type}`) }))
await sleep(5000)
off()
console.log('live session events received on c2 BEFORE resume:', liveBeforeResume)
const resumed = await c2.rpc('session.resume', { session_id: key })
console.log('RESUME keys', Object.keys(resumed), 'runtime', resumed.session_id, 'running', resumed.running, 'status', resumed.status,
  'inflight', JSON.stringify(resumed.inflight)?.slice(0, 300))
const rsid = resumed.session_id
const done = await c2.waitEvent(e => e.session_id === rsid && e.type === 'message.complete', 120000)
console.log('complete text len', String(done.payload.text).length)
const r2 = await c2.rpc('session.events.since', { session_id: rsid, last_seen: 0 })
console.log('since(0) after complete:', JSON.stringify({ latest_seq: r2.latest_seq, truncated: r2.truncated, count: r2.count, epoch: r2.epoch, types: [...new Set(r2.events.map(e => e.type))] }))
c2.close()
