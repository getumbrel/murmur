import { beforeAll, describe, expect, it } from 'vitest'
import type { Chat } from '@/state/chats'
import type { ChatItem } from '@/features/chat/types'

// compose.ts reaches the browser's per-Hermes storage on load (through media/parse); a bare stand-in is enough here.
let compose: typeof import('./compose')
beforeAll(async () => {
  Object.assign(globalThis, { document: { cookie: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } })
  compose = await import('./compose')
})

const chat = (items: ChatItem[], status: Chat['status'] = 'idle'): Chat => ({
  id: '20261014_101500_abc',
  profile: 'atlas',
  items,
  status,
  ready: true,
})
const user = (text: string): ChatItem => ({ kind: 'user', id: `u-${text}`, text, at: 1 })
const reply = (text: string): ChatItem => ({ kind: 'assistant', id: `a-${text}`, text, streaming: false, at: 2 })

describe('firstLine', () => {
  it('takes the first line of words', () => {
    expect(compose.firstLine('Done! I booked the table.\n\nMore details below.')).toBe('Done! I booked the table.')
  })

  it('drops markdown, code and files', () => {
    expect(compose.firstLine('## **Your plan**\n- one')).toBe('Your plan')
    expect(compose.firstLine('```sh\nrm -rf /\n```\nRan it for you.')).toBe('Ran it for you.')
    expect(compose.firstLine('See [the docs](https://x.y) and `npm test`.')).toBe('See the docs and npm test.')
    expect(compose.firstLine('MEDIA:/opt/data/cache/chart.png\nHere’s the chart.')).toBe('Here’s the chart.')
    expect(compose.firstLine('---\n| a | b |\n|---|---|')).toBe('a b')
  })

  it('keeps it short', () => {
    const line = compose.firstLine('word '.repeat(80))
    expect(line.length).toBeLessThanOrEqual(140)
    expect(line.endsWith('…')).toBe(true)
  })
})

describe('chatNote', () => {
  it('names the agent and quotes the reply', () => {
    const note = compose.chatNote({ kind: 'finished', chat: chat([user('hi'), reply('Hello there.\nHow can I help?')]) }, 'Atlas')
    expect(note).toEqual({
      title: 'Atlas',
      body: 'Hello there.',
      tag: 'murmur:chat:20261014_101500_abc',
      href: '/chat/atlas/20261014_101500_abc',
    })
  })

  it('says nothing about a reply that was stopped or failed', () => {
    const stopped = chat([user('hi'), reply('Hel'), { kind: 'notice', id: 'n', text: 'Stopped' }])
    const failed = chat([user('hi'), { kind: 'error', id: 'e', message: 'Something went wrong.' }])
    expect(compose.chatNote({ kind: 'finished', chat: stopped }, 'Atlas')).toBeNull()
    expect(compose.chatNote({ kind: 'finished', chat: failed }, 'Atlas')).toBeNull()
  })

  it('never quotes an earlier reply', () => {
    const items: ChatItem[] = [user('one'), reply('First answer'), user('two'), { kind: 'tool', id: 't', name: 'x', label: 'Running a command', status: 'done', startedAt: 1 }]
    expect(compose.chatNote({ kind: 'finished', chat: chat(items) }, 'Atlas')?.body).toBe('Finished')
  })

  it('asks for an OK, or asks the question', () => {
    const approval: ChatItem = { kind: 'approval', id: 'p', requestId: 'r', title: 'Run a command', choices: ['once', 'deny'], status: 'pending' }
    const clarify: ChatItem = { kind: 'clarify', id: 'q', requestId: 'r2', questions: [{ qid: '1', question: 'Which day works?' }], status: 'pending' }
    expect(compose.chatNote({ kind: 'needs-you', chat: chat([user('go'), approval], 'waiting') }, 'Atlas')?.body).toBe('Needs your OK')
    expect(compose.chatNote({ kind: 'needs-you', chat: chat([user('go'), clarify], 'waiting') }, 'Atlas')?.body).toBe('Which day works?')
  })

  it('says what a masked prompt is for', () => {
    const login: ChatItem = { kind: 'secret', id: 's', requestId: 'r', ask: 'login', site: 'example.com', status: 'pending' }
    const key: ChatItem = { kind: 'secret', id: 'k', requestId: 'r2', ask: 'key', skill: 'weather', status: 'pending' }
    expect(compose.chatNote({ kind: 'needs-you', chat: chat([user('go'), login], 'waiting') }, 'Atlas')?.body).toBe('Needs your login for example.com')
    expect(compose.chatNote({ kind: 'needs-you', chat: chat([user('go'), key], 'waiting') }, 'Atlas')?.body).toBe('Needs a key for weather')
  })
})

describe('groupNote', () => {
  it('quotes the last word from the group', () => {
    expect(compose.groupNote({ id: 'room 1', name: 'Trip', lastLine: 'Atlas: Sounds good' })).toEqual({
      title: 'Trip',
      body: 'Atlas: Sounds good',
      tag: 'murmur:group:room 1',
      href: '/group/room%201',
    })
  })

  it('says nothing when you had the last word', () => {
    expect(compose.groupNote({ id: 'g', name: 'Trip', lastLine: 'You: anyone?' })).toBeNull()
    expect(compose.groupNote({ id: 'g', name: 'Trip', lastLine: '' })).toBeNull()
  })
})
