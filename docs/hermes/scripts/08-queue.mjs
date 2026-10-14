// Server-side queue without interrupt: prompt.submit {queued:true} while busy -> runs after the current turn.
import { connect } from './lib.mjs'
const c = await connect({ label: 'c', log: false })
await c.rpc('client.capabilities', { server_requests: true })
const { session_id: sid } = await c.rpc('session.create', {})
const seen = []
c.on(e => { if (e.session_id === sid && /message\.(start|complete)|status.update|error/.test(e.type)) seen.push(`${e.seq}:${e.type}${e.type === 'message.complete' ? `(${e.payload.status}: ${String(e.payload.text).slice(0, 40)})` : ''}`) })
await c.rpc('prompt.submit', { session_id: sid, text: 'Run `sleep 5; echo first` with the terminal tool and report the output.' })
await c.waitEvent(e => e.session_id === sid && e.type === 'tool.start', 60000)
console.log('queued submit ->', await c.rpc('prompt.submit', { session_id: sid, text: 'Reply with just: SECOND-OK', queued: true }))
console.log('active_list ->', JSON.stringify(await c.rpc('session.active_list', { current_session_id: sid })).slice(0, 800))
await c.waitEvent(e => e.session_id === sid && e.type === 'message.complete', 90000)
await c.waitEvent(e => e.session_id === sid && e.type === 'message.complete', 90000)
console.log(seen.join('\n'))
c.close()
