// Upgrade-gate matrix: which credentials / Host / Origin / subprotocol combos are accepted.
// Needs the `ws` npm package (custom headers). Run: WS_DIR=/path/to/dir/with/node_modules node 02-auth-origin.mjs
import { createRequire } from 'node:module'
import { getToken, BASE } from './lib.mjs'
const require = createRequire((process.env.WS_DIR || process.cwd()) + '/')
const WS = require('ws')
const token = await getToken()
const base = BASE.replace(/^http/, 'ws') + '/api/ws'
function attempt(name, url, headers = {}, protocols) {
  return new Promise(resolve => {
    const ws = new WS(url, protocols, { headers })
    let first = null
    const done = r => { try { ws.terminate() } catch {} resolve(`${name.padEnd(48)} ${r}`) }
    ws.on('unexpected-response', (_req, res) => done(`HTTP ${res.statusCode} (rejected before upgrade)`))
    ws.on('message', d => { first = JSON.parse(d).params?.type; done(`OPEN, first event=${first}, negotiated protocol=${JSON.stringify(ws.protocol)}`) })
    ws.on('close', (code, reason) => done(`CLOSED code=${code} reason=${reason}`))
    ws.on('error', e => done(`ERROR ${e.message}`))
    setTimeout(() => done('TIMEOUT'), 5000)
  })
}
const tq = '?token=' + encodeURIComponent(token)
for (const r of await Promise.all([
  attempt('no credential', base),
  attempt('bad token', base + '?token=nope'),
  attempt('good ?token=', base + tq),
  attempt('token via X-Hermes-Session-Token header only', base, { 'X-Hermes-Session-Token': token }),
  attempt('token + Host: localhost:5173', base + tq, { Host: 'localhost:5173' }),
  attempt('token + Origin: http://localhost:5173', base + tq, { Origin: 'http://localhost:5173' }),
  attempt('token + Host/Origin evil.example.com', base + tq, { Host: 'evil.example.com', Origin: 'https://evil.example.com' }),
  attempt('token + subprotocol hermes-gateway-v1', base + tq, {}, ['hermes-gateway-v1']),
  attempt('?ticket=bogus (non-gated mode)', base + '?ticket=bogus'),
])) console.log(r)
