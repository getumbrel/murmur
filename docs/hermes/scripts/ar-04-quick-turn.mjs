// Live: one throwaway (non-canonical) turn on a profile to check it is chat-able. Prints final text or error events.
// Usage: node ar-04-quick-turn.mjs <profile> [text]
import { connect, show } from './ar-lib.mjs';
const profile = process.argv[2]; const text = process.argv[3] || 'Reply with the single word: pong';
const c = await connect();
const s = await c.call('session.create', { profile, hidden: true });
show('session.create info', { session_id: s.session_id, stored_session_id: s.stored_session_id, info: { model: s.info.model, profile_name: s.info.profile_name } });
show('prompt.submit', await c.tryCall('prompt.submit', { session_id: s.session_id, text }));
const done = await c.waitFor((e) => e.session_id === s.session_id && ['message.complete', 'error'].includes(e.type), 180000).catch((e) => ({ timeout: e.message }));
show('terminal event', done.payload ? { type: done.type, text: done.payload.text, status: done.payload.status, message: done.payload.message } : done);
for (const e of c.events) if (e.type === 'error' || e.type === 'status.update') console.log('EV', JSON.stringify(e).slice(0, 500));
show('session.delete', await c.tryCall('session.delete', { session_id: s.stored_session_id, profile }));
c.close();
