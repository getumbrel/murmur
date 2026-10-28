import { describe, expect, it } from 'vitest'
import { errandsOf, isYours, sentItems, wakeItems, wakeReason, withSeenHelpers, type SavedRow } from './wake'
import type { ChatItem } from './types'

// As Hermes 0.22.5 saves them: delegate_task's answer to a background call
// (tools/delegate_tool_dispatch.py) and the wake when its helpers are back
// (tui_gateway/session_notifications.py).
const dispatched = (extra: object = {}): SavedRow => ({
  id: 4,
  role: 'tool',
  tool_name: 'delegate_task',
  content: JSON.stringify({
    status: 'dispatched',
    mode: 'background',
    count: 2,
    delegation_id: 'deleg_d390b76f',
    goals: ['Check the support emails', ' Check the feedback emails '],
    subagent_ids: ['sa-1', 'sa-2'],
    ...extra,
  }),
})

const back = (meta: object = {}): SavedRow => ({
  id: 9,
  role: 'user',
  content: '[ASYNC DELEGATION BATCH COMPLETE — deleg_d390b76f] A background fan-out unit you dispatched earlier…',
  display_kind: 'async_delegation_complete',
  display_metadata: {
    display_text: 'Background delegation finished',
    delegation_id: 'deleg_d390b76f',
    task_count: 2,
    completed_count: 2,
    failed_count: 0,
    duration_seconds: 110,
    ...meta,
  },
  timestamp: 1000,
})

// The report under it, a block for each helper, as Hermes writes it for the model.
const REPORT = [
  '[ASYNC DELEGATION BATCH COMPLETE — deleg_d390b76f]',
  'A background fan-out unit you dispatched earlier — 2 subagent(s) — has finished; its consolidated results are below.',
  '',
  'Dispatched: 2026-10-28 12:35:45 (1m 50s ago)   Total duration: 110s',
  '',
  '--- ✓ TASK 1/2: Check the support emails  (status=completed, api_calls=4, 39.5s) ---',
  '```text',
  'Two need you: the ASUS RMA and a refund.',
  '```',
  'Full live transcript (complete tool/assistant trace): /tmp/deleg_d390b76f-0.jsonl',
  '',
  '--- ✗ TASK 2/2: Check the feedback emails  (status=timeout, api_calls=12, 101.2s) ---',
  '(no summary — status=timeout: ran past 100s)',
].join('\n')

const helpers = (items: ChatItem[]) => items.flatMap((i) => (i.kind === 'helper' ? [i] : []))

describe('who said it', () => {
  it('is you unless Hermes marked the message, or marked it as one you sent mid-reply', () => {
    expect(isYours({ role: 'user' })).toBe(true)
    expect(isYours({ role: 'user', display_kind: null })).toBe(true)
    expect(isYours({ role: 'user', display_kind: 'steer' })).toBe(true)
    for (const kind of ['async_delegation_complete', 'process_complete', 'auto_continue', 'hidden', 'model_switch'])
      expect(isYours({ role: 'user', display_kind: kind })).toBe(false)
    expect(isYours({ role: 'assistant' })).toBe(false)
  })

  it('reads why Hermes woke the agent from how it marked the message, never from its words', () => {
    expect(wakeReason({ role: 'user', display_kind: 'async_delegation_complete' })).toBe('helpers')
    expect(wakeReason({ role: 'user', display_kind: 'process_complete' })).toBe('command')
    expect(wakeReason({ role: 'user', display_kind: 'auto_continue' })).toBe('resume')
    expect(wakeReason({ role: 'user', display_kind: 'internal_notification' })).toBe('update')
    // Marked, but not a wake: a model switch or a hidden prompt, even when the agent answers next.
    expect(wakeReason({ role: 'user', display_kind: 'model_switch' }, true)).toBeUndefined()
    expect(wakeReason({ role: 'user', display_kind: 'hidden' }, true)).toBeUndefined()
    // Something newer than this page: a wake when the agent answers it, otherwise nothing to show.
    expect(wakeReason({ role: 'user', display_kind: 'something_new' }, true)).toBe('update')
    expect(wakeReason({ role: 'user', display_kind: 'something_new' })).toBeUndefined()
    // Never your own words, nor the agent's.
    expect(wakeReason({ role: 'user' }, true)).toBeUndefined()
    expect(wakeReason({ role: 'user', display_kind: 'steer' }, true)).toBeUndefined()
    expect(wakeReason({ role: 'assistant', display_kind: 'failed_turn' }, true)).toBeUndefined()
  })
})

describe('errands', () => {
  it('are what each background delegate_task sent, by its id', () => {
    expect(errandsOf([dispatched()]).get('deleg_d390b76f')).toEqual({
      goals: ['Check the support emails', 'Check the feedback emails'],
      subagentIds: ['sa-1', 'sa-2'],
    })
  })

  it('leave out ids that no longer line up with the goals', () => {
    const errand = errandsOf([dispatched({ subagent_ids: ['sa-1'] })]).get('deleg_d390b76f')
    expect(errand?.subagentIds).toEqual([])
  })

  it('list each part that reports back on its own', () => {
    const units = [
      { delegation_id: 'deleg_a', task_indexes: [1] },
      { delegation_id: 'deleg_b', task_indexes: [0, 'x'] },
    ]
    const errands = errandsOf([dispatched({ units })])
    expect(errands.get('deleg_a')).toEqual({ goals: ['Check the feedback emails'], subagentIds: ['sa-2'] })
    expect(errands.get('deleg_b')).toEqual({ goals: ['Check the support emails'], subagentIds: ['sa-1'] })
  })

  it('skip calls that ran in the foreground, failed, or are not JSON', () => {
    const rows: SavedRow[] = [
      { role: 'tool', tool_name: 'delegate_task', content: '{"results": [], "total_duration_seconds": 3}' },
      { role: 'tool', tool_name: 'delegate_task', content: '{"error": "no tasks"}' },
      { role: 'tool', tool_name: 'delegate_task', content: 'nope' },
      { role: 'tool', tool_name: 'terminal', content: dispatched().content },
    ]
    expect(errandsOf(rows).size).toBe(0)
  })
})

describe('helpers sent off', () => {
  // Sent at 890s; back at 1000s, after 110s away.
  const call = { ...dispatched(), timestamp: 890 }

  it('are cards in the turn that sent them, out working until the wake that brings them back', () => {
    expect(sentItems(call, errandsOf([call]))).toEqual([
      {
        kind: 'helper',
        id: 'helper-sa-1',
        subagentId: 'sa-1',
        goal: 'Check the support emails',
        status: 'running',
        tools: 0,
        startedAt: 890_000,
        delegationId: 'deleg_d390b76f',
        background: true,
      },
      expect.objectContaining({ id: 'helper-sa-2', goal: 'Check the feedback emails', status: 'running' }),
    ])
  })

  it('say how it went once they’re back, timed as Hermes timed them', () => {
    const errands = errandsOf([call, back()])
    expect(errands.get('deleg_d390b76f')?.back).toEqual({ at: 1_000_000, helpers: 2, failed: 0, took: 110_000 })
    expect(sentItems(call, errands)).toMatchObject([
      { status: 'done', startedAt: 890_000, endedAt: 1_000_000 },
      { status: 'done', endedAt: 1_000_000 },
    ])
    expect(sentItems(call, errands).some((h) => h.background)).toBe(false)
  })

  it('say each one didn’t finish when none did, and only that they’re back when some didn’t', () => {
    const none = errandsOf([call, back({ failed_count: 2 })])
    expect(sentItems(call, none).map((h) => h.status)).toEqual(['error', 'error'])
    const some = errandsOf([call, back({ failed_count: 1 })])
    expect(sentItems(call, some).map((h) => h.status)).toEqual(['back', 'back'])
  })

  it('say how each one went, and how long it took, from the report under the wake', () => {
    const errands = errandsOf([call, { ...back({ failed_count: 1 }), content: REPORT }])
    expect(sentItems(call, errands)).toMatchObject([
      {
        status: 'done',
        startedAt: 890_000,
        endedAt: 929_500,
        summary: '```text\nTwo need you: the ASUS RMA and a refund.\n```',
      },
      { status: 'error', line: 'Ran out of time', endedAt: 991_200 },
    ])
    expect(sentItems(call, errands)[1]).not.toHaveProperty('summary')
  })

  it('come back part by part when the call split them up', () => {
    const units = [
      { delegation_id: 'deleg_a', task_indexes: [0] },
      { delegation_id: 'deleg_b', task_indexes: [1] },
    ]
    const split = { ...dispatched({ units }), timestamp: 890 }
    const errands = errandsOf([split, back({ delegation_id: 'deleg_b', task_count: 1, failed_count: 1 })])
    expect(sentItems(split, errands).map((h) => [h.subagentId, h.status])).toEqual([
      ['sa-1', 'running'],
      ['sa-2', 'error'],
    ])
  })

  it('are keyed by their place when the call names no one', () => {
    const anon = { ...dispatched({ subagent_ids: undefined }), timestamp: 890 }
    expect(sentItems(anon, errandsOf([anon])).map((h) => h.id)).toEqual([
      'helper-deleg_d390b76f-0',
      'helper-deleg_d390b76f-1',
    ])
  })

  it('are nothing for any other call', () => {
    const sync = { role: 'tool', tool_name: 'delegate_task', content: '{"results": []}' }
    expect(sentItems(sync, errandsOf([sync]))).toEqual([])
    expect(sentItems({ role: 'tool', tool_name: 'terminal', content: '{}' }, new Map())).toEqual([])
  })
})

describe('a wake', () => {
  it('when helpers are back, says how many, how long they were away and who went', () => {
    expect(wakeItems(back(), 'h9', errandsOf([dispatched()]))).toEqual([
      {
        kind: 'wake',
        id: 'h9',
        reason: 'helpers',
        at: 1_000_000,
        rowId: 9,
        delegationId: 'deleg_d390b76f',
        helpers: 2,
        failed: 0,
        took: 110_000,
        subagentIds: ['sa-1', 'sa-2'],
      },
    ])
  })

  it('still counts its helpers when the errand that sent them is out of view', () => {
    const [item] = wakeItems(back({ task_count: 3, failed_count: 3 }), 'h9', new Map())
    expect(item).toMatchObject({ helpers: 3, failed: 3 })
    expect(item).not.toHaveProperty('subagentIds')
  })

  it('makes do with what an older Hermes saved: metadata as text, or none', () => {
    const asText = wakeItems({ ...back(), display_metadata: JSON.stringify(back().display_metadata) }, 'h9', new Map())
    expect(asText[0]).toMatchObject({ delegationId: 'deleg_d390b76f', helpers: 2, took: 110_000 })
    const [bare] = wakeItems({ ...back(), display_metadata: undefined }, 'h9', new Map())
    expect(bare).toMatchObject({ helpers: 1, failed: 0, delegationId: undefined })
    expect(bare).not.toHaveProperty('took')
  })

  it('for anything else is one line, and nothing for your own words', () => {
    const done = wakeItems({ id: 12, role: 'user', display_kind: 'process_complete', timestamp: 5 }, 'h12', new Map())
    expect(done).toEqual([{ kind: 'wake', id: 'h12', reason: 'command', at: 5000, rowId: 12 }])
    expect(wakeItems({ role: 'user', content: 'hi' }, 'h1', new Map())).toEqual([])
  })
})

describe('helpers seen live', () => {
  const call = { ...dispatched(), timestamp: 890 }

  it('keep what this page saw of them once the chat is read back', () => {
    const read = sentItems(call, errandsOf([call, back({ failed_count: 1 })]))
    const seen: ChatItem[] = [
      {
        kind: 'helper',
        id: 'helper-sa-2',
        subagentId: 'sa-2',
        goal: 'Check the feedback emails',
        status: 'error',
        line: 'Ran out of time',
        tools: 4,
        startedAt: 900_000,
        endedAt: 990_000,
      },
      {
        kind: 'helper',
        id: 'helper-sa-1',
        subagentId: 'sa-1',
        goal: 'x',
        status: 'running',
        line: 'Searching',
        tools: 2,
        startedAt: 1,
      },
    ]
    const [one, two] = helpers(withSeenHelpers(read, seen))
    // Still running when it was last seen: how it went comes from the wake, and what it was doing goes.
    expect(one).toMatchObject({
      subagentId: 'sa-1',
      goal: 'Check the support emails',
      status: 'back',
      endedAt: 1_000_000,
    })
    expect(one.line).toBeUndefined()
    expect(two).toMatchObject({
      status: 'error',
      line: 'Ran out of time',
      tools: 4,
      startedAt: 900_000,
      endedAt: 990_000,
    })
  })

  it('carry on where they were when they’re still out', () => {
    const read = sentItems(call, errandsOf([call]))
    const seen: ChatItem[] = [
      {
        kind: 'helper',
        id: 'helper-sa-1',
        subagentId: 'sa-1',
        goal: 'x',
        status: 'running',
        line: 'Searching',
        tools: 2,
        startedAt: 1,
      },
    ]
    expect(helpers(withSeenHelpers(read, seen))[0]).toMatchObject({
      status: 'running',
      line: 'Searching',
      background: true,
    })
  })

  it('leave the chat as read when none were seen', () => {
    const read = sentItems(call, errandsOf([call]))
    expect(withSeenHelpers(read, [])).toBe(read)
  })
})
