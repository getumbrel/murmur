// Create (or reuse) the murmur-test-models profile and print its pre-config readiness.
import { rest, gw, show } from './models-lib.mjs';
const P = process.env.PROFILE || 'murmur-test-models';
show('GET /api/profiles (names)', (await rest('GET', '/api/profiles')).body?.profiles?.map?.((p) => p.name) ?? 'see raw');
show(`POST /api/profiles {name:"${P}"}`, await rest('POST', '/api/profiles', { name: P, description: 'Murmur models/onboarding probe (safe to delete)' }));
const g = await gw();
show(`setup.status {profile}`, await g.call('setup.status', { profile: P }));
show(`setup.runtime_check {profile}`, await g.call('setup.runtime_check', { profile: P }));
show(`setup.runtime_check {profile:"no-such"}`, await g.call('setup.runtime_check', { profile: 'no-such-profile' }));
show(`config.get reasoning {profile}`, await g.call('config.get', { key: 'reasoning', profile: P }));
g.close();
show(`GET /api/model/info?profile=${P}`, await rest('GET', `/api/model/info?profile=${P}`));
show(`GET /api/model/options?profile=${P}`, await rest('GET', `/api/model/options?profile=${P}`));
show(`GET /api/providers/oauth?profile=${P} (codex row)`, (await rest('GET', `/api/providers/oauth?profile=${P}`)).body.providers?.find((p) => p.id === 'openai-codex'));
