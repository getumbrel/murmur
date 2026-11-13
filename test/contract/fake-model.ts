// A scripted, OpenAI-compatible model for the contract suite: Hermes talks to
// it like any custom endpoint, so the suite needs no API key and every turn is
// deterministic. A test steers the reply with directives in its message:
//
//   [[say: text]]          answer with exactly `text`
//   [[silent]]             answer "[SILENT]" (a routine with nothing to report)
//   [[tool: name {json}]]  call a tool with those arguments, then answer
//                          "[[tool done]]" once Hermes sends back its result
//   [[tools: base64]]      call several tools one after another in the same
//                          turn (base64 of [{name, args}], see `toolsTag`),
//                          then answer "[[tools done]]"
//   [[slow: ms]]           stream the answer a word at a time, `ms` apart
//   [[fail]]               refuse the request (400), an error Hermes won't retry
//   [[limit: s]]           turn the request away at a usage limit (429) that
//                          lifts in `s` seconds, named the way services name it
//                          (Retry-After)
//   [[tokens: n]]          say the request took `n` tokens, as a chat that has
//                          filled the model's context would (Hermes summarizes
//                          the chat's earlier messages before the next turn)
//   [[slow summary: ms]]   anywhere in the chat: Hermes's summary of it takes `ms`
//
// Anything else gets "pong". Requests without tools (titles and other side
// calls Hermes makes) always get a short plain answer. Every request is kept,
// and GET /_requests returns them, so a test can see what Hermes asked.
//
// It also plays a connected app that turns Hermes away: /mcp/unauthorized
// answers 401 and /mcp/missing 404, as an MCP server would. /mcp/umbrel is a
// small umbrelOS: its search and get_photo tools, and a machine's screenshot
// and controls, answering in umbrelOS's shapes (src/features/umbrel/finds.ts,
// src/features/machine/shots.ts), with no sessions, as umbrelOS keeps none.
// And a server that wants a key: everything under /keyed/ is the same, but
// answers 401 without `Bearer ${MODEL_KEY}`.

import http from 'node:http'
import type { AddressInfo } from 'node:net'

export const MODELS = ['murmur-fake-small', 'murmur-fake-large']
export const MODEL_KEY = 'murmur-fake-key'

type Message = { role: string; content?: unknown; tool_calls?: unknown[] }
type Body = { model?: string; stream?: boolean; messages?: Message[]; tools?: unknown[] }

export type Reply =
  /** `delayMs`: between the words it streams; `waitMs`: before it answers at all. */
  | { kind: 'text'; text: string; delayMs?: number; waitMs?: number }
  | { kind: 'tool'; name: string; args: string }
  | { kind: 'fail' }
  | { kind: 'limit'; seconds: number }

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? ''))).join('')
      : ''

/** The directive for several tool calls in one turn, the way a model works through a page. */
export function toolsTag(calls: { name: string; args: Record<string, unknown> }[]) {
  return `[[tools: ${Buffer.from(JSON.stringify(calls)).toString('base64')}]]`
}

/** How many tokens to say the request took: what the newest message asks, or a few. */
export function promptTokens(body: Body) {
  const lastUser = textOf([...(body.messages ?? [])].reverse().find((m) => m.role === 'user')?.content)
  return Number(lastUser.match(/\[\[tokens:\s*(\d+)\s*\]\]/)?.[1] ?? 12)
}

/** What to answer, from the newest message Hermes sent. Exported for the suite's own unit test. */
export function decide(body: Body): Reply {
  const messages = body.messages ?? []
  const last = messages.at(-1)
  if (!body.tools?.length) {
    // A side call: a title, or Hermes summarizing the chat (which quotes it).
    const chat = messages.map((m) => textOf(m.content)).join('\n')
    const waitMs = Number(chat.match(/\[\[slow summary:\s*(\d+)\s*\]\]/)?.[1] ?? 0)
    return { kind: 'text', text: 'Contract test', waitMs: waitMs || undefined }
  }

  // Several tools in a row: the next one for each result Hermes has sent back this turn.
  const userAt = messages.map((m) => m.role).lastIndexOf('user')
  const steps = textOf(messages[userAt]?.content).match(/\[\[tools:\s*([A-Za-z0-9+/=]+)\s*\]\]/)
  if (steps) {
    const calls = JSON.parse(Buffer.from(steps[1], 'base64').toString()) as { name: string; args: unknown }[]
    const done = messages.slice(userAt + 1).filter((m) => m.role === 'tool').length
    if (done < calls.length) return { kind: 'tool', name: calls[done].name, args: JSON.stringify(calls[done].args) }
    return { kind: 'text', text: '[[tools done]]' }
  }

  if (last?.role === 'tool') return { kind: 'text', text: '[[tool done]]' }

  const lastUser = textOf([...messages].reverse().find((m) => m.role === 'user')?.content)
  if (/\[\[fail\]\]/.test(lastUser)) return { kind: 'fail' }
  const limit = lastUser.match(/\[\[limit:\s*(\d+)\s*\]\]/)
  if (limit) return { kind: 'limit', seconds: Number(limit[1]) }
  const tool = lastUser.match(/\[\[tool:\s*([\w.-]+)\s*(\{[\s\S]*?\})\s*\]\]/)
  if (tool) return { kind: 'tool', name: tool[1], args: tool[2] }
  const delayMs = Number(lastUser.match(/\[\[slow:\s*(\d+)\s*\]\]/)?.[1] ?? 0) || undefined
  if (/\[\[silent\]\]/.test(lastUser)) return { kind: 'text', text: '[SILENT]', delayMs }
  const say = lastUser.match(/\[\[say:\s*([\s\S]*?)\]\]/)
  return { kind: 'text', text: say ? say[1].trim() : 'pong', delayMs }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const UMBREL_KEY = `umbrelmcp_${'c'.repeat(32)}_${'d'.repeat(64)}`
export const UMBREL_PHOTO = 'e'.repeat(64)
/** A 1×1 PNG, for the picture get_photo hands back. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
/** A 1×1 JPEG: a machine's screen, as umbrelOS sends it. */
const SCREEN =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKKsk//2Q=='
export const UMBREL_MACHINE = 'ubuntu-desktop'

type Rpc = { jsonrpc?: string; id?: number | string; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }

/** One JSON-RPC message to the fake umbrelOS: its answer, or null for a notification. */
function umbrel(message: Rpc): unknown {
  const answer = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result })
  const text = (value: unknown) => ({ type: 'text', text: JSON.stringify(value, null, 2) })
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  switch (message.method) {
    case 'initialize':
      return answer({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'umbrelOS', version: 'contract' } })
    case 'ping':
      return answer({})
    case 'tools/list':
      return answer({
        tools: [
          {
            name: 'search',
            description: "Search the owner's files and Photos library.",
            inputSchema: { type: 'object', properties: { query: { type: 'string' }, scope: { type: 'string', enum: ['everything', 'files', 'photos'] } }, required: ['query'] },
            annotations: readOnly,
          },
          {
            name: 'get_photo',
            description: 'Get a Photos item and the picture itself.',
            inputSchema: { type: 'object', properties: { id: { type: 'string' }, image: { type: 'boolean' } }, required: ['id'] },
            annotations: readOnly,
          },
          {
            name: 'get_machine_screenshot',
            description: 'Capture the screen of a running granted machine as a JPEG.',
            inputSchema: { type: 'object', properties: { machineId: { type: 'string' } }, required: ['machineId'] },
            annotations: readOnly,
          },
          {
            name: 'control_machine',
            description: 'Use the keyboard and mouse of a running granted machine. Every call returns a screenshot.',
            inputSchema: {
              type: 'object',
              properties: { machineId: { type: 'string' }, action: { type: 'string' }, coordinate: { type: 'array', items: { type: 'integer' } }, text: { type: 'string' } },
              required: ['machineId', 'action'],
            },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
          },
        ],
      })
    case 'tools/call': {
      const { name } = message.params ?? {}
      if (name === 'search')
        return answer({
          content: [
            text({
              status: { available: true },
              understood: { filters: [{ type: 'place', label: 'Big Sur' }], text: 'beach' },
              results: [
                { path: '/Home/Photos/IMG_1.HEIC', name: 'IMG_1.HEIC', type: 'image/heic', kind: 'photo', match: 'visual', score: 0.9, photo: { id: UMBREL_PHOTO, takenAt: '2025-06-14T09:00:00-07:00' } },
                { path: '/Home/Documents/Rental.pdf', name: 'Rental.pdf', type: 'application/pdf', kind: 'document', match: 'text', score: 0.7, snippet: 'private beach access', page: 3 },
              ],
            }),
          ],
        })
      if (name === 'get_photo')
        return answer({ content: [text({ id: UMBREL_PHOTO, kind: 'image', takenAt: '2025-06-14T09:00:00-07:00' }), { type: 'image', data: PIXEL, mimeType: 'image/png' }] })
      if (name === 'get_machine_screenshot' || name === 'control_machine') {
        const { machineId, action } = message.params?.arguments ?? {}
        const screenshot = { width: 1280, height: 800, mimeType: 'image/jpeg' }
        return answer({ content: [text({ machineId, ...(action ? { action } : {}), screenshot }), { type: 'image', data: SCREEN, mimeType: 'image/jpeg' }] })
      }
      return answer({ content: [{ type: 'text', text: `No tool ${name}` }], isError: true })
    }
  }
  return message.id === undefined ? null : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }
}

export async function startFakeModel(port = 0) {
  const requests: { path: string; body: Body; auth?: string }[] = []
  let calls = 0

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', async () => {
      let path = (req.url ?? '/').split('?')[0]
      const auth = req.headers.authorization
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(value))
      }
      let body: Body = {}
      try {
        body = raw ? (JSON.parse(raw) as Body) : {}
      } catch {}

      if (req.method === 'GET' && path === '/_requests') return send(200, requests)
      if (path === '/mcp/unauthorized') return send(401, { error: 'Unauthorized' })
      if (path === '/mcp/umbrel') {
        if (auth !== `Bearer ${UMBREL_KEY}`) return send(401, { error: 'Unauthorized' })
        if (req.method !== 'POST') return send(405, { error: 'Method not allowed' })
        const messages = (Array.isArray(body) ? body : [body]) as Rpc[]
        const answers = messages.map(umbrel).filter((a) => a !== null)
        if (!answers.length) return void res.writeHead(202).end()
        return send(200, Array.isArray(body) ? answers : answers[0])
      }
      if (path === '/mcp/missing') return send(404, { error: 'Not Found' })
      if (path.startsWith('/keyed/')) {
        if (auth !== `Bearer ${MODEL_KEY}`) return send(401, { error: { message: 'Invalid API key', type: 'invalid_request_error' } })
        path = path.slice('/keyed'.length)
      }
      if (req.method === 'GET' && path === '/v1/models') {
        return send(200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model', created: 1760000000, owned_by: 'murmur' })) })
      }
      if (req.method !== 'POST' || path !== '/v1/chat/completions') return send(404, { error: { message: `No route ${req.method} ${path}` } })

      requests.push({ path, body, ...(auth && { auth }) })
      const reply = decide(body)
      if (reply.kind === 'fail') return send(400, { error: { message: 'The fake model refused this request', type: 'invalid_request_error' } })

      if (reply.kind === 'limit') {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(reply.seconds) })
        return void res.end(JSON.stringify({ error: { message: 'Usage limit reached for this plan.', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }))
      }

      const model = body.model ?? MODELS[0]
      const id = `fake-${++calls}`
      const prompt = promptTokens(body)
      const usage = { prompt_tokens: prompt, completion_tokens: 4, total_tokens: prompt + 4 }
      const toolCall = reply.kind === 'tool' ? { id: `call_${calls}`, type: 'function', function: { name: reply.name, arguments: reply.args } } : null
      const finish = toolCall ? 'tool_calls' : 'stop'

      if (reply.kind === 'text' && reply.waitMs) await sleep(reply.waitMs)
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
