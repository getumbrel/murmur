// Tiny fake OpenAI-compatible (and Ollama-ish) server for live-testing Hermes custom endpoints.
// Usage: PORT=18990 [REQUIRE_KEY=sk-test] node models-fake-openai-server.mjs
// Reachable from the hermes container as http://host.docker.internal:$PORT/v1
// Logs every request (method, path, auth header, JSON body) as one JSON line on stdout.
import http from 'node:http';
const PORT = Number(process.env.PORT || 18990);
const REQUIRE_KEY = process.env.REQUIRE_KEY || '';
const MODELS = ['murmur-fake-small', 'murmur-fake-large'];
const send = (res, status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    console.log(JSON.stringify({ t: new Date().toISOString(), method: req.method, path: req.url, auth: req.headers.authorization || null, body }));
    const path = req.url.split('?')[0];
    if (REQUIRE_KEY && path.startsWith('/v1') && req.headers.authorization !== `Bearer ${REQUIRE_KEY}`)
      return send(res, 401, { error: { message: 'bad key', type: 'invalid_request_error' } });
    if (req.method === 'GET' && path === '/v1/models')
      return send(res, 200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model', created: 1760000000, owned_by: 'murmur' })) });
    if (req.method === 'GET' && path === '/api/tags') // Ollama-native listing shape
      return send(res, 200, { models: MODELS.map((name) => ({ name, model: name, modified_at: '2026-10-01T00:00:00Z', size: 1234, digest: 'x', details: { family: 'fake', parameter_size: '1B', quantization_level: 'Q4_0' } })) });
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      const model = body?.model || MODELS[0];
      const text = `pong from ${model}`;
      if (body?.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        res.write(chunk({ role: 'assistant', content: '' }));
        res.write(chunk({ content: text }));
        res.write(chunk({}, 'stop'));
        res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } })}\n\n`);
        return res.end('data: [DONE]\n\n');
      }
      return send(res, 200, { id: 'c1', object: 'chat.completion', created: 1, model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });
    }
    send(res, 404, { error: { message: `no route ${req.method} ${path}` } });
  });
}).listen(PORT, '::', () => console.error(`fake openai server on :${PORT}${REQUIRE_KEY ? ' (key required)' : ''}`));
