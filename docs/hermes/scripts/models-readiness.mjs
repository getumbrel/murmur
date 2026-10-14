// Readiness probes: what Desktop onboarding checks (setup.status + setup.runtime_check over /api/ws)
// plus REST signals. Read-only. Usage: node models-readiness.mjs [profile]
import { rest, gw, show } from './models-lib.mjs';
const profile = process.argv[2] || '';
const q = profile ? `?profile=${encodeURIComponent(profile)}` : '';
const p = profile ? { profile } : {};
const g = await gw();
show('setup.status', await g.call('setup.status', p));
show('setup.runtime_check', await g.call('setup.runtime_check', p));
show('setup.runtime_check {provider:"openrouter"}', await g.call('setup.runtime_check', { ...p, provider: 'openrouter' }));
g.close();
show('GET /api/model/info' + q, await rest('GET', '/api/model/info' + q));
const opts = await rest('GET', '/api/model/options' + q);
show('GET /api/model/options' + q + ' (summary)', { status: opts.status, model: opts.body.model, provider: opts.body.provider,
  providers: (opts.body.providers || []).map((r) => ({ slug: r.slug, authenticated: r.authenticated, total_models: r.total_models, source: r.source, is_current: r.is_current })) });
