import { describe, expect, it } from 'vitest'
import {
  planFromResult,
  reactionsOf,
  settleHelpers,
  todosOf,
  toggled,
  withHelper,
  withPlan,
  withPreview,
  withReactions,
} from './live'
import type { ChatItem } from './types'

const user = (id: string, rowId?: number): ChatItem => ({ kind: 'user', id, text: 'hi', at: 0, rowId })
const reply = (id: string, rowId?: number): ChatItem => ({
  kind: 'assistant',
  id,
  text: 'ok',
  streaming: false,
  at: 0,
  rowId,
})

// As Hermes 0.22's todo_list sends it (tool_progress._normalize_todo_state).
const TODOS = [
  { id: '1', content: 'Find the flaky test', status: 'completed' },
  { id: '2', content: 'Fix the parser', status: 'in_progress' },
  { id: '2a', content: 'Handle empty input', status: 'pending', parent: '2' },
  { id: '3', content: 'Run the suite', status: 'weird' },
]

describe('the plan', () => {
  it('reads a todo list, keeping what it can draw', () => {
    expect(todosOf([...TODOS, { id: 'x', content: '  ' }, null])).toEqual([
      { id: '1', content: 'Find the flaky test', status: 'completed' },
      { id: '2', content: 'Fix the parser', status: 'in_progress' },
      { id: '2a', content: 'Handle empty input', status: 'pending', parent: '2' },
      { id: '3', content: 'Run the suite', status: 'pending' },
    ])
    expect(todosOf('nope')).toBeNull()
  })

  it('finds the list in a stored result, also one that went through tool search', () => {
    const result = JSON.stringify({ todos: TODOS.slice(0, 1), revision: 3, summary: { total: 1 } })
    expect(planFromResult(result)).toEqual({ todos: [todosOf(TODOS)![0]], revision: 3 })
    expect(planFromResult({ results: [{ name: 'todo_list', result }] })?.revision).toBe(3)
    expect(planFromResult('{"error": "bad"}')).toBeNull()
  })

  it('is one card per turn that ticks off in place', () => {
    const todos = todosOf(TODOS)!
    let items = withPlan([user('u1')], todos, 1, 'p1')
    expect(items.map((i) => i.kind)).toEqual(['user', 'plan'])
    items = withPlan(
      [...items, reply('a1')],
      todos.map((t) => ({ ...t, status: 'completed' as const })),
      2,
      'p2',
    )
    expect(items.map((i) => i.id)).toEqual(['u1', 'p1', 'a1'])
    expect(items[1].kind === 'plan' && items[1].todos.every((t) => t.status === 'completed')).toBe(true)
  })

  it('never goes back to an older snapshot, and goes away when emptied', () => {
    const items = withPlan([user('u1')], todosOf(TODOS)!, 5, 'p1')
    expect(withPlan(items, [], 4, 'p2')).toBe(items)
    expect(withPlan(items, [], 6, 'p2').map((i) => i.kind)).toEqual(['user'])
  })

  it('starts fresh in the next turn', () => {
    const items = withPlan([user('u1')], todosOf(TODOS)!, 1, 'p1')
    expect(withPlan([...items, user('u2')], todosOf(TODOS)!, 2, 'p2').map((i) => i.id)).toEqual([
      'u1',
      'p1',
      'u2',
      'p2',
    ])
  })
})

describe('helpers', () => {
  const start = { subagent_id: 'sa-1', goal: 'Compare flight prices', task_index: 0, task_count: 2 }

  it('get a card on first sight, and a live line from what they do', () => {
    let items = withHelper([user('u1')], 'subagent.start', start, 1000)
    items = withHelper(
      items,
      'subagent.tool',
      { ...start, tool_name: 'web_search', tool_preview: 'LIS fares', tool_count: 2 },
      2000,
    )
    const h = items[1]
    expect(h).toMatchObject({
      kind: 'helper',
      subagentId: 'sa-1',
      goal: 'Compare flight prices',
      status: 'running',
      tools: 2,
    })
    expect(h.kind === 'helper' && h.line).toMatch(/^Searching the web/)
  })

  it('finish with how it went, and stay finished', () => {
    let items = withHelper([user('u1')], 'subagent.start', start, 1000)
    items = withHelper(items, 'subagent.complete', { ...start, status: 'completed', summary: 'Cheapest is TAP.' }, 9000)
    expect(items[1]).toMatchObject({ status: 'done', summary: 'Cheapest is TAP.', endedAt: 9000, line: undefined })
    expect(withHelper(items, 'subagent.thinking', start, 9500)).toBe(items)
    const stopped = withHelper([user('u1')], 'subagent.complete', { ...start, status: 'interrupted' }, 1)
    expect(stopped[1]).toMatchObject({ status: 'stopped' })
  })

  it('are told apart by id, or by their place when Hermes sends none', () => {
    let items = withHelper([], 'subagent.start', { goal: 'A', task_index: 0, delegation_id: 'd1' }, 0)
    items = withHelper(items, 'subagent.start', { goal: 'B', task_index: 1, delegation_id: 'd1' }, 0)
    expect(items.map((i) => i.kind === 'helper' && i.subagentId)).toEqual(['d1-0', 'd1-1'])
  })

  it('still running when the turn ends are settled', () => {
    const items = withHelper([], 'subagent.start', start, 0)
    expect(settleHelpers(items, false, 5)[0]).toMatchObject({ status: 'done', endedAt: 5 })
    expect(settleHelpers(items, true, 5)[0]).toMatchObject({ status: 'stopped' })
  })
})

describe('reactions', () => {
  it('read what Hermes stores on a row', () => {
    expect(
      reactionsOf([
        { emoji: '❤️', author: 'user', at: 1 },
        { emoji: '😂', author: 'agent' },
        { emoji: '', author: 'user' },
        { emoji: '👍', author: 'someone' },
      ]),
    ).toEqual([
      { emoji: '❤️', author: 'user' },
      { emoji: '😂', author: 'agent' },
    ])
    expect(reactionsOf({ reactions: [] })).toBeUndefined()
  })

  it('follow tapback rules: one each, the same again takes it back', () => {
    const agent = { emoji: '😂', author: 'agent' as const }
    expect(toggled([agent], '❤️', 'user')).toEqual([agent, { emoji: '❤️', author: 'user' }])
    expect(toggled([agent, { emoji: '❤️', author: 'user' }], '👍', 'user')).toEqual([
      agent,
      { emoji: '👍', author: 'user' },
    ])
    expect(toggled([{ emoji: '❤️', author: 'user' }], '❤️', 'user')).toBeUndefined()
  })

  it('land on their message by row id', () => {
    const items = [user('u1', 1), reply('a1', 2), user('u2', 3)]
    const next = withReactions(items, { rowId: 1, reactions: [{ emoji: '❤️', author: 'agent' }] })
    expect(next[0]).toMatchObject({ reactions: [{ emoji: '❤️', author: 'agent' }] })
    expect(next[2]).toBe(items[2])
  })

  it('find a message not saved yet as the newest of its kind, which learns its row id', () => {
    const items = [user('u1', 1), user('u2')]
    const next = withReactions(items, { rowId: 7, role: 'user', reactions: [{ emoji: '👍', author: 'agent' }] })
    expect(next[1]).toMatchObject({ rowId: 7, reactions: [{ emoji: '👍', author: 'agent' }] })
    // The newest already has another row: nothing to guess.
    expect(withReactions([user('u1', 1)], { rowId: 9, role: 'user', reactions: [] })).toEqual([user('u1', 1)])
  })
})

describe('previews', () => {
  const step = (status: 'running' | 'done'): ChatItem => ({
    kind: 'tool',
    id: 't1',
    name: 'desktop_preview',
    label: 'Opening a page',
    status,
    startedAt: 0,
  })

  it('show under the step that opened them, once', () => {
    const items = withPreview([user('u1'), step('running')], 'https://example.com/a')
    expect(items[1]).toMatchObject({ media: ['https://example.com/a'] })
    expect(withPreview(items, 'https://example.com/a')).toBe(items)
    expect(withPreview([step('done')], 'file:///opt/data/site/index.html')[0]).toMatchObject({
      media: ['/opt/data/site/index.html'],
    })
  })
})

describe('edges', () => {
  const running = (id: string, name = 'browser_navigate'): ChatItem => ({
    kind: 'tool',
    id,
    name,
    label: 'Opening a page',
    status: 'running',
    startedAt: 0,
  })

  it('a preview with no preview step lands on the step still running, and nowhere without one', () => {
    const items = [user('u1'), running('t1'), running('t2')]
    expect(withPreview(items, 'https://example.com')[2]).toMatchObject({ media: ['https://example.com'] })
    // Last turn's steps aren't this preview's.
    const earlier = [user('u1'), running('t1'), user('u2')]
    expect(withPreview(earlier, 'https://example.com')).toBe(earlier)
    expect(withPreview(items, '  ')).toBe(items)
  })

  it('a later turn’s plan leaves the earlier one as it was', () => {
    const first = withPlan([user('u1')], todosOf(TODOS)!, 9, 'p1')
    const next = withPlan([...first, user('u2')], [], 10, 'p2')
    expect(next).toEqual([...first, user('u2')])
  })

  it('a helper that failed or ran out of time reads as an error, and keeps its last line until then', () => {
    const start = { subagent_id: 'sa-2', goal: 'Read the docs' }
    let items = withHelper([], 'subagent.thinking', start, 0)
    expect(items[0]).toMatchObject({ line: 'Thinking', goal: 'Read the docs' })
    items = withHelper(items, 'subagent.progress', { subagent_id: 'sa-2' }, 1)
    expect(items[0]).toMatchObject({ line: 'Thinking', goal: 'Read the docs' })
    expect(withHelper(items, 'subagent.complete', { ...start, status: 'timeout' }, 2)[0]).toMatchObject({
      status: 'error',
    })
    expect(withHelper(items, 'subagent.complete', { ...start, status: 'failed' }, 2)[0]).toMatchObject({
      status: 'error',
    })
  })

  it('a page a helper opens reads as its site', () => {
    const items = withHelper(
      [],
      'subagent.tool',
      { subagent_id: 'sa-3', tool_name: 'web_extract', tool_preview: 'https://www.tap.pt/fares' },
      0,
    )
    expect(items[0].kind === 'helper' && items[0].line).toMatch(/· tap\.pt$/)
  })

  it('settling a turn with no helper running changes nothing', () => {
    const items = [user('u1'), reply('a1')]
    expect(settleHelpers(items, false, 1)).toBe(items)
  })

  it('an agent’s reaction to a reply not saved yet finds the newest reply', () => {
    const items = [reply('a1', 2), user('u2', 3), reply('a2')]
    const next = withReactions(items, { rowId: 4, role: 'assistant', reactions: [{ emoji: '‼️', author: 'agent' }] })
    expect(next[2]).toMatchObject({ rowId: 4, reactions: [{ emoji: '‼️', author: 'agent' }] })
    // Taken back: no reactions left.
    expect(withReactions(next, { rowId: 4 })[2]).toMatchObject({ rowId: 4, reactions: undefined })
  })
})
