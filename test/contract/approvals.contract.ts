// Hermes asking before it acts: approval and clarify requests sent to the
// socket, answered the way the app's cards answer them (src/state/chats.ts).

import { afterEach, describe, expect, it } from 'vitest'
import { approvalText } from '@/features/chat/approval-text'
import type { ApprovalChoice } from '@/features/chat/types'
import { connect, newChat, turn, type Socket } from './client'

let socket: Socket | undefined
afterEach(() => socket?.close())

const risky = 'Tidy up [[tool: terminal {"command":"rm -rf /opt/data/contract-scratch"}]]'

describe('approval', () => {
  it('asks before a risky command, with what the card shows', async () => {
    socket = await connect((r) => (r.method === 'approval' ? { choice: 'deny' } : undefined))
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, risky)
    const { params } = await socket.serverRequest('approval')
    expect(params).toMatchObject({
      session_id: runtime,
      command: 'rm -rf /opt/data/contract-scratch',
      description: expect.any(String),
      choices: expect.arrayContaining(['once', 'deny']),
      pattern_keys: expect.any(Array),
      request_id: expect.any(String),
    })
    // Every choice is one the card has a button for.
    const known: ApprovalChoice[] = ['once', 'session', 'always', 'deny']
    for (const choice of params.choices as string[]) expect(known).toContain(choice)
    const card = approvalText({ command: params.command as string, choices: params.choices as ApprovalChoice[], patternKeys: params.pattern_keys as string[] })
    expect(card).toMatchObject({ title: 'Your agent wants to run a command', command: 'rm -rf /opt/data/contract-scratch' })
  })

  it('blocks the command when denied, and says so in the tool result', async () => {
    socket = await connect((r) => (r.method === 'approval' ? { choice: 'deny' } : undefined))
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, risky)
    const complete = socket.of(runtime).find((e) => e.type === 'tool.complete')!.payload as { result: Record<string, unknown> }
    expect(complete.result).toMatchObject({ status: 'blocked', exit_code: -1, error: expect.stringMatching(/^BLOCKED:/) })
  })

  it('runs the command when allowed once', async () => {
    socket = await connect((r) => (r.method === 'approval' ? { choice: 'once' } : undefined))
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, risky)
    const complete = socket.of(runtime).find((e) => e.type === 'tool.complete')!.payload as { result: Record<string, unknown> }
    expect(complete.result).toMatchObject({ exit_code: 0 })
  })
})

describe('clarify', () => {
  it('asks questions with ids, and takes answers by id', async () => {
    socket = await connect((r) => (r.method === 'clarify' ? { answers: { q0: 'Blue', q1: 'Tue' } } : undefined))
    const { runtime } = await newChat(socket)
    await turn(
      socket,
      runtime,
      'Ask me [[tool: clarify {"questions":[{"question":"Which colour?","choices":["Red","Blue"]},{"question":"Which day?","choices":["Mon","Tue"],"multi_select":true}]}]]',
    )
    const { params } = await socket.serverRequest('clarify')
    expect(params).toMatchObject({
      session_id: runtime,
      questions: [
        { qid: expect.any(String), question: 'Which colour?', choices: expect.any(Array), multi_select: false },
        { qid: expect.any(String), question: 'Which day?', choices: expect.any(Array), multi_select: true },
      ],
    })
    const complete = socket.of(runtime).find((e) => e.type === 'tool.complete')!.payload as { result: { responses: { status: string; user_response: unknown }[] } }
    expect(complete.result.responses.map((r) => r.status)).toEqual(['answered', 'answered'])
    expect(JSON.stringify(complete.result.responses[0].user_response)).toContain('Blue')
  })
})
