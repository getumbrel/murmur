// Live: a hosted-room round keeps running after the client disconnects (mobile tab backgrounded);
// reconnect and catch up with groups.log since_seq. Also checks the 6-member cap and reserved handles.
// Usage: node ar-10-room-offline.mjs [profileA] [profileB]
import { connect, show, sleep } from './ar-lib.mjs';
const [A = 'murmur-test-alpha', B = 'murmur-test-beta'] = process.argv.slice(2);
let c = await connect();
const m = (n) => Array.from({ length: n }, (_, i) => ({ member_id: `m${i}`, profile: i % 2 ? B : A, handle: `h${i}` }));
show('7 members', await c.tryCall('groups.create', { room_id: 'murmur-test-cap7', name: 'cap', members: m(7) }));
show('same profile twice', await c.tryCall('groups.create', { room_id: 'murmur-test-dup', name: 'dup', members: m(2).map((x) => ({ ...x, profile: A })) }));
show('reserved handle "everyone"', await c.tryCall('groups.create', { room_id: 'murmur-test-res', name: 'res', members: [{ member_id: A, profile: A, handle: 'everyone' }, { member_id: B, profile: B, handle: 'beta' }] }));
show('unknown profile', await c.tryCall('groups.create', { room_id: 'murmur-test-unk', name: 'unk', members: [{ member_id: A, profile: A, handle: 'alpha' }, { member_id: 'x', profile: 'murmur-test-nope', handle: 'nope' }] }));
const room_id = 'murmur-test-room-' + Date.now().toString(36);
await c.call('groups.create', { room_id, name: 'Offline test', members: [{ member_id: A, profile: A, handle: 'alpha' }, { member_id: B, profile: B, handle: 'beta' }] });
const sent = await c.call('groups.send', { room_id, event_id: 'u-' + Date.now(), payload: { text: 'Each of you: one word for a happy feeling.', thread_id: 'main' } });
show('send same event_id again (idempotent)', (await c.tryCall('groups.send', { room_id, event_id: sent.client_event_id, payload: { text: 'Each of you: one word for a happy feeling.', thread_id: 'main' } })).result?.event?.idempotent);
c.close(); console.log('disconnected; waiting 30s');
await sleep(30000);
c = await connect();
const log = await c.call('groups.log', { room_id, since_seq: 1, limit: 100 });
show('caught up after reconnect', log.events.map((e) => `${e.seq} ${e.kind} ${e.actor.id} ${e.payload.text ?? e.payload.status ?? ''}`));
await c.call('groups.disband', { room_id });
show('groups.log after disband (default)', await c.tryCall('groups.log', { room_id }));
show('groups.log include_disbanded latest_seq', (await c.tryCall('groups.log', { room_id, include_disbanded: true })).result?.latest_seq);
c.close();
