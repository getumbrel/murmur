// Local/custom endpoint flow on a TEST profile against models-fake-openai-server.mjs
// (PORT=18990 REQUIRE_KEY=sk-murmur-test). validate -> create -> list -> activate -> options ->
// runtime_check -> delete. Usage: PROFILE=murmur-test-models FAKE_URL=http://host.docker.internal:18990/v1 node models-custom-endpoint-flow.mjs [--keep]
import { rest, gw, show } from './models-lib.mjs';
const P = process.env.PROFILE || 'murmur-test-models';
if (!P.startsWith('murmur-test-')) throw new Error('refusing: test profiles only');
const URL_ = process.env.FAKE_URL || 'http://host.docker.internal:18990/v1';
const KEY = process.env.FAKE_KEY || 'sk-murmur-test';
const q = `profile=${P}`;
const keep = process.argv.includes('--keep');

// A. connectivity probes
show('validate OPENAI_BASE_URL, no key (auth-gated server)', await rest('POST', '/api/providers/validate', { key: 'OPENAI_BASE_URL', value: URL_ }));
show('validate OPENAI_BASE_URL + api_key', await rest('POST', '/api/providers/validate', { key: 'OPENAI_BASE_URL', value: URL_, api_key: KEY }));
show('validate OPENAI_BASE_URL bare host (no /v1)', await rest('POST', '/api/providers/validate', { key: 'OPENAI_BASE_URL', value: URL_.replace(/\/v1$/, ''), api_key: KEY }));
show('validate OPENAI_BASE_URL unreachable', await rest('POST', '/api/providers/validate', { key: 'OPENAI_BASE_URL', value: 'http://host.docker.internal:1/v1' }));
show('custom-endpoints/validate wrong key', await rest('POST', '/api/providers/custom-endpoints/validate', { name: 'x', base_url: URL_, model: '', api_key: 'wrong' }));
show('custom-endpoints/validate ok', await rest('POST', '/api/providers/custom-endpoints/validate', { name: 'x', base_url: URL_, model: '', api_key: KEY }));
show('custom-endpoints/validate unreachable', await rest('POST', '/api/providers/custom-endpoints/validate', { name: 'x', base_url: 'http://host.docker.internal:1/v1', model: '' }));

// B. create (not default) then activate
const body = { name: 'Murmur Fake Local', base_url: URL_, model: 'murmur-fake-small', api_key: KEY, api_mode: '',
  models: ['murmur-fake-small', 'murmur-fake-large'], discover_models: true, make_default: false };
const created = await rest('POST', `/api/providers/custom-endpoints?${q}`, body);
show('POST /api/providers/custom-endpoints', created);
show('POST custom-endpoints missing model', await rest('POST', `/api/providers/custom-endpoints?${q}`, { ...body, model: '' }));
const id = created.body.id;
show('GET /api/providers/custom-endpoints', await rest('GET', `/api/providers/custom-endpoints?${q}`));
show(`POST /api/providers/custom-endpoints/${id}/activate`, await rest('POST', `/api/providers/custom-endpoints/${id}/activate?${q}`));
show('activate unknown id', await rest('POST', `/api/providers/custom-endpoints/nope/activate?${q}`));
const opts = await rest('GET', `/api/model/options?${q}`);
show('options: user-defined row', opts.body.providers?.find((r) => r.is_user_defined));
show('options: top-level model/provider', { model: opts.body.model, provider: opts.body.provider });
show('model/info', await rest('GET', `/api/model/info?${q}`));
show('recommended-default for the endpoint slug', await rest('GET', `/api/model/recommended-default?provider=${id}&${q}`));
// switch model within the endpoint via /api/model/set
show('POST /api/model/set (endpoint, large)', await rest('POST', '/api/model/set', { scope: 'main', provider: id, model: 'murmur-fake-large', profile: P }));
show('model/info after set', await rest('GET', `/api/model/info?${q}`));
const g = await gw();
show('setup.runtime_check {profile}', await g.call('setup.runtime_check', { profile: P }));
g.close();
if (keep) { console.log('\n--keep: leaving endpoint configured'); process.exit(0); }
// C. delete (detaches model.provider when it pointed at this endpoint)
show(`DELETE /api/providers/custom-endpoints/${id}`, await rest('DELETE', `/api/providers/custom-endpoints/${id}?${q}`));
show('DELETE again', await rest('DELETE', `/api/providers/custom-endpoints/${id}?${q}`));
show('model/info after delete', await rest('GET', `/api/model/info?${q}`));
