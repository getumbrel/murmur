// Trigger the clarify tool and answer it (single question). ANSWER env overrides the reply.
import { connect } from './lib.mjs'
const c = await connect({ label: 'c', maxLog: 900, onRequest: (f, cl) => {
  if (f.method === 'clarify') {
    const p = f.params
    const answer = p.questions ? { answers: Object.fromEntries(p.questions.map(q => [q.qid, q.choices?.[0] ?? 'yes'])) }
      : { answer: process.env.ANSWER || p.choices?.[1] || 'blue' }
    setTimeout(() => cl.respond(f.id, answer), 1000)
  } else cl.fail(f.id, -32601, 'unhandled')
} })
await c.rpc('client.capabilities', { server_requests: true })
const { session_id: sid } = await c.rpc('session.create', {})
const done = c.waitEvent(e => e.session_id === sid && e.type === 'message.complete', 180000)
await c.rpc('prompt.submit', { session_id: sid, text: process.env.PROMPT || 'Before answering, use your clarify tool to ask me ONE question: which colour I prefer, with exactly the choices "red" and "blue". Then tell me a one-line fact about my chosen colour.' })
await done
c.close()
