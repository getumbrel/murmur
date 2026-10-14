// Live: Desktop-compatible canonical "Bot Chat" for a profile: lookup -> create hidden -> title -> prompt -> events.
// Also watches what a SECOND connection (roster observer) sees. Usage: node ar-02-canonical-chat.mjs [profile]
import { connect, show, sleep } from './ar-lib.mjs';
const profile = process.argv[2] || 'murmur-test-alpha';
const c = await connect({ label: 'chat' });
const obs = await connect({ label: 'observer' });
show('lookup session.list {profile,title:"Bot Chat"}', await c.tryCall('session.list', { profile, title: 'Bot Chat', limit: 200, include_hidden: true }));
const created = await c.call('session.create', { profile, title: 'Bot Chat', hidden: true, follow_profile_config: true });
show('session.create (messages/info trimmed)', { ...created, messages: `[${created.messages?.length}]`, info: created.info });
const sid = created.session_id;
show('session.title', await c.tryCall('session.title', { session_id: sid, title: 'Bot Chat' }));
show('lookup again', await c.tryCall('session.list', { profile, title: 'Bot Chat', limit: 200, include_hidden: true }));
const t0 = Date.now();
show('prompt.submit', await c.tryCall('prompt.submit', { session_id: sid, text: 'Say hello in five words.' }));
// sample active_list from the observer while the turn runs
const samples = [];
const poll = setInterval(async () => { const r = await obs.tryCall('session.active_list', {}); samples.push({ t: Date.now() - t0, r: r.ok ? r.result.sessions.map((s) => ({ id: s.id, status: s.status, title: s.title })) : r.error }); }, 700);
await c.waitFor((e) => e.type === 'message.complete' && e.session_id === sid, 180000).catch((e) => console.log('no message.complete', e.message));
await sleep(1500); clearInterval(poll);
// event summary for this connection
const evs = c.events.filter((e) => e.type !== 'gateway.ready');
const counts = {}; for (const e of evs) counts[e.type] = (counts[e.type] || 0) + 1;
show('chat connection event type counts', counts);
for (const e of evs) if (!/\.delta$/.test(e.type)) console.log('EV', JSON.stringify({ ...e, _t: e._t - t0 }).slice(0, 900));
const firstDelta = evs.find((e) => /\.delta$/.test(e.type)); if (firstDelta) console.log('FIRST DELTA', JSON.stringify(firstDelta));
const oc = {}; for (const e of obs.events) oc[e.type] = (oc[e.type] || 0) + 1;
show('observer (other connection) event type counts', oc);
for (const e of obs.events) if (e.type !== 'gateway.ready') console.log('OBS', JSON.stringify(e).slice(0, 600));
show('observer active_list samples', samples);
show('profiles.list canonical_session', (await obs.call('profiles.list', {})).profiles.find((p) => p.name === profile));
const h = await c.tryCall('session.history', { session_id: sid });
show('session.history', h.ok ? h.result.messages?.map((m) => ({ role: m.role, text: (m.text || '').slice(0, 120), display_kind: m.display_kind })) : h);
c.close(); obs.close();
