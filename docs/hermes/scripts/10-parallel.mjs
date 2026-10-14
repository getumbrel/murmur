// Two concurrent turns in two profiles over ONE socket; routing by session_id; session.list per profile;
// session.title set; session.delete.
import { connect } from './lib.mjs'
const c = await connect({ label: 'c', log: false })
await c.rpc('client.capabilities', { server_requests: true })
const A = await c.rpc('session.create', { profile: 'murmur-test-a' })
const B = await c.rpc('session.create', { profile: 'murmur-test-b' })
console.log('A', A.session_id, A.info.profile_name, '| B', B.session_id, B.info.profile_name)
const log = []
const text = { [A.session_id]: '', [B.session_id]: '' }
c.on(e => {
  if (e.session_id !== A.session_id && e.session_id !== B.session_id) return
  const who = e.session_id === A.session_id ? 'A' : 'B'
  if (e.type === 'message.delta') text[e.session_id] += e.payload.text
  else if (!/session.info|thinking.delta/.test(e.type)) log.push(`${who}:${e.seq}:${e.type}`)
})
const doneA = c.waitEvent(e => e.session_id === A.session_id && e.type === 'message.complete', 120000)
const doneB = c.waitEvent(e => e.session_id === B.session_id && e.type === 'message.complete', 120000)
const t0 = Date.now()
await Promise.all([
  c.rpc('prompt.submit', { session_id: A.session_id, profile: 'murmur-test-a', text: 'Count from 1 to 15 in words, comma separated. Nothing else.' }),
  c.rpc('prompt.submit', { session_id: B.session_id, profile: 'murmur-test-b', text: 'List the first 15 letters of the Greek alphabet, comma separated. Nothing else.' }),
])
const [a, b] = await Promise.all([doneA, doneB])
console.log('both done in', Date.now() - t0, 'ms')
console.log('interleaving:', log.join(' '))
console.log('A text:', a.payload.text, '\nB text:', b.payload.text)
console.log('A streamed == complete?', text[A.session_id].trim() === a.payload.text.trim(), '| B?', text[B.session_id].trim() === b.payload.text.trim())
for (const p of ['murmur-test-a', 'murmur-test-b', undefined]) {
  const l = await c.rpc('session.list', { profile: p, limit: 5 })
  console.log(`session.list profile=${p}:`, l.sessions.map(s => `${s.id} "${s.title}" (${s.source})`).join(' | '))
}
console.log('title set ->', JSON.stringify(await c.rpc('session.title', { session_id: A.session_id, title: 'Murmur renamed chat' })))
console.log('delete live ->', JSON.stringify(await c.rpc('session.delete', { session_id: A.stored_session_id, profile: 'murmur-test-a' }).catch(e => e.rpc)))
console.log('close ->', JSON.stringify(await c.rpc('session.close', { session_id: A.session_id })))
console.log('delete after close (no profile) ->', JSON.stringify(await c.rpc('session.delete', { session_id: A.stored_session_id }).catch(e => e.rpc)))
console.log('delete after close (profile) ->', JSON.stringify(await c.rpc('session.delete', { session_id: A.stored_session_id, profile: 'murmur-test-a' }).catch(e => e.rpc)))
console.log('list a after delete:', (await c.rpc('session.list', { profile: 'murmur-test-a' })).sessions.map(s => s.id).join(','))
c.close()
