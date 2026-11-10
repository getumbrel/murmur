// A question an agent asks you (Hermes's clarify tool): how long it waits for
// your answer, which Murmur keeps at an hour (src/state/questions.ts); what
// Murmur hears when the agent stops waiting, for the card to say so; and a
// message written instead of an answer, which goes through once the reply has
// stopped rather than after the wait (src/state/chats.ts).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startGateway, stopGateway } from '@/hermes/gateway'
import { JsonRpcGatewayClient, type GatewayEvent } from '@/hermes/vendor/json-rpc-gateway'
import type { ServerRequest } from '@/hermes/vendor/json-rpc-channel'
import { QUESTION_WAIT, keepQuestionWait } from '@/state/questions'
import { resultLabel } from '@/features/chat/tool-labels'
import { MURMUR, agentName, api, connect, q, removeAgent, sleep } from './client'

const agent = agentName('questions')
const QUESTION = 'Ask me [[tool: clarify {"questions":[{"question":"Which colour?","choices":["Oat","Slate"]}]}]]'

type Config = { agent?: { clarify_timeout?: unknown } }
const ownWait = async () =>
  (await api.get<Config>(`/api/config?${q(agent)}&include_defaults=false`)).agent?.clarify_timeout
const setWait = (seconds: number) =>
  api.put(`/api/config?${q(agent)}`, { config: { agent: { clarify_timeout: seconds } } })
/** What this Hermes waits by default: 90 seconds from 0.23.1, an hour before. */
const hermesWait = async () => Number((await api.get<Config>('/api/config/defaults')).agent?.clarify_timeout)

/** A chat asking you a question, on a socket that leaves it unanswered, as someone who hasn't looked yet does. */
async function asking() {
  const client = new JsonRpcGatewayClient({ requestIdPrefix: 'q' })
  const events: GatewayEvent[] = []
  let question: ServerRequest | undefined
  client.onEvent((e) => void events.push(e))
  client.onRequest((r) => {
    if (r.method !== 'clarify') return false
    question = r
    return true
  })
  await client.connect(`${MURMUR.replace(/^http/, 'ws')}/hermes/api/ws`)
  const { session_id: chat } = await client.request<{ session_id: string }>('session.create', {
    profile: agent,
    source: 'desktop',
  })
  await client.request('prompt.submit', { session_id: chat, text: QUESTION, profile: agent })
  for (let i = 0; i < 240 && !question; i++) await sleep(250)
  if (!question) throw new Error('No question came')
  /** The first `type` event for this chat, from event number `from` on. */
  const seen = <K extends GatewayEvent['type']>(type: K, from = 0) =>
    events.slice(from).find((e): e is GatewayEvent<K> => e.type === type && e.session_id === chat)
  const until = async <K extends GatewayEvent['type']>(type: K, ms = 60_000, from = 0) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
      const found = seen(type, from)
      if (found) return found
    }
    throw new Error(`No ${type} in ${ms / 1000}s`)
  }
  return { client, chat, question, events, seen, until }
}

beforeAll(async () => {
  startGateway()
  const socket = await connect()
  await socket.request('profiles.create', { name: agent, share_auth: true }, 120_000)
  socket.close()
})

afterAll(async () => {
  await removeAgent(agent)
  stopGateway()
})

describe('a question an agent asks you', () => {
  it('waits an hour for your answer where this Hermes would give up sooner, and a wait set by hand stays', async () => {
    const hermes = await hermesWait()
    await keepQuestionWait(agent)
    // Hermes 0.23.1 on gives up after 90 seconds; before, it waited an hour, and Murmur leaves that be.
    if (hermes < QUESTION_WAIT) expect(Number(await ownWait())).toBe(QUESTION_WAIT)
    else expect(await ownWait()).toBeUndefined()

    await setWait(45)
    await keepQuestionWait(agent)
    expect(Number(await ownWait())).toBe(45)
  })

  it('still waits past 90 seconds with Murmur’s wait, and takes the answer then', async ({ skip }) => {
    const hermes = await hermesWait()
    // An hour already: nothing of Murmur's in play.
    if (hermes >= QUESTION_WAIT) return skip()
    await setWait(hermes)
    await keepQuestionWait(agent)
    const { client, question, seen, until } = await asking()
    try {
      await sleep(100_000)
      expect(seen('request.cancel')).toBeUndefined()
      expect(seen('tool.complete')).toBeUndefined()
      question.respond({ answers: { q0: 'Slate' } })
      const done = (await until('tool.complete')).payload as { result: unknown }
      expect(JSON.stringify(done.result)).toContain('Slate')
      expect(resultLabel('clarify', done.result)).toBeUndefined()
    } finally {
      client.close()
    }
  }, 180_000)

  it('tells Murmur when the agent stops waiting, for the card and the step to say it went unanswered', async () => {
    await setWait(5)
    const { client, seen, until } = await asking()
    try {
      const done = (await until('tool.complete', 90_000)).payload as { result: unknown }
      expect(resultLabel('clarify', done.result)).toBe('Asking you, no answer')
      // The withdrawn question, and why: what turns Murmur's card into "No answer".
      expect(seen('request.cancel')?.payload).toMatchObject({ method: 'clarify', reason: 'timeout' })
    } finally {
      client.close()
    }
  })

  it('takes a message written instead of an answer as soon as the reply has stopped, not after the wait', async () => {
    await setWait(QUESTION_WAIT)
    const { client, chat, events, until } = await asking()
    try {
      // What Murmur does with it (replyInstead): the reply stops, then the message goes in.
      await client.request('session.interrupt', { session_id: chat })
      await until('message.complete', 20_000)
      const sent = Date.now()
      const from = events.length
      for (let tries = 0; ; tries++) {
        try {
          await client.request('prompt.submit', { session_id: chat, text: '[[say: Slate it is]]', profile: agent })
          break
        } catch (e) {
          if ((e as { code?: number }).code !== 4009 || tries > 10) throw e
          await sleep(500)
        }
      }
      // Answered within moments, not an hour.
      const reply = await until('message.complete', 20_000, from)
      expect(String((reply.payload as { text?: unknown }).text)).toContain('Slate it is')
      expect(Date.now() - sent).toBeLessThan(20_000)
    } finally {
      client.close()
    }
  })
})
