// A scripted, OpenAI-compatible model for the contract suite: Hermes talks to
// it like any custom endpoint, so the suite needs no API key and every turn is
// deterministic. A test steers the reply with directives in its message:
//
//   [[say: text]]          answer with exactly `text`
//   [[silent]]             answer "[SILENT]" (a routine with nothing to report)
//   [[tool: name {json}]]  call a tool with those arguments, then answer
//                          "[[tool done]]" once Hermes sends back its result
//   [[slow: ms]]           stream the answer a word at a time, `ms` apart
//   [[fail]]               refuse the request (400), an error Hermes won't retry
//
// Anything else gets "pong". Requests without tools (titles and other side
// calls Hermes makes) always get a short plain answer. Every request is kept,
// and GET /_requests returns them, so a test can see what Hermes asked.

import http from 'node:http'
import type { AddressInfo } from 'node:net'

export const MODELS = ['murmur-fake-small', 'murmur-fake-large']

type Message = { role: string; content?: unknown; tool_calls?: unknown[] }
type Body = { model?: string; stream?: boolean; messages?: Message[]; tools?: unknown[] }

export type Reply =
  | { kind: 'text'; text: string; delayMs?: number }
  | { kind: 'tool'; name: string; args: string }
  | { kind: 'fail' }

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? ''))).join('')
      : ''

/** What to answer, from the newest message Hermes sent. Exported for the suite's own unit test. */
export function decide(body: Body): Reply {
  const messages = body.messages ?? []
  const last = messages.at(-1)
  if (!body.tools?.length) return { kind: 'text', text: 'Contract test' }
  if (last?.role === 'tool') return { kind: 'text', text: '[[tool done]]' }

  const lastUser = textOf([...messages].reverse().find((m) => m.role === 'user')?.content)
  if (/\[\[fail\]\]/.test(lastUser)) return { kind: 'fail' }
  const tool = lastUser.match(/\[\[tool:\s*([\w.-]+)\s*(\{[\s\S]*?\})\s*\]\]/)
  if (tool) return { kind: 'tool', name: tool[1], args: tool[2] }
  const delayMs = Number(lastUser.match(/\[\[slow:\s*(\d+)\s*\]\]/)?.[1] ?? 0) || undefined
  if (/\[\[silent\]\]/.test(lastUser)) return { kind: 'text', text: '[SILENT]', delayMs }
  const say = lastUser.match(/\[\[say:\s*([\s\S]*?)\]\]/)
  return { kind: 'text', text: say ? say[1].trim() : 'pong', delayMs }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function startFakeModel(port = 0) {
  const requests: { path: string; body: Body }[] = []
  let calls = 0

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', async () => {
      const path = (req.url ?? '/').split('?')[0]
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(value))
      }
      let body: Body = {}
      try {
        body = raw ? (JSON.parse(raw) as Body) : {}
      } catch {}

      if (req.method === 'GET' && path === '/_requests') return send(200, requests)
      if (req.method === 'GET' && path === '/v1/models') {
        return send(200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model', created: 1760000000, owned_by: 'murmur' })) })
      }
      if (req.method !== 'POST' || path !== '/v1/chat/completions') return send(404, { error: { message: `No route ${req.method} ${path}` } })

      requests.push({ path, body })
      const reply = decide(body)
      if (reply.kind === 'fail') return send(400, { error: { message: 'The fake model refused this request', type: 'invalid_request_error' } })

      const model = body.model ?? MODELS[0]
      const id = `fake-${++calls}`
      const usage = { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
      const toolCall = reply.kind === 'tool' ? { id: `call_${calls}`, type: 'function', function: { name: reply.name, arguments: reply.args } } : null
      const finish = toolCall ? 'tool_calls' : 'stop'

      if (!body.stream) {
        const message = toolCall ? { role: 'assistant', content: null, tool_calls: [toolCall] } : { role: 'assistant', content: reply.kind === 'text' ? reply.text : '' }
        return send(200, { id, object: 'chat.completion', created: 1, model, choices: [{ index: 0, message, finish_reason: finish }], usage })
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const chunk = (delta: unknown, finishReason: string | null = null, extra = {}) =>
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: finishReason }], ...extra })}\n\n`)
      chunk({ role: 'assistant', content: '' })
      if (toolCall) {
        chunk({ tool_calls: [{ index: 0, ...toolCall }] })
      } else if (reply.kind === 'text') {
        const words = reply.delayMs ? reply.text.split(/(?<= )/) : [reply.text]
        for (const word of words) {
          if (res.destroyed) return
          chunk({ content: word })
          if (reply.delayMs) await sleep(reply.delayMs)
        }
      }
      chunk({}, finish)
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model, choices: [], usage })}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })

  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

// `node test/contract/fake-model.ts` runs it on its own (PORT, default 18990).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startFakeModel(Number(process.env.PORT ?? 18990))
  console.log(`Fake model on :${port}`)
}
