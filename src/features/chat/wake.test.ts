import { describe, expect, it } from 'vitest'
import { errandsOf, isYours, wakeItems, wakeReason, withSeenHelpers, type SavedRow } from './wake'
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

describe('a wake', () => {
  it('when helpers are back, is their faces: who went and what they were asked', () => {
    const items = wakeItems(back(), 'h9', errandsOf([dispatched()]))
    expect(items[0]).toEqual({
      kind: 'wake',
      id: 'h9',
      reason: 'helpers',
      at: 1_000_000,
      rowId: 9,
      delegationId: 'deleg_d390b76f',
      helpers: 2,
      failed: 0,
      took: 110_000,
    })
    expect(helpers(items)).toMatchObject([
      { subagentId: 'sa-1', goal: 'Check the support emails', status: 'done', startedAt: 890_000, endedAt: 1_000_000 },
      { subagentId: 'sa-2', goal: 'Check the feedback emails', status: 'done' },
    ])
  })

  it('still counts its helpers when the errand that sent them is out of view', () => {
    const items = wakeItems(back({ task_count: 3, failed_count: 3 }), 'h9', new Map())
    expect(items[0]).toMatchObject({ helpers: 3, failed: 3 })
    // Keyed as Hermes keys a helper's live events when it gives no id of its own.
    expect(helpers(items).map((h) => [h.subagentId, h.goal, h.status])).toEqual([
      ['deleg_d390b76f-0', '', 'error'],
      ['deleg_d390b76f-1', '', 'error'],
      ['deleg_d390b76f-2', '', 'error'],
    ])
  })

  it('makes do with what an older Hermes saved: metadata as text, or none', () => {
    const asText = wakeItems({ ...back(), display_metadata: JSON.stringify(back().display_metadata) }, 'h9', new Map())
    expect(asText[0]).toMatchObject({ delegationId: 'deleg_d390b76f', helpers: 2 })
    const bare = wakeItems({ ...back(), display_metadata: undefined }, 'h9', new Map())
    expect(bare[0]).toMatchObject({ helpers: 1, failed: 0, delegationId: undefined })
    expect(helpers(bare)).toMatchObject([{ subagentId: 'h9-0', startedAt: 1_000_000 }])
  })

  it('for anything else is one line, and nothing for your own words', () => {
    const done = wakeItems({ id: 12, role: 'user', display_kind: 'process_complete', timestamp: 5 }, 'h12', new Map())
    expect(done).toEqual([{ kind: 'wake', id: 'h12', reason: 'command', at: 5000, rowId: 12 }])
    expect(wakeItems({ role: 'user', content: 'hi' }, 'h1', new Map())).toEqual([])
  })
})

describe('helpers seen live', () => {
  it('keep what this page saw of them once the chat is read back', () => {
    const read = wakeItems(back({ failed_count: 1 }), 'h9', errandsOf([dispatched()]))
    const seen: ChatItem[] = [
      {
        kind: 'helper',
        id: 'helper-sa-2',
        subagentId: 'sa-2',
        goal: 'Check the feedback emails',
        status: 'error',
        tools: 4,
        startedAt: 900_000,
        endedAt: 990_000,
      },
      { kind: 'helper', id: 'helper-sa-1', subagentId: 'sa-1', goal: 'x', status: 'running', tools: 2, startedAt: 1 },
    ]
    const [one, two] = helpers(withSeenHelpers(read, seen))
    // Still running when it was last seen: how it went comes from the wake.
    expect(one).toMatchObject({
      subagentId: 'sa-1',
      goal: 'Check the support emails',
      status: 'done',
      endedAt: 1_000_000,
    })
    expect(two).toMatchObject({ status: 'error', tools: 4, startedAt: 900_000, endedAt: 990_000 })
  })

  it('leave the chat as read when none were seen', () => {
    const read = wakeItems(back(), 'h9', new Map())
    expect(withSeenHelpers(read, [])).toBe(read)
  })
})
