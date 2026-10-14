// Live: can a client stream a hosted-room member's turn (deltas) by attaching to the member's hidden
// "Group: <room_id>" session? Resumes each member's session BEFORE sending, then prints every non-delta frame.
// Usage: node ar-07-room-live-stream.mjs [profileA] [profileB]
import { connect, show, sleep } from './ar-lib.mjs';
const [A = 'murmur-test-alpha', B = 'murmur-test-beta'] = process.argv.slice(2);
const c = await connect({ label: 'room' });
const room_id = 'murmur-test-room-' + Date.now().toString(36);
const members = [{ member_id: A, profile: A, handle: 'alpha' }, { member_id: B, profile: B, handle: 'beta' }];
await c.call('groups.create', { room_id, name: 'Stream test', members });
// Member sessions don't exist until the first turn. Send, then attach as soon as the session exists.
await c.call('groups.send', { room_id, event_id: 'u-' + Date.now(), payload: { text: 'Everyone: name one colour, one word only.', thread_id: 'main' } });
const sess = {};
const w = await connect({ label: 'watch' });
for (let i = 0; i < 40 && Object.keys(sess).length < 2; i++) {
  for (const p of [A, B]) {
    if (sess[p]) continue;
    const l = await w.call('session.list', { profile: p, title: `Group: ${room_id}`, include_hidden: true });
    if (l.sessions[0]) { const r = await w.tryCall('session.resume', { session_id: l.sessions[0].id, profile: p, omit_messages: true }); if (r.ok) { sess[p] = r.result.session_id; console.log('attached', p, l.sessions[0].id, '→ runtime', r.result.session_id, 'running=', r.result.running, 'status=', r.result.status); } }
  }
  await sleep(500);
}
const waitSettled = async (n) => { const t = Date.now(); while (Date.now() - t < 120000) { const l = await c.call('groups.log', { room_id, since_seq: 0, limit: 100 }); if (l.events.filter((e) => e.kind === 'room.activity').length >= n) return; await sleep(1000); } };
await waitSettled(1);
// Sessions now exist and are live in-process: re-attach, then send a 2nd message and watch.
for (const p of [A, B]) { const l = await w.call('session.list', { profile: p, title: `Group: ${room_id}`, include_hidden: true }); const r = await w.tryCall('session.resume', { session_id: l.sessions[0].id, profile: p, omit_messages: true }); sess[p] = r.result?.session_id; console.log('re-attached', p, '→ runtime', sess[p], 'running=', r.result?.running); }
w.events.length = 0;
await c.call('groups.send', { room_id, event_id: 'u2-' + Date.now(), payload: { text: 'Everyone: count from 1 to 15 in words, comma separated.', thread_id: 'main' } });
await waitSettled(2);
const t = Date.now();
while (Date.now() - t < 120000) { const l = await c.call('groups.log', { room_id, since_seq: 0, limit: 100 }); if (l.events.some((e) => e.kind === 'room.activity')) break; await sleep(1000); }
const bySid = Object.fromEntries(Object.entries(sess).map(([p, s]) => [s, p]));
for (const e of w.events) {
  if (e.type === 'gateway.ready' || e.type === 'sessions.changed') continue;
  if (/\.delta$/.test(e.type)) continue;
  console.log(bySid[e.session_id] || e.session_id || '(global)', e.type, JSON.stringify(e.payload || {}).slice(0, 260));
}
const deltas = w.events.filter((e) => e.type === 'message.delta').map((e) => `${bySid[e.session_id]}:${e.payload.text}`);
show('message.delta frames (member:text)', deltas);
const log = await c.call('groups.log', { room_id, since_seq: 0, limit: 100 });
show('room log', log.events.map((e) => `${e.seq} ${e.kind} ${e.actor.id} ${e.payload.text ?? ''}`));
await c.call('groups.disband', { room_id });
w.close(); c.close();
