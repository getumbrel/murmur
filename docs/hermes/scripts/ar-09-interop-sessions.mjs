// Live: Desktop Bot Mode interop (ui_meta['hermes-bots'] → bot_title), CAS on ui_meta, avatar clear,
// per-profile session listing (RPC + REST), unread flag, session close/delete.
// Usage: node ar-09-interop-sessions.mjs [profile]
import { connect, rest, show } from './ar-lib.mjs';
const P = process.argv[2] || 'murmur-test-alpha';
const c = await connect();
const meta = { shape: 'blobatar:k3j9x2qa:round', color: '#22c55e', imageKind: 'shape', title: 'Research Lead', created: Date.now() };
show('configure ui_meta hermes-bots', await c.call('profiles.configure', { name: P, ui_meta: { 'hermes-bots': meta } }));
const row = (await c.call('profiles.list', { include_sessions: false })).profiles.find((p) => p.name === P);
show('profiles.list ui_meta + revisions', { ui_meta: row.ui_meta, ui_meta_revisions: row.ui_meta_revisions });
show('REST bot_title', (await rest('GET', '/api/profiles')).body.profiles.find((p) => p.name === P).bot_title);
show('CAS with stale revision', await c.call('profiles.configure', { name: P, ui_meta: { 'hermes-bots': { ...meta, title: 'X' } }, ui_meta_expected_revisions: { 'hermes-bots': 0 } }));
show('CAS with right revision', await c.call('profiles.configure', { name: P, ui_meta: { 'hermes-bots': { ...meta, title: 'Research Lead' } }, ui_meta_expected_revisions: { 'hermes-bots': row.ui_meta_revisions['hermes-bots'] } }));
show('ui_meta key delete (null)', await c.call('profiles.configure', { name: P, ui_meta: { murmur: null } }));
show('set_asset bad type (gif)', await c.tryCall('profiles.set_asset', { name: P, asset: 'avatar', data: 'R0lGODlhAQABAAAAACw=' }));
show('set_asset other asset name', await c.tryCall('profiles.set_asset', { name: P, asset: 'banner', data: 'iVBORw0KGgo=' }));
show('set_asset clear', await c.tryCall('profiles.set_asset', { name: P, asset: 'avatar', clear: true }));
show('get_asset after clear', await c.tryCall('profiles.get_asset', { name: P, asset: 'avatar' }));
show('session.list (visible only)', await c.call('session.list', { profile: P, limit: 5 }));
show('session.list include_hidden', await c.call('session.list', { profile: P, limit: 10, include_hidden: true }));
const r = await rest('GET', `/api/profiles/sessions?profile=${P}&limit=5`);
show('REST /api/profiles/sessions?profile= (first row)', { status: r.status, keys: Object.keys(r.body), first: r.body.sessions?.[0], total: r.body.total });
const r2 = await rest('GET', `/api/sessions?profile=${P}&limit=3`);
show('REST /api/sessions?profile= (first row)', { status: r2.status, first: r2.body.sessions?.[0], total: r2.body.total });
const canon = row.canonical_session?.id || (await c.call('session.list', { profile: P, title: 'Bot Chat', include_hidden: true })).sessions[0]?.id;
if (canon) {
  show('PATCH unread true', await rest('PATCH', `/api/sessions/${canon}`, { unread: true, profile: P }));
  show('REST row unread', (await rest('GET', `/api/sessions?profile=${P}&limit=50`)).body.sessions?.find((s) => s.id === canon)?.unread);
  show('PATCH unread false', await rest('PATCH', `/api/sessions/${canon}`, { unread: false, profile: P }));
}
// close + delete a throwaway session
const s = await c.call('session.create', { profile: P, title: 'murmur-test throwaway' });
await c.call('prompt.submit', { session_id: s.session_id, text: 'Reply: ok' });
await c.waitFor((e) => e.session_id === s.session_id && e.type === 'message.complete', 120000);
show('session.delete while live', await c.tryCall('session.delete', { session_id: s.stored_session_id, profile: P }));
show('session.close', await c.tryCall('session.close', { session_id: s.session_id }));
show('session.delete after close', await c.tryCall('session.delete', { session_id: s.stored_session_id, profile: P }));
c.close();
