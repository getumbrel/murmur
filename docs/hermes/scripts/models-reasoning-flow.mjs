// Reasoning effort: global (per profile) vs per-session, and what actually hits the wire.
// Requires the TEST profile to have the fake endpoint active (models-custom-endpoint-flow.mjs --keep)
// and models-fake-openai-server.mjs running with its stdout in FAKE_LOG.
// Usage: PROFILE=murmur-test-models FAKE_LOG=/path/fake.log node models-reasoning-flow.mjs
import { readFileSync } from 'node:fs';
import { gw, show, sleep } from './models-lib.mjs';
const P = process.env.PROFILE || 'murmur-test-models';
if (!P.startsWith('murmur-test-')) throw new Error('refusing: test profiles only');
const LOG = process.env.FAKE_LOG;
const wireBodies = () => (LOG ? readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((r) => r.path === '/v1/chat/completions' && r.body?.messages?.length > 1) : []);
const g = await gw();
const ev = (sid, type) => g.events.filter((f) => f.method === 'event' && f.params?.type === type && (!sid || f.params?.session_id === sid));
async function turn(sid, text) {
  const before = wireBodies().length; const n = ev(sid, 'message.complete').length;
  show(`prompt.submit "${text}"`, await g.call('prompt.submit', { session_id: sid, text }));
  for (let i = 0; i < 120 && ev(sid, 'message.complete').length === n; i++) await sleep(250);
  const done = ev(sid, 'message.complete').at(-1)?.params?.payload;
  const wire = wireBodies().slice(before).map((b) => { const { messages, tools, ...rest } = b.body; return { ...rest, n_messages: messages.length, n_tools: tools?.length ?? 0 }; });
  show('message.complete (text/status)', { text: done?.text, status: done?.status });
  show('wire request(s) seen by fake server (messages/tools elided)', wire);
}
const lastInfo = (sid) => ev(sid, 'session.info').at(-1)?.params?.payload;
const pick = (i) => i && { model: i.model, provider: i.provider, reasoning_effort: i.reasoning_effort, reasoning_effort_wire: i.reasoning_effort_wire };

// 1. Global (profile-level) default: agent.reasoning_effort in the profile's config.yaml
show('config.get reasoning {profile}', await g.call('config.get', { key: 'reasoning', profile: P }));
show('config.set reasoning=high scope=global {profile}', await g.call('config.set', { key: 'reasoning', value: 'high', scope: 'global', profile: P }));
show('config.get reasoning {profile} after', await g.call('config.get', { key: 'reasoning', profile: P }));
show('config.set reasoning=hgih (typo)', await g.call('config.set', { key: 'reasoning', value: 'hgih', profile: P }));

// 2. Session created with an explicit per-session effort (composer pick before first send)
const c = await g.call('session.create', { profile: P, reasoning_effort: 'low', title: 'murmur reasoning probe' });
show('session.create {profile, reasoning_effort:"low"} (info subset)', c.error ?? { session_id: c.result.session_id, stored_session_id: c.result.stored_session_id, info: pick(c.result.info) });
const sid = c.result.session_id;
await turn(sid, 'ping low');
show('session.info (last event)', pick(lastInfo(sid)));

// 3. Change effort on the live session (session-scoped; does not touch config.yaml)
show('config.set reasoning=max {session_id}', await g.call('config.set', { key: 'reasoning', value: 'max', session_id: sid, profile: P }));
show('config.get reasoning {session_id}', await g.call('config.get', { key: 'reasoning', session_id: sid, profile: P }));
show('config.get reasoning {profile} (global unchanged)', await g.call('config.get', { key: 'reasoning', profile: P }));
await turn(sid, 'ping max');
show('config.set reasoning=ultra {session_id}', await g.call('config.set', { key: 'reasoning', value: 'ultra', session_id: sid, profile: P }));
await sleep(500);
show('session.info after ultra', pick(lastInfo(sid)));
await turn(sid, 'ping ultra');
show('config.set reasoning=none {session_id}', await g.call('config.set', { key: 'reasoning', value: 'none', session_id: sid, profile: P }));
await turn(sid, 'ping none');
show('config.set reasoning=show (display word, not an effort)', await g.call('config.set', { key: 'reasoning', value: 'show', session_id: sid, profile: P }));
show('config.set reasoning on stale session_id', await g.call('config.set', { key: 'reasoning', value: 'low', session_id: 'stale-id', profile: P }));

// 4. Per-session model pin at create time
const c2 = await g.call('session.create', { profile: P, model: 'murmur-fake-small', provider: 'murmur-fake-local' });
show('session.create {model, provider} (info subset)', c2.error ?? { session_id: c2.result.session_id, info: pick(c2.result.info) });
await turn(c2.result.session_id, 'ping inherit');

// cleanup sessions
for (const r of [c.result, c2.result]) {
  show('session.close', await g.call('session.close', { session_id: r.session_id }));
  show('session.delete (stored)', await g.call('session.delete', { session_id: r.stored_session_id, profile: P }));
}
show('config.set reasoning=medium scope=global {profile} (restore)', await g.call('config.set', { key: 'reasoning', value: 'medium', scope: 'global', profile: P }));
g.close();
