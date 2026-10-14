// Self-contained helpers for the models/onboarding probes (Node 22+, no deps).
// HERMES_URL (default http://localhost:18789); token scraped from the SPA HTML like the proxy does.
export const BASE = process.env.HERMES_URL || 'http://localhost:18789';
let _tok;
export async function token() {
  if (_tok) return _tok;
  const m = (await (await fetch(BASE + '/')).text()).match(/__HERMES_SESSION_TOKEN__="([^"]+)"/);
  if (!m) throw new Error('session token not found');
  return (_tok = m[1]);
}
export async function rest(method, path, body, { auth = true } = {}) {
  const headers = {};
  if (auth) headers['X-Hermes-Session-Token'] = await token();
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
// JSON-RPC over /api/ws?token=… (newline-delimited JSON-RPC 2.0; first frame is event gateway.ready)
export async function gw() {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/api/ws?token=' + encodeURIComponent(await token()));
  const pending = new Map(); const events = []; let id = 0;
  ws.addEventListener('message', (m) => {
    for (const line of String(m.data).split('\n').filter(Boolean)) {
      const f = JSON.parse(line);
      if (f.id != null && pending.has(f.id)) { const p = pending.get(f.id); pending.delete(f.id); p(f); }
      else events.push(f);
    }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  // returns the raw frame ({result} or {error}) so error shapes can be documented
  const call = (method, params = {}, ms = 60000) => new Promise((res, rej) => {
    const i = `m-${++id}`; pending.set(i, res); ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, ms);
  });
  return { ws, call, events, close: () => ws.close() };
}
export const show = (label, v) => console.log(`\n=== ${label} ===\n` + JSON.stringify(v, null, 2));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
