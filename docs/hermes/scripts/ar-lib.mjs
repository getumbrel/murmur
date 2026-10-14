// Helpers for the agents-and-rooms probes (Node 22, no deps: global fetch + WebSocket).
// Env: HERMES_URL (default http://localhost:18789). Token is scraped from the dashboard HTML
// exactly like the same-origin proxy injects it. LOG=1 prints every pushed event.
export const BASE = process.env.HERMES_URL || 'http://localhost:18789';

let _token;
export async function token() {
  if (_token) return _token;
  const html = await (await fetch(BASE + '/')).text();
  const m = html.match(/__HERMES_SESSION_TOKEN__="([^"]+)"/);
  if (!m) throw new Error('session token not found in dashboard HTML');
  return (_token = m[1]);
}

export async function rest(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-Hermes-Session-Token': await token(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

// JSON-RPC 2.0 over /api/ws?token=...  Server pushes {"jsonrpc":"2.0","method":"event","params":{type,session_id?,payload}}.
export async function connect({ log = !!process.env.LOG, label = 'ws', onServerRequest } = {}) {
  const url = BASE.replace(/^http/, 'ws') + '/api/ws?token=' + encodeURIComponent(await token());
  const ws = new WebSocket(url);
  const pending = new Map();
  const events = [];
  const listeners = new Set();
  let nextId = 1;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
    if (msg.id != null && !msg.method && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(Object.assign(new Error(JSON.stringify(msg.error)), { rpc: msg.error })) : res(msg.result);
    } else if (msg.method === 'event') {
      const p = msg.params; p._t = Date.now();
      events.push(p);
      if (log && !/\.delta$/.test(p.type)) console.log(`[${label}] EVENT`, JSON.stringify(p).slice(0, 700));
      for (const l of [...listeners]) l(p);
    } else if (msg.method && msg.id != null) {
      // server->client request (approval/clarify/sudo/secret…). Reply later with
      // {jsonrpc,id,result:{choice}}; without a handler we refuse it immediately.
      if (log) console.log(`[${label}] SERVER REQUEST`, JSON.stringify(msg).slice(0, 700));
      if (onServerRequest) onServerRequest(msg, (result) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })));
      else ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unhandled' } }));
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  const call = (method, params = {}, timeoutMs = 60000) => new Promise((res, rej) => {
    const id = `${label}-${nextId++}`;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeoutMs);
  });
  const waitFor = (pred, timeoutMs = 60000) => new Promise((res, rej) => {
    const hit = events.find(pred); if (hit) return res(hit);
    const l = (m) => { if (pred(m)) { listeners.delete(l); clearTimeout(t); res(m); } };
    listeners.add(l);
    const t = setTimeout(() => { listeners.delete(l); rej(new Error('waitFor timeout')); }, timeoutMs);
  });
  // tolerant call: returns {ok,result}|{ok:false,error}
  const tryCall = async (m, p, t) => { try { return { ok: true, result: await call(m, p, t) }; } catch (e) { return { ok: false, error: e.rpc || e.message }; } };
  await waitFor((e) => e.type === 'gateway.ready', 10000).catch(() => {});
  return { ws, call, tryCall, events, waitFor, close: () => ws.close() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const show = (label, v) => console.log(`\n=== ${label} ===\n` + JSON.stringify(v, null, 2));
