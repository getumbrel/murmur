// Per-session model / reasoning effort: session.create params, config.set (session scope), persistence across resume.
import { connect, sleep } from './lib.mjs'
const c = await connect({ label: 'c', log: false })
await c.rpc('client.capabilities', { server_requests: true })
const show = (label, x) => console.log(label, JSON.stringify(x).slice(0, 700))
const pick = i => i && { model: i.model, provider: i.provider, reasoning_effort: i.reasoning_effort, reasoning_effort_wire: i.reasoning_effort_wire, fast: i.fast, service_tier: i.service_tier }
try { await c.rpc('session.create', { model: 'claude-opus-4.6', provider: 'openai-codex' }) } catch (e) { show('create bad pair ->', e.rpc) }
const created = await c.rpc('session.create', { model: 'gpt-6-luna', provider: 'openai-codex', reasoning_effort: 'low', title: 'murmur model test' })
show('create ->', { session_id: created.session_id, info: created.info })
const sid = created.session_id
const infos = []
c.on(e => { if (e.session_id === sid && e.type === 'session.info') infos.push(pick(e.payload)) })
const t1 = c.waitEvent(e => e.session_id === sid && e.type === 'message.complete', 120000)
await c.rpc('prompt.submit', { session_id: sid, text: 'Say hi in 2 words.' })
show('turn1 complete usage.model', (await t1).payload.usage?.model)
show('config.set reasoning high ->', await c.rpc('config.set', { session_id: sid, key: 'reasoning', value: 'high' }))
show('config.set model gpt-6-sol ->', await c.rpc('config.set', { session_id: sid, key: 'model', value: 'gpt-6-sol' }))
show('config.set fast on ->', await c.rpc('config.set', { session_id: sid, key: 'fast', value: 'fast' }).catch(e => e.rpc))
show('config.get? ->', await c.rpc('config.get', { key: 'reasoning', session_id: sid }).catch(e => e.rpc))
const t2 = c.waitEvent(e => e.session_id === sid && e.type === 'message.complete', 120000)
await c.rpc('prompt.submit', { session_id: sid, text: 'Say bye in 2 words.' })
show('turn2 complete usage.model', (await t2).payload.usage?.model)
show('session.info events seen', infos)
show('session.close ->', await c.rpc('session.close', { session_id: sid }))
const r = await c.rpc('session.resume', { session_id: created.stored_session_id })
show('resume info ->', pick(r.info))
await sleep(500)
c.close()
