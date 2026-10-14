// API-key onboarding flow on a TEST profile with fake keys: validate -> PUT /api/env -> options ->
// recommended-default -> /api/model/set -> runtime_check -> DELETE /api/env, then restore the
// profile's model. Usage: PROFILE=murmur-test-models node models-apikey-flow.mjs
import { rest, gw, show } from './models-lib.mjs';
const P = process.env.PROFILE || 'murmur-test-models';
if (!P.startsWith('murmur-test-')) throw new Error('refusing: test profiles only');
const q = `profile=${P}`;
const FAKE = 'sk-or-v1-' + '0'.repeat(64);

// 1. validate (no profile param: it is a pure probe)
show('validate OPENROUTER_API_KEY (bogus)', await rest('POST', '/api/providers/validate', { key: 'OPENROUTER_API_KEY', value: FAKE }));
show('validate OPENAI_API_KEY (bogus)', await rest('POST', '/api/providers/validate', { key: 'OPENAI_API_KEY', value: 'sk-proj-bogus' }));
show('validate GEMINI_API_KEY (bogus)', await rest('POST', '/api/providers/validate', { key: 'GEMINI_API_KEY', value: 'AIzaBogus' }));
show('validate XAI_API_KEY (bogus)', await rest('POST', '/api/providers/validate', { key: 'XAI_API_KEY', value: 'xai-bogus' }));
show('validate ANTHROPIC_API_KEY (no probe exists)', await rest('POST', '/api/providers/validate', { key: 'ANTHROPIC_API_KEY', value: 'sk-ant-bogus' }));
show('validate empty value', await rest('POST', '/api/providers/validate', { key: 'OPENROUTER_API_KEY', value: '' }));

// 2. persist the key into the TEST profile's .env
show(`PUT /api/env {OPENROUTER_API_KEY, profile}`, await rest('PUT', '/api/env', { key: 'OPENROUTER_API_KEY', value: FAKE, profile: P }));
show(`PUT /api/env redacted preview rejected`, await rest('PUT', '/api/env', { key: 'OPENROUTER_API_KEY', value: '«redacted:sk-o...0000»', profile: P }));
const env = await rest('GET', `/api/env?${q}`);
show('GET /api/env?profile OPENROUTER_API_KEY row', env.body.OPENROUTER_API_KEY);

// 3. what the picker sees now
const opts = await rest('GET', `/api/model/options?${q}`);
const orow = opts.body.providers?.find((r) => r.slug === 'openrouter');
show('options: openrouter row (models truncated to 8)', orow && { ...orow, models: orow.models.slice(0, 8), capabilities: Object.fromEntries(Object.entries(orow.capabilities || {}).slice(0, 4)), featured_models: (orow.featured_models || []).slice(0, 8) });
show('options: provider slugs', opts.body.providers?.map((r) => `${r.slug}:${r.authenticated}:${r.total_models}`));
const rec = await rest('GET', `/api/model/recommended-default?provider=openrouter&${q}`);
show('recommended-default openrouter', rec);

// 4. set it as the profile's main model
const model = rec.body.model || orow?.models?.[0];
let set = await rest('POST', '/api/model/set', { scope: 'main', provider: 'openrouter', model, profile: P });
show(`POST /api/model/set openrouter/${model}`, set);
if (set.body?.confirm_required) {
  set = await rest('POST', '/api/model/set', { scope: 'main', provider: 'openrouter', model, profile: P, confirm_expensive_model: true });
  show('POST /api/model/set (confirm_expensive_model:true)', set);
}
show('POST /api/model/set bad model', await rest('POST', '/api/model/set', { scope: 'main', provider: 'openrouter', model: 'no-such/model-xyz', profile: P }));
show('POST /api/model/set bad scope', await rest('POST', '/api/model/set', { scope: 'nope', provider: 'openrouter', model, profile: P }));
show('POST /api/model/set expensive model w/o confirm', await rest('POST', '/api/model/set', { scope: 'main', provider: 'openrouter', model: 'anthropic/claude-opus-4.6', profile: P }));
show('GET /api/model/info?profile', await rest('GET', `/api/model/info?${q}`));
const g = await gw();
show('setup.runtime_check {profile}', await g.call('setup.runtime_check', { profile: P }));
show('setup.status {profile}', await g.call('setup.status', { profile: P }));

// 5. RPC twins
show('model.save_key {slug:openrouter} (RPC twin)', await g.call('model.save_key', { slug: 'openrouter', api_key: FAKE, profile: P }));
show('model.save_key {slug:xai}', await g.call('model.save_key', { slug: 'xai', api_key: 'xai-bogus-key', profile: P }));
show('model.disconnect {slug:xai}', await g.call('model.disconnect', { slug: 'xai', profile: P }));
show('model.disconnect {slug:xai} again', await g.call('model.disconnect', { slug: 'xai', profile: P }));
g.close();

// 6. remove the key + restore model (per-profile setter)
show('DELETE /api/env {OPENROUTER_API_KEY, profile}', await rest('DELETE', '/api/env', { key: 'OPENROUTER_API_KEY', profile: P }));
show('DELETE /api/env again (404 shape)', await rest('DELETE', '/api/env', { key: 'OPENROUTER_API_KEY', profile: P }));
show('model/info after key removal (model still pinned to openrouter)', await rest('GET', `/api/model/info?${q}`));
const g2 = await gw();
show('setup.runtime_check {profile} after key removal', await g2.call('setup.runtime_check', { profile: P }));
g2.close();
show(`PUT /api/profiles/${P}/model {openai-codex, gpt-6.1-sol}`, await rest('PUT', `/api/profiles/${P}/model`, { provider: 'openai-codex', model: 'gpt-6.1-sol' }));
show(`PUT /api/profiles/${P}/model missing model`, await rest('PUT', `/api/profiles/${P}/model`, { provider: 'openai-codex', model: '' }));
show('model/info after restore', await rest('GET', `/api/model/info?${q}`));
