// Busy-session behaviour: second prompt.submit while running, session.steer, session.interrupt, queued drain.
import { connect, sleep } from './lib.mjs'
const c = await connect({ label: 'c', maxLog: 700 })
await c.rpc('client.capabilities', { server_requests: true })
const { session_id: sid } = await c.rpc('session.create', {})
const seen = []
c.on(e => { if (e.session_id === sid && !/delta|session.info|session.usage/.test(e.type)) seen.push(`${e.seq}:${e.type}${e.type === 'message.complete' ? '(' + e.payload.status + ')' : ''}`) })
await c.rpc('prompt.submit', { session_id: sid, text: 'Run `sleep 8; echo one` with the terminal tool, then run `sleep 8; echo two`, then summarise both outputs.' })
await c.waitEvent(e => e.session_id === sid && e.type === 'tool.start', 60000)
console.log('STEER', await c.rpc('session.steer', { session_id: sid, text: 'Also mention the word PINEAPPLE in your final answer.' }))
console.log('SUBMIT#2 while busy', await c.rpc('prompt.submit', { session_id: sid, text: 'Second message: reply with just the word QUEUED-OK.' }))
console.log('SUBMIT#3 while busy (queued:true)', await c.rpc('prompt.submit', { session_id: sid, text: 'Third message: reply with just the word THIRD-OK.', queued: true }))
await sleep(2000)
console.log('INTERRUPT', await c.rpc('session.interrupt', { session_id: sid }))
const first = await c.waitEvent(e => e.session_id === sid && e.type === 'message.complete', 60000)
console.log('FIRST COMPLETE', JSON.stringify(first.payload).slice(0, 600))
// See whether queued prompts drain on their own
try {
  const nxt = await c.waitEvent(e => e.session_id === sid && e.type === 'message.complete', 60000)
  console.log('NEXT COMPLETE', JSON.stringify(nxt.payload).slice(0, 400))
  const nxt2 = await c.waitEvent(e => e.session_id === sid && e.type === 'message.complete', 60000)
  console.log('NEXT2 COMPLETE', JSON.stringify(nxt2.payload).slice(0, 400))
} catch (e) { console.log('no further completes:', e.message) }
console.log('SEQUENCE', seen.join(' '))
const hist = await c.rpc('session.history', { session_id: sid })
console.log('HISTORY', JSON.stringify(hist.messages.map(m => [m.role, (m.text || m.name || '').slice(0, 80), m.display_kind])))
c.close()
