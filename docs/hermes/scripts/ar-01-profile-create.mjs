// Live: create an agent (profile) via JSON-RPC profiles.create, then configure ui_meta/soul/description,
// set + get an avatar, describe, list. Usage: node ar-01-profile-create.mjs [name]
import { connect, rest, show } from './ar-lib.mjs';
const name = process.argv[2] || 'murmur-test-alpha';
const c = await connect();
show('profiles.create', await c.tryCall('profiles.create', {
  name, description: 'Test agent for Murmur', soul: '# Alpha\n\nYou are Alpha, a terse test agent. Reply in one short sentence.',
}, 120000));
show('profiles.configure ui_meta+description', await c.tryCall('profiles.configure', {
  name, description: 'Terse tester', ui_meta: { murmur: { display_name: 'Alpha', color: '#7c3aed' } },
}));
// 1x1 transparent PNG
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
show('profiles.set_asset avatar', await c.tryCall('profiles.set_asset', { name, asset: 'avatar', data: 'data:image/png;base64,' + png }));
const g = await c.tryCall('profiles.get_asset', { name, asset: 'avatar' });
show('profiles.get_asset avatar (data truncated)', g.ok ? { ...g.result, data: g.result.data?.slice(0, 40) + '…' } : g);
const d = await c.tryCall('profiles.describe', { name });
show('profiles.describe (skills/toolsets truncated)', d.ok ? { ...d.result, skills: `[${d.result.skills?.length}]`, toolsets: d.result.toolsets?.slice(0, 2), mcp_servers: d.result.mcp_servers } : d);
const l = await c.tryCall('profiles.list', { include_sessions: true });
show('profiles.list entry', l.ok ? l.result.profiles.find((p) => p.name === name) : l);
show('REST GET /api/profiles entry', (await rest('GET', '/api/profiles')).body.profiles?.find((p) => p.name === name));
show('REST GET soul', await rest('GET', `/api/profiles/${name}/soul`));
c.close();
