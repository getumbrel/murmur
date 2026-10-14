// Model picker data: /api/model/options (full rows for authenticated providers), recommended-default,
// OAuth provider status, custom endpoints, env-key presence. Read-only. Usage: node models-options.mjs [profile]
import { rest, show } from './models-lib.mjs';
const profile = process.argv[2] || '';
const q = profile ? `profile=${encodeURIComponent(profile)}` : '';
const opts = await rest('GET', '/api/model/options' + (q ? '?' + q : ''));
show('GET /api/model/options', opts);
for (const slug of ['openai-codex', 'openrouter', 'nous', 'anthropic']) {
  show(`GET /api/model/recommended-default?provider=${slug}`, await rest('GET', `/api/model/recommended-default?provider=${slug}${q ? '&' + q : ''}`));
}
const oauth = await rest('GET', '/api/providers/oauth' + (q ? '?' + q : ''));
show('GET /api/providers/oauth (logged_in only)', oauth.body.providers?.filter((p) => p.status?.logged_in));
show('GET /api/providers/custom-endpoints', await rest('GET', '/api/providers/custom-endpoints' + (q ? '?' + q : '')));
const env = await rest('GET', '/api/env' + (q ? '?' + q : ''));
show('GET /api/env (is_set rows only)', Object.fromEntries(Object.entries(env.body).filter(([, v]) => v.is_set)));
show('GET /api/env sample rows', Object.fromEntries(['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY', 'OPENAI_BASE_URL'].map((k) => [k, env.body[k]])));
