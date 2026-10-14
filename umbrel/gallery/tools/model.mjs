// A scripted OpenAI-compatible model for the store screenshots: the demo
// Hermes thinks with this, so every reply, work step and approval comes out
// the same each time. Chats are keyed by a phrase in their opening message,
// group turns by the member's @handle.
//
//   PORT=18991 node umbrel/gallery/tools/model.mjs
//
// Hermes reaches it from its container at http://host.docker.internal:18991/v1.

import http from 'node:http'

const PORT = Number(process.env.PORT ?? 18991)
const MODELS = ['qwen3:14b', 'llama3.2:3b']

const TITLES = [
  ['chickpeas', 'Dinner from the pantry'],
  ['Saturday', 'Saturday with Sam'],
  ['rent', 'Friendlier rent reminder'],
  ['5k', 'Running a 5k by December'],
  ['heat pump', 'Heat pump for an older house'],
  ['porch light', 'Porch light at sunset'],
  ['backups', 'Clear out old phone backups'],
]

const CHATS = [
  {
    key: 'chickpeas',
    final: `A warm chickpea and spinach skillet. One pan, about 20 minutes.

1. Soften two sliced garlic cloves in a good glug of olive oil.
2. Add the drained chickpeas with a pinch of cumin and salt, and let them crisp for 6–8 minutes.
3. Fold in the spinach until it just wilts.
4. Finish with the juice of the half lemon and a little zest.

Spoon it over toast or rice, or top it with a fried egg. Want a version that uses up anything else in the fridge?`,
  },
  {
    key: 'Saturday',
    final: `Here's an easy shape for the day:

| Time | Plan |
|---|---|
| 8:00 | Run while it's cool, 30 minutes |
| 9:30 | Farmers market, before the crowds |
| 12:30 | Lunch at home, then a slow afternoon |
| 6:15 | Leave for dinner |
| 7:00 | Dinner with Sam |

Want me to set a reminder for 6:00 so you leave on time?`,
  },
  {
    key: 'rent',
    final: `Here's a warmer version:

> Hi everyone, a quick heads-up that rent is due this Friday. If anything makes that tricky this month, just let me know and we'll sort it out together. Thank you!

It keeps the date clear and drops the fee warning. If you'd still like it in, add: *"Payments after Friday include a small late fee."*`,
  },
  {
    key: '5k',
    final: `Ten minutes is a great place to start, and December gives you plenty of time.

**Three runs a week, 25 minutes each:**
- **Weeks 1–3:** run 2 minutes, walk 1, six times
- **Weeks 4–6:** run 5 minutes, walk 1, four times
- **Weeks 7–9:** run 10, walk 1, run 10
- **Week 10:** your first easy 5k

Go slowly enough that you could chat while you run. I'll check in after your first one. How did today feel?`,
  },
  {
    key: 'heat pump',
    steps: [
      { tools: [['web_search', { query: 'heat pump older house cold climate efficiency' }]] },
      { tools: [['web_search', { query: 'Mass Save heat pump rebate' }]] },
    ],
    final: `Short answer: very likely yes, especially if you heat with oil or electric baseboards today.

- **It works in the cold.** Modern cold-climate heat pumps keep heating well below freezing, so a Boston winter is fine.
- **Older houses need sealing first.** Insulating the attic and sealing drafts lets you buy a smaller, cheaper system.
- **The rebates are generous.** Mass Save offers up to $10,000 for a whole-home system, plus a free home energy assessment.

A good first step is that free assessment. Want me to find out how to book one?`,
  },
  {
    key: 'porch light',
    final: `Here's an automation you can paste into Home Assistant:

\`\`\`yaml
alias: Porch light at sunset
trigger:
  - platform: sun
    event: sunset
    offset: "-00:15:00"
action:
  - service: light.turn_on
    target:
      entity_id: light.porch
\`\`\`

It turns the porch light on 15 minutes before sunset every day. Change \`light.porch\` to the name of your light.`,
  },
  {
    key: 'backups',
    steps: [
      { tools: [['search_files', { pattern: '*backup*', target: 'files', path: '/opt/data/home/Downloads' }]] },
      { tools: [['terminal', { command: 'du -sh --apparent-size ~/Downloads/phone-backups/*' }]] },
      {
        content: 'Found them: three phone backups from 2024, about 41 GB in all. Deleting them can’t be undone, so I’ll check with you first.',
        tools: [['terminal', { command: 'rm -rf ~/Downloads/phone-backups' }]],
      },
    ],
    final: 'Done. The three old backups are gone, and you have about 41 GB free again.',
  },
]

const GROUP = {
  scout: `Good news first: a Friday 9pm landing misses the evening rush, so it's about 25 minutes by taxi into the centre. I'd stay in **Chiado**. It's central, walkable and close to the river.`,
  wren: `Here's a shape for it:

- **Fri** Late check-in and a light dinner nearby
- **Sat** Alfama in the morning before it gets busy, tram 28 back, sunset at a miradouro
- **Sun** Belém and the river, then the airport by 5

@basil, can you pick the meals?`,
  basil: `Happily. Saturday lunch: grilled sardines at a little tasca in Alfama. Sunday: pastéis de nata in Belém, eaten warm with cinnamon. For Friday, keep it simple with petiscos near the hotel.`,
}

let calls = 0
const call = (name, args) => ({ id: `call_${++calls}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text ?? '').join('') : '')
const spoke = new Set()

async function reply(body) {
  const messages = body.messages ?? []
  const u = messages.findLastIndex((m) => m.role === 'user')
  const user = text(messages[u]?.content)

  // Hermes names each chat with a structured side request.
  if (body.response_format?.json_schema?.name === 'session_title') {
    return { content: JSON.stringify({ title: TITLES.find(([k]) => user.includes(k))?.[1] ?? 'New chat' }) }
  }

  // A group turn: "[Discussion: "<room>"] You are @handle, …". Each member speaks once per message.
  const handle = /You are @([a-z0-9_-]+)/.exec(user)?.[1]
  if (user.startsWith('[Discussion') && handle) {
    const turn = `${/User \(user\): (.{0,60})/.exec(user)?.[1]}:${handle}`
    if (spoke.has(turn) || !GROUP[handle]) return { content: '(pass)' }
    spoke.add(turn)
    return { content: GROUP[handle], delay: 45 }
  }

  const chat = CHATS.find((c) => user.includes(c.key))
  if (!chat) return { content: 'Okay.' }
  const step = messages.slice(u + 1).filter((m) => m.role === 'assistant' && m.tool_calls?.length).length
  if (process.env.DEBUG && step) console.error(JSON.stringify(messages.at(-1)).slice(0, 600))
  const next = chat.steps?.[step]
  if (!next) return { content: chat.final, delay: 18 }
  await new Promise((r) => setTimeout(r, 700))
  return { content: next.content ?? '', tool_calls: next.tools.map(([name, args]) => call(name, args)), delay: 25 }
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

http
  .createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const path = req.url.split('?')[0]
    if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
      // A big window, or Hermes refuses to use tools with it.
      const data = MODELS.map((id) => ({ id, object: 'model', owned_by: 'local', context_length: 131072 }))
      return json(res, 200, { object: 'list', data })
    }
    if (req.method !== 'POST' || path !== '/v1/chat/completions') return json(res, 404, { error: { message: 'not found' } })

    const body = JSON.parse(raw || '{}')
    const model = body.model ?? MODELS[0]
    const { content = '', tool_calls, delay = 0 } = await reply(body)
    const usage = { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 }
    if (!body.stream) {
      const message = { role: 'assistant', content: content || null, ...(tool_calls && { tool_calls }) }
      return json(res, 200, { id: 'c', object: 'chat.completion', model, choices: [{ index: 0, message, finish_reason: tool_calls ? 'tool_calls' : 'stop' }], usage })
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const send = (data) => res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model, ...data })}\n\n`)
    const delta = (d, finish_reason = null) => send({ choices: [{ index: 0, delta: d, finish_reason }] })
    delta({ role: 'assistant', content: '' })
    for (const word of content.match(/\S+\s*|\s+/g) ?? []) {
      delta({ content: word })
      if (delay) await new Promise((r) => setTimeout(r, delay))
    }
    tool_calls?.forEach((tc, index) => delta({ tool_calls: [{ index, ...tc }] }))
    delta({}, tool_calls ? 'tool_calls' : 'stop')
    send({ choices: [], usage })
    res.end('data: [DONE]\n\n')
  })
  .listen(PORT, () => console.log(`Scripted model on :${PORT}`))
