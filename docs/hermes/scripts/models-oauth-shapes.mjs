// OAuth error/edge shapes WITHOUT starting a real device flow (never starts/cancels/polls a real session).
import { rest, show } from './models-lib.mjs';
show('GET /api/providers/oauth/openai-codex/poll/does-not-exist', await rest('GET', '/api/providers/oauth/openai-codex/poll/does-not-exist'));
show('POST /api/providers/oauth/not-a-provider/start', await rest('POST', '/api/providers/oauth/not-a-provider/start'));
show('POST /api/providers/oauth/anthropic/start (external flow)', await rest('POST', '/api/providers/oauth/anthropic/start'));
show('POST /api/providers/oauth/openai-codex/start WITHOUT token (auth check only)', await rest('POST', '/api/providers/oauth/openai-codex/start', undefined, { auth: false }));
show('DELETE /api/providers/oauth/sessions/does-not-exist', await rest('DELETE', '/api/providers/oauth/sessions/does-not-exist'));
show('DELETE /api/providers/oauth/not-a-provider', await rest('DELETE', '/api/providers/oauth/not-a-provider'));
show('DELETE /api/providers/oauth/claude-code (external, not disconnectable)', await rest('DELETE', '/api/providers/oauth/claude-code'));
show('GET /api/providers/oauth?profile=no-such-profile', await rest('GET', '/api/providers/oauth?profile=no-such-profile'));
