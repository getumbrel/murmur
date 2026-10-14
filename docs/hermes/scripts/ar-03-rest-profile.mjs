// Live: REST profile CRUD — POST /api/profiles, PUT soul/description/model, PATCH rename, DELETE.
// Usage: node ar-03-rest-profile.mjs [name] [--keep]   (--keep skips the rename+delete at the end)
import { rest, show } from './ar-lib.mjs';
const name = process.argv[2] || 'murmur-test-beta';
const keep = process.argv.includes('--keep');
show('POST /api/profiles', await rest('POST', '/api/profiles', { name, description: 'Second test agent' }));
show('PUT soul', await rest('PUT', `/api/profiles/${name}/soul`, { content: '# Beta\n\nYou are Beta, a cheerful test agent. One short sentence per reply.' }));
show('PUT description', await rest('PUT', `/api/profiles/${name}/description`, { description: 'Cheerful tester' }));
show('PUT model (missing provider → 400)', await rest('PUT', `/api/profiles/${name}/model`, { model: 'gpt-6.1-sol' }));
show('PUT model', await rest('PUT', `/api/profiles/${name}/model`, { provider: 'openai-codex', model: 'gpt-6.1-sol' }));
show('POST invalid name', await rest('POST', '/api/profiles', { name: 'Bad Name!' }));
show('POST reserved name', await rest('POST', '/api/profiles', { name: 'test' }));
show('POST duplicate', await rest('POST', '/api/profiles', { name }));
show('GET row', (await rest('GET', '/api/profiles')).body.profiles.find((p) => p.name === name));
if (!keep) {
  show('PATCH rename', await rest('PATCH', `/api/profiles/${name}`, { new_name: name + '-renamed' }));
  show('DELETE', await rest('DELETE', `/api/profiles/${name}-renamed`));
  show('DELETE default (refused)', await rest('DELETE', `/api/profiles/default`));
}
