// Hermes asking before it acts, or asking you for something: approval,
// clarify and masked requests sent to the socket, answered the way the app's
// cards answer them (src/state/chats.ts, src/features/chat/secret-card.tsx).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { approvalText } from '@/features/chat/approval-text'
import type { ApprovalChoice } from '@/features/chat/types'
import { api, connect, newChat, turn, type Socket } from './client'

const inHermes = (...args: string[]) => promisify(execFile)('docker', ['exec', '-w', '/opt/hermes', inject('hermes').container, ...args])

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

describe('masked asks', () => {
  it('asks for a key a skill needs, and saves the answer in the agent’s settings', async () => {
    const skill = '---\nname: contract-skill\ndescription: Needs a key.\nrequired_environment_variables:\n  - name: CONTRACT_SKILL_KEY\n    prompt: Your Contract key\n    help: https://example.com/keys\n---\n\nUse the key.\n'
    await inHermes('sh', '-c', `mkdir -p /opt/data/skills/contract-skill && printf '%s' "$0" > /opt/data/skills/contract-skill/SKILL.md && chown -R 1000:1000 /opt/data/skills`, skill)

    socket = await connect((r) => (r.method === 'secret' ? { value: 'sk-contract-123' } : undefined))
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, 'Load it [[tool: skill_view {"name":"contract-skill"}]]')
    const { params } = await socket.serverRequest('secret')
    // What the card shows: the prompt, and the skill and its help link.
    expect(params).toMatchObject({ session_id: runtime, env_var: 'CONTRACT_SKILL_KEY', prompt: 'Your Contract key', metadata: { skill_name: 'contract-skill', help: 'https://example.com/keys' } })
    expect((await api.get('/api/env')).CONTRACT_SKILL_KEY).toMatchObject({ is_set: true })
  })

  it('declares the login and code asks the way the card answers them', async () => {
    // These fire only on a live sign-in page in Hermes's browser, so the
    // running Hermes's own declarations are checked instead.
    const script = [
      'import json, tui_gateway.contracts.server_requests',
      'from tui_gateway.contracts.registry import SERVER_REQUESTS as R',
      'print(json.dumps({n: {"params": sorted(R[n].params.model_fields), "result": sorted(R[n].result.model_fields), "doc": R[n].doc} for n in ["secret", "vault.save_login", "vault.code"]}))',
    ].join('\n')
    const asks = JSON.parse((await inHermes('python', '-c', script)).stdout)
    expect(asks.secret).toMatchObject({ params: expect.arrayContaining(['env_var', 'prompt', 'metadata']), result: ['value'] })
    expect(asks['vault.save_login']).toMatchObject({ params: expect.arrayContaining(['site', 'origin']), result: ['value'] })
    // The card sends the login as JSON text: {"identifier": …, "password": …}.
    expect(asks['vault.save_login'].doc).toMatch(/JSON \{identifier, password\}/)
    expect(asks['vault.code']).toMatchObject({ params: expect.arrayContaining(['site', 'hint']), result: ['value'] })
  })
})
