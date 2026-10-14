// Live: hosted-room details — @mention routing, live-watching a member's hidden "Group: <room>" session,
// groups.stop mid-round, roster change attempt (create same room_id with different members).
// Usage: node ar-06-room-routing-stop.mjs [profileA] [profileB]
import { connect, show, sleep } from './ar-lib.mjs';
const [A = 'murmur-test-alpha', B = 'murmur-test-beta'] = process.argv.slice(2);
const c = await connect({ label: 'room' });
const room_id = 'murmur-test-room-' + Date.now().toString(36);
const members = [
  { member_id: A, profile: A, handle: 'alpha', display_name: 'Alpha' },
  { member_id: B, profile: B, handle: 'beta', display_name: 'Beta' },
];
await c.call('groups.create', { room_id, name: 'Routing test', members });
show('re-create with different roster (member add/remove attempt)', await c.tryCall('groups.create', { room_id, name: 'Routing test', members: [...members, { member_id: 'default', profile: 'default', handle: 'hermes' }] }));
let since = 0;
const drain = async (label) => {
  const log = await c.call('groups.log', { room_id, since_seq: since, limit: 100 });
  for (const e of log.events) console.log(`[${label}] seq=${e.seq} ${e.kind} ${e.actor.id} ${JSON.stringify(e.payload.text ?? e.payload.status ?? e.payload.reason ?? e.payload.reason_code ?? e.payload.passed ?? '').slice(0, 140)}`);
  since = log.cursor; return log.events;
};
const until = async (label, pred, ms = 180000) => { const t = Date.now(); let got = []; while (Date.now() - t < ms) { got = got.concat(await drain(label)); if (got.some(pred)) return got; await sleep(1000); } return got; };

// 1) mention routing: only @alpha addressed
await c.call('groups.send', { room_id, event_id: 'u1-' + Date.now(), payload: { text: '@alpha what is 2+2? Answer with just the number.', thread_id: 'main' } });
// try to attach to alpha's hidden room session while it runs
await sleep(1500);
const watch = await connect({ label: 'watch' });
const res = await watch.tryCall('session.resume', { session_id: `Group: ${room_id}`, profile: A, omit_messages: true });
show('watcher session.resume "Group: <room>" (alpha)', res.ok ? { session_id: res.result.session_id, running: res.result.running, status: res.result.status, info_title: res.result.info?.title } : res);
const r1 = await until('mention', (e) => e.kind === 'room.activity');
const wc = {}; for (const e of watch.events) wc[e.type] = (wc[e.type] || 0) + 1;
show('events pushed to watcher that resumed the hidden member session', wc);
show('who spoke for "@alpha …"', r1.filter((e) => e.kind === 'message.member').map((e) => e.actor.id));
if (res.ok) show('prompt.submit into hosted room session (expect 4122)', await watch.tryCall('prompt.submit', { session_id: res.result.session_id, text: 'hi' }));
watch.close();

// 2) stop mid-round
await c.call('groups.send', { room_id, event_id: 'u2-' + Date.now(), payload: { text: 'Everyone: write a 300-word story about a lighthouse.', thread_id: 'main' } });
await sleep(2500);
show('groups.state while working', (await c.call('groups.state', { room_id })).driver_status);
show('groups.stop mid-round', await c.tryCall('groups.stop', { room_id }));
await sleep(3000);
await until('stop', () => true, 3000);
show('groups.state after stop', (await c.call('groups.state', { room_id })).driver_status);
show('groups.disband', (await c.tryCall('groups.disband', { room_id })).ok);
c.close();
