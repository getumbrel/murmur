// Connect, observe gateway.ready, advertise capabilities, ping.
import { connect, sleep } from './lib.mjs'
const c = await connect({ label: 'c1', maxLog: 3000 })
console.log(await c.rpc('client.capabilities', { server_requests: true }))
console.log(await c.rpc('gateway.ping', {}))
console.log(JSON.stringify(await c.rpc('gateway.capabilities', {})).slice(0, 2000))
await sleep(1500)
c.close()
