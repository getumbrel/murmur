// Full turn: session.create -> prompt.submit (tool call + reasoning) -> message.complete,
// then session.history / session.usage / session.title / session.list.
// Usage: node 03-turn.mjs ["prompt text"]   (FRAMES_OUT=file.json dumps every frame)
import { writeFileSync } from 'node:fs'
import { connect } from './lib.mjs'
const c = await connect({ label: 'c', maxLog: 1500 })
await c.rpc('client.capabilities', { server_requests: true })
const created = await c.rpc('session.create', { title: process.env.TITLE || undefined, reasoning_effort: process.env.EFFORT || undefined })
const sid = created.session_id
const text = process.argv[2] || 'Use your terminal tool to run `echo hello-from-murmur && date -u +%Y` and then tell me in one short sentence what it printed.'
const done = c.waitEvent(e => e.session_id === sid && e.type === 'message.complete', 180000)
const res = await c.rpc('prompt.submit', { session_id: sid, text })
console.log('prompt.submit result:', res)
await done
await new Promise(r => setTimeout(r, 4000)) // trailing events (title, usage)
const hist = await c.rpc('session.history', { session_id: sid })
console.log('HISTORY', JSON.stringify(hist, null, 1).slice(0, 6000))
console.log('USAGE', JSON.stringify(await c.rpc('session.usage', { session_id: sid })))
console.log('TITLE', JSON.stringify(await c.rpc('session.title', { session_id: sid })))
console.log('LIST', JSON.stringify((await c.rpc('session.list', { limit: 3 }))))
if (process.env.FRAMES_OUT) writeFileSync(process.env.FRAMES_OUT, JSON.stringify(c.frames, null, 1))
console.log('runtime sid', sid, 'stored', created.stored_session_id)
c.close()
