// Live: server-hosted group chat (groups.*) end to end over /api/ws.
// create -> state -> send -> poll log/state while a 2nd connection watches pushed events -> rename -> stop -> disband.
// Usage: node ar-05-hosted-room.mjs [profileA] [profileB] [--keep]
import { connect, show, sleep } from './ar-lib.mjs';
const [A = 'murmur-test-alpha', B = 'murmur-test-beta'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const keep = process.argv.includes('--keep');
const c = await connect({ label: 'room' });
const watcher = await connect({ label: 'watch' });
const room_id = 'murmur-test-room-' + Date.now().toString(36);
const members = [
  { member_id: A, profile: A, handle: A.replace(/^murmur-test-/, ''), display_name: 'Alpha' },
  { member_id: B, profile: B, handle: B.replace(/^murmur-test-/, ''), display_name: 'Beta' },
];
show('groups.create (1 member → error)', await c.tryCall('groups.create', { room_id: room_id + 'x', name: 'Solo', members: members.slice(0, 1) }));
const created = await c.call('groups.create', { room_id, name: 'Murmur test room', members });
show('groups.create', created);
show('groups.create again (idempotent)', (await c.tryCall('groups.create', { room_id, name: 'Murmur test room', members })).result?.room?.idempotent);
show('groups.state (before send)', await c.call('groups.state', { room_id }));
const t0 = Date.now();
const sent = await c.call('groups.send', { room_id, event_id: 'u-' + Date.now(), payload: { text: 'Hi both! Each of you say hello in one short sentence. @beta also tell @alpha a fun fact.', thread_id: 'main' } });
show('groups.send', sent);
let since = 0; const all = []; const states = [];
for (let i = 0; i < 120; i++) {
  const st = await c.call('groups.state', { room_id });
  states.push({ t: Date.now() - t0, ds: st.driver_status });
  const log = await c.call('groups.log', { room_id, since_seq: since, limit: 100 });
  for (const e of log.events) { all.push(e); console.log(`+${Date.now() - t0}ms seq=${e.seq} kind=${e.kind} actor=${JSON.stringify(e.actor)} payload=${JSON.stringify(e.payload).slice(0, 300)}`); }
  since = log.cursor;
  if (all.some((e) => e.kind === 'room.activity')) break;
  await sleep(1500);
}
show('driver_status samples (dedup)', states.filter((s, i) => i === 0 || JSON.stringify(s.ds) !== JSON.stringify(states[i - 1].ds)));
show('full log page', await c.call('groups.log', { room_id, since_seq: 0, limit: 5 }));
const wc = {}; for (const e of watcher.events) wc[e.type] = (wc[e.type] || 0) + 1;
const rc = {}; for (const e of c.events) rc[e.type] = (rc[e.type] || 0) + 1;
show('pushed events on caller / watcher connections', { caller: rc, watcher: wc });
// can a client see the hidden per-member room session?
show('session.list hidden Group sessions for A', await c.tryCall('session.list', { profile: A, include_hidden: true, limit: 10 }));
show('groups.list', await c.call('groups.list', {}));
show('groups.rename', await c.tryCall('groups.rename', { room_id, event_id: 'rn-' + Date.now(), name: 'Renamed room' }));
show('groups.stop (idle)', await c.tryCall('groups.stop', { room_id }));
if (!keep) show('groups.disband', await c.tryCall('groups.disband', { room_id }));
show('groups.list include_disbanded', (await c.call('groups.list', { include_disbanded: true })).rooms.map((r) => ({ room_id: r.room_id, name: r.name, disbanded_at: r.disbanded_at })));
console.log('ROOM_ID', room_id);
c.close(); watcher.close();
