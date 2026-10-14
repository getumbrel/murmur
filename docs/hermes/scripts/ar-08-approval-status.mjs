// Live: approval flow + roster status. 1:1 session asks for a dangerous command → server→client "approval"
// request (needs client.capabilities {server_requests:true}); observer connection polls session.active_list
// (expects status "waiting"); we answer deny. Then the same in a hosted room → driver_status.pending_actions + groups.approve.
// Usage: node ar-08-approval-status.mjs [profile] [profileB]
import { connect, show, sleep } from './ar-lib.mjs';
const [P = 'murmur-test-alpha', Q = 'murmur-test-beta'] = process.argv.slice(2);
const CMD = 'rm -rf /tmp/murmur-approval-probe-dir-3';
let srq = null, reply = null;
const c = await connect({ label: 'chat', onServerRequest: (msg, respond) => { srq = msg; reply = respond; console.log('SERVER REQUEST', JSON.stringify(msg)); } });
const obs = await connect({ label: 'obs' });
show('client.capabilities', await c.tryCall('client.capabilities', { server_requests: true }));
const s = await c.call('session.create', { profile: P, hidden: true });
await c.call('prompt.submit', { session_id: s.session_id, text: `Use the terminal tool to run exactly: ${CMD}` });
const t0 = Date.now(); const samples = [];
while (Date.now() - t0 < 120000 && !srq) { const a = await obs.call('session.active_list', {}); const me = a.sessions.find((x) => x.id === s.session_id); samples.push(me?.status); await sleep(700); }
for (let i = 0; i < 3; i++) { await sleep(800); const a = await obs.call('session.active_list', {}); samples.push(a.sessions.find((x) => x.id === s.session_id)?.status); }
show('observer status samples (dedup)', samples.filter((v, i) => v !== samples[i - 1]));
if (srq) {
  reply({ choice: 'deny' }); // answer the server request by id (alternative: RPC approval.respond {session_id, choice, request_id})
  await sleep(1000); const a2 = await obs.call('session.active_list', {}); show('status after deny', a2.sessions.find((x) => x.id === s.session_id)?.status);
}
await c.waitFor((e) => e.session_id === s.session_id && e.type === 'message.complete', 120000).catch(() => {});
show('events seen (non-delta)', c.events.filter((e) => e.session_id === s.session_id && !/\.delta$/.test(e.type)).map((e) => e.type + ' ' + JSON.stringify(e.payload || {}).slice(0, 200)));
await c.tryCall('session.interrupt', { session_id: s.session_id });

// Hosted room approval
const room_id = 'murmur-test-room-' + Date.now().toString(36);
await c.call('groups.create', { room_id, name: 'Approval test', members: [{ member_id: P, profile: P, handle: 'alpha' }, { member_id: Q, profile: Q, handle: 'beta' }] });
await c.call('groups.send', { room_id, event_id: 'u-' + Date.now(), payload: { text: `@alpha use the terminal tool to run exactly: ${CMD}`, thread_id: 'main' } });
let pa = null; const t1 = Date.now();
while (Date.now() - t1 < 120000) { const st = await c.call('groups.state', { room_id }); if (st.driver_status.pending_actions.length) { pa = st.driver_status; break; } const l = await c.call('groups.log', { room_id, since_seq: 1 }); if (l.events.some((e) => e.kind === 'room.activity')) break; await sleep(1000); }
show('room driver_status with pending approval', pa);
if (pa) {
  const act = pa.pending_actions.find((x) => x.kind === 'approval');
  show('groups.approve deny', await c.tryCall('groups.approve', { room_id, member_id: act.member_id, task_id: act.task_id, execution_generation: act.execution_generation, choice: 'deny', request_id: act.request_id }));
}
const t2 = Date.now(); while (Date.now() - t2 < 90000) { const l = await c.call('groups.log', { room_id, since_seq: 0 }); if (l.events.some((e) => e.kind === 'room.activity')) { show('room log', l.events.map((e) => `${e.seq} ${e.kind} ${e.actor.id} ${(e.payload.text ?? e.payload.error ?? e.payload.status ?? '').toString().slice(0, 160)}`)); break; } await sleep(1000); }
await c.call('groups.disband', { room_id });
c.close(); obs.close();
