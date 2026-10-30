import { describe, expect, it } from 'vitest'
import {
  deliversElsewhere,
  foldQuiet,
  isQuiet,
  isQuietExcerpt,
  isRunBrief,
  look,
  resultLine,
  routineIdOf,
  runTitle,
  standingResults,
  type RunRow,
} from './routines.ts'

describe('quiet runs, as Hermes reads them', () => {
  it('are a marker as the whole answer', () => {
    for (const answer of ['[SILENT]', ' [silent] ', 'SILENT', 'NO_REPLY', 'no reply', '*NO_REPLY*', '.SILENT.', '[静默]', '沉默'])
      expect(isQuiet(answer), answer).toBe(true)
  })

  it('or a marker on its own first or last line', () => {
    expect(isQuiet('Nothing changed since this morning.\n[SILENT]')).toBe(true)
    expect(isQuiet('NO_REPLY\n\nInbox is empty.')).toBe(true)
  })

  it('or one that opens the answer', () => {
    expect(isQuiet('[SILENT] No new mail.')).toBe(true)
  })

  it('but not one mid-sentence, a near miss or nothing at all', () => {
    expect(isQuiet('The agent replied [SILENT] when there was nothing new.')).toBe(false)
    expect(isQuiet('Silent retry succeeded')).toBe(false)
    expect(isQuiet('[SILENT')).toBe(false)
    expect(isQuiet('')).toBe(false)
    expect(isQuiet('Good morning! Octopuses have three hearts.')).toBe(false)
  })

  it('read from a flattened one-line excerpt too', () => {
    expect(isQuietExcerpt('[SILENT]')).toBe(true)
    expect(isQuietExcerpt('Nothing changed since this morning. [SILENT]')).toBe(true)
    expect(isQuietExcerpt('Your flight moved to 14:10.')).toBe(false)
  })
})

describe('runs', () => {
  it('belong to the routine in their id', () => {
    expect(routineIdOf('cron_0467cd564241_20261019_190444')).toBe('0467cd564241')
    expect(routineIdOf('20261013_190805_5e42d7')).toBeUndefined()
  })

  it('are titled by their routine, without Hermes’s timestamp', () => {
    expect(runTitle('Morning note · Oct 19 08:00')).toBe('Morning note')
    expect(runTitle('Quiet watch (test) · Oct 9 19:06 #3')).toBe('Quiet watch (test)')
    expect(runTitle('Price watch')).toBe('Price watch')
  })

  it('open with Hermes’s brief to the agent', () => {
    expect(isRunBrief('[IMPORTANT: You are running as a scheduled cron job. DELIVERY: …]\n\nCheck my inbox')).toBe(true)
    expect(isRunBrief('Check my inbox')).toBe(false)
  })

  it('fold back-to-back quiet ones into one', () => {
    const runs = ['q1', 'q2', 'r1', 'q3', 'r2', 'r3', 'q4', 'q5', 'q6']
    const groups = foldQuiet(runs, (r) => r.startsWith('q'))
    expect(groups).toEqual([
      { kind: 'quiet', runs: ['q1', 'q2'] },
      { kind: 'run', run: 'r1' },
      { kind: 'quiet', runs: ['q3'] },
      { kind: 'run', run: 'r2' },
      { kind: 'run', run: 'r3' },
      { kind: 'quiet', runs: ['q4', 'q5', 'q6'] },
    ])
  })
})

describe('results among the chats', () => {
  const run = (routineId: string, at: number) => ({ id: `cron_${routineId}_${at}`, routineId, at })

  it('are each routine’s newest', () => {
    const latest = [run('inbox', 300), run('prices', 200)]
    expect(standingResults(latest, [])).toEqual(latest)
  })

  it('give way to a newer run of theirs you replied in', () => {
    expect(standingResults([run('inbox', 300), run('prices', 200)], [run('inbox', 400)])).toEqual([run('prices', 200)])
  })

  it('but not to an older one, or another routine’s', () => {
    expect(standingResults([run('inbox', 300)], [run('inbox', 100), run('prices', 500)])).toEqual([run('inbox', 300)])
  })

  it('read as one line of words', () => {
    expect(resultLine('## Two new emails\n\n- **Sam**: the venue moved to [Hall B](https://x.y)')).toBe('Two new emails - Sam: the venue moved to Hall B')
    expect(resultLine('```\nraw\n```\nDone.')).toBe('Done.')
  })

  it('under the routine’s name, without saying the name again', () => {
    const brief = '## Morning brief\n\n**Weather:** sunny, 24°\n\n- Standup at 10'
    expect(resultLine(brief, 'Morning brief')).toBe('Weather: sunny, 24° - Standup at 10')
    expect(resultLine('**morning BRIEF**\nAll quiet', 'Morning brief')).toBe('All quiet')
    expect(resultLine('## Morning brief for Sam\nAll quiet', 'Morning brief')).toBe('Morning brief for Sam All quiet')
    // Hermes's preview runs the lines together.
    expect(resultLine('## Morning brief **Weather:** sunny - Standup', 'Morning brief')).toBe('Weather: sunny - Standup')
    expect(resultLine('Morning brief is ready', 'Morning brief')).toBe('Morning brief is ready')
    expect(resultLine('## Prices (EU)\nUp 2%', 'Prices (EU)')).toBe('Up 2%')
  })
})

const run = (id: string, startedAt: number, finished = true): RunRow => ({ id: `cron_abc123_${id}`, startedAt, finished, title: '' })

describe('which runs just landed', () => {
  it('none on the first look, whatever is there', () => {
    const { landed, memory } = look([run('20261020_080000', 100), run('20261020_090000', 200, false)])
    expect(landed).toEqual([])
    expect(memory.since).toBe(200)
  })

  it('a run seen going, once it finishes', () => {
    const { memory } = look([run('20261020_090000', 200, false)])
    expect(look([run('20261020_090000', 200, false)], memory).landed).toEqual([])
    expect(look([run('20261020_090000', 200)], memory).landed.map((r) => r.id)).toEqual(['cron_abc123_20261020_090000'])
  })

  it('a newer run that started and finished between looks', () => {
    const { memory } = look([run('20261020_080000', 100)])
    expect(look([run('20261020_100000', 300), run('20261020_080000', 100)], memory).landed).toHaveLength(1)
  })

  it('each run once', () => {
    const { memory } = look([])
    expect(look([run('20261020_100000', 300)], memory).landed).toHaveLength(1)
    expect(look([run('20261020_100000', 300)], memory).landed).toHaveLength(0)
  })

  it('never an older run that moves up the list', () => {
    const { memory } = look([run('20261020_100000', 300)])
    expect(look([run('20261019_080000', 50), run('20261020_100000', 300)], memory).landed).toEqual([])
  })

  it('with nothing there at first, anything that lands', () => {
    const { memory } = look([])
    expect(look([run('20260101_000000', 1)], memory).landed).toHaveLength(1)
  })

  it('lets go of runs that leave the newest few, and never tells one again', () => {
    const { memory } = look([])
    expect(look([run('20261020_080000', 100)], memory).landed).toHaveLength(1)
    expect(look([run('20261020_100000', 300), run('20261020_090000', 200)], memory).landed).toHaveLength(2)
    expect(memory.done.size).toBe(2)
    // The two newer runs deleted: the first is back on the list, and was told already.
    expect(look([run('20261020_080000', 100)], memory).landed).toEqual([])
  })
})

describe('routines Hermes already delivers elsewhere', () => {
  it('are any target but saved here', () => {
    expect(deliversElsewhere('local')).toBe(false)
    expect(deliversElsewhere(undefined)).toBe(false)
    expect(deliversElsewhere('')).toBe(false)
    expect(deliversElsewhere('telegram')).toBe(true)
    expect(deliversElsewhere('origin')).toBe(true)
    expect(deliversElsewhere('local,telegram:123')).toBe(true)
    expect(deliversElsewhere(['local'])).toBe(false)
  })
})
