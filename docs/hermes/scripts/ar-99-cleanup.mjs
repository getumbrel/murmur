// Cleanup: disband every live murmur-test-* room, close live sessions of murmur-test-* profiles is implicit in
// profile delete (REST DELETE stops/rmtree's the profile dir). Deletes every murmur-test-* profile.
import { connect, rest, show } from './ar-lib.mjs';
const c = await connect();
const rooms = (await c.call('groups.list', { limit: 500 })).rooms.filter((r) => r.room_id.startsWith('murmur-test-') || r.members.some((m) => m.profile?.startsWith('murmur-test-')));
for (const r of rooms) show('disband ' + r.room_id, await c.tryCall('groups.disband', { room_id: r.room_id }));
c.close();
const profiles = (await rest('GET', '/api/profiles')).body.profiles.filter((p) => p.name.startsWith('murmur-test-'));
for (const p of profiles) show('DELETE ' + p.name, await rest('DELETE', `/api/profiles/${p.name}`));
show('remaining profiles', (await rest('GET', '/api/profiles')).body.profiles.map((p) => p.name));
