// Create (or delete with DELETE=1) the murmur-test-a / murmur-test-b profiles used by the other probes.
import { connect, rest } from './lib.mjs'
const names = ['murmur-test-a', 'murmur-test-b']
if (process.env.DELETE) {
  for (const n of names) console.log(n, JSON.stringify(await rest(`/api/profiles/${n}`, { method: 'DELETE' })))
  process.exit(0)
}
const c = await connect({ label: 'p' })
for (const name of names) {
  try { console.log(await c.rpc('profiles.create', { name, clone_from: 'default' }, 120000)) } catch (e) { console.log(name, e.rpc || e.message) }
}
console.log(JSON.stringify(await c.rpc('profiles.list', {})).slice(0, 1500))
c.close()
