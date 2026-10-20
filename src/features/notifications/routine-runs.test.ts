import { beforeAll, describe, expect, it } from 'vitest'
import type { RunRow } from './routine-runs'

// The watcher's module reaches the browser's storage on load (through its imports); a bare stand-in is enough here.
let runs: typeof import('./routine-runs')
beforeAll(async () => {
  Object.assign(globalThis, { document: { cookie: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } })
  runs = await import('./routine-runs')
})

const run = (id: string, startedAt: number, finished = true): RunRow => ({ id: `cron_abc123_${id}`, startedAt, finished, title: '' })

describe('which runs just landed', () => {
  it('none on the first look, whatever is there', () => {
    const { landed, memory } = runs.look([run('20261020_080000', 100), run('20261020_090000', 200, false)])
    expect(landed).toEqual([])
    expect(memory.since).toBe(200)
  })

  it('a run seen going, once it finishes', () => {
    const { memory } = runs.look([run('20261020_090000', 200, false)])
    expect(runs.look([run('20261020_090000', 200, false)], memory).landed).toEqual([])
    expect(runs.look([run('20261020_090000', 200)], memory).landed.map((r) => r.id)).toEqual(['cron_abc123_20261020_090000'])
  })

  it('a newer run that started and finished between looks', () => {
    const { memory } = runs.look([run('20261020_080000', 100)])
    expect(runs.look([run('20261020_100000', 300), run('20261020_080000', 100)], memory).landed).toHaveLength(1)
  })

  it('each run once', () => {
    const { memory } = runs.look([])
    expect(runs.look([run('20261020_100000', 300)], memory).landed).toHaveLength(1)
    expect(runs.look([run('20261020_100000', 300)], memory).landed).toHaveLength(0)
  })

  it('never an older run that moves up the list', () => {
    const { memory } = runs.look([run('20261020_100000', 300)])
    expect(runs.look([run('20261019_080000', 50), run('20261020_100000', 300)], memory).landed).toEqual([])
  })

  it('with nothing there at first, anything that lands', () => {
    const { memory } = runs.look([])
    expect(runs.look([run('20260101_000000', 1)], memory).landed).toHaveLength(1)
  })
})

describe('routines Hermes already delivers elsewhere', () => {
  it('are any target but saved here', () => {
    expect(runs.deliversElsewhere('local')).toBe(false)
    expect(runs.deliversElsewhere(undefined)).toBe(false)
    expect(runs.deliversElsewhere('')).toBe(false)
    expect(runs.deliversElsewhere('telegram')).toBe(true)
    expect(runs.deliversElsewhere('origin')).toBe(true)
    expect(runs.deliversElsewhere('local,telegram:123')).toBe(true)
    expect(runs.deliversElsewhere(['local'])).toBe(false)
  })
})
