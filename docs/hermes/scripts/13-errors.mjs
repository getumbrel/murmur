// Error shapes: unknown session, provider without credentials (turn failure), bad config.set value.
import { connect } from './lib.mjs'
const c = await connect({ label: 'c', maxLog: 1500 })
await c.rpc('client.capabilities', { server_requests: true })
await c.rpc('prompt.submit', { session_id: 'nope1234', text: 'hi' }).catch(e => console.log('unknown session ->', JSON.stringify(e.rpc)))
const s = await c.rpc('session.create', { model: 'anthropic/claude-sonnet-4.6', provider: 'openrouter' }).catch(e => { console.log('create ->', JSON.stringify(e.rpc)); return null })
if (s) {
  const sid = s.session_id
  const end = c.waitEvent(e => e.session_id === sid && (e.type === 'message.complete' || e.type === 'error'), 120000)
  await c.rpc('prompt.submit', { session_id: sid, text: 'hi' }).catch(e => console.log('submit ->', JSON.stringify(e.rpc)))
  await end.catch(e => console.log(e.message))
  await c.rpc('config.set', { session_id: sid, key: 'reasoning', value: 'turbo' }).catch(e => console.log('bad reasoning ->', JSON.stringify(e.rpc)))
}
await new Promise(r => setTimeout(r, 1500))
c.close()
