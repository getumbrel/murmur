import { describe, expect, it } from 'vitest'
import { foldQuiet, isQuiet, isQuietExcerpt, isRunBrief, resultLine, routineIdOf, runTitle, standingResults } from './runs'

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
})
