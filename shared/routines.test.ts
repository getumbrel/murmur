import { describe, expect, it } from 'vitest'
import {
  ALONG,
  along,
  couldntRun,
  failingOf,
  failureIn,
  deliversElsewhere,
  findingIn,
  findingsOf,
  foldQuiet,
  isQuiet,
  isQuietExcerpt,
  isRunBrief,
  look,
  madeRoutine,
  reportsTo,
  resultLine,
  routineIdOf,
  runTitle,
  soundsScheduled,
  standingResults,
  toldIn,
  withFindings,
  KEPT,
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

describe('a routine set up in a chat', () => {
  // What Hermes 0.22.5's scheduler answers making one (tools/cronjob_tools.py), indented as it sends it.
  const made = JSON.stringify(
    {
      success: true,
      job_id: '152b93b73ead',
      name: 'Watch for AIS replies',
      skill: null,
      skills: [],
      schedule: 'every 15m',
      repeat: 'forever',
      deliver: 'local',
      next_run_at: '2026-11-05T11:49:06-08:00',
      job: { id: '152b93b73ead' },
      message: "Cron job 'Watch for AIS replies' created.",
    },
    null,
    2,
  )

  it('is known by what making it answered, called directly or through tool search', () => {
    expect(madeRoutine('cronjob_manage', made)).toBe('152b93b73ead')
    expect(madeRoutine('cronjob', JSON.parse(made))).toBe('152b93b73ead')
    expect(madeRoutine('tool_call', made)).toBe('152b93b73ead')
    // Cut short in history, its opening still says.
    expect(madeRoutine('cronjob', made.slice(0, 80))).toBe('152b93b73ead')
  })

  it('but not by changing, listing or running one, a failure, or another tool', () => {
    expect(madeRoutine('cronjob', JSON.stringify({ success: true, job: { id: 'x' } }))).toBeUndefined()
    expect(madeRoutine('cronjob', JSON.stringify({ success: true, count: 1, jobs: [{ id: 'x' }] }))).toBeUndefined()
    expect(madeRoutine('cronjob', JSON.stringify({ success: false, error: 'schedule is required for create' }))).toBeUndefined()
    expect(madeRoutine('cronjob', JSON.stringify({ success: true, job_id: 'x' }))).toBeUndefined()
    expect(madeRoutine('web_search', made)).toBeUndefined()
  })

  it('reports there, unless Hermes sends what it finds elsewhere', () => {
    expect(reportsTo({ murmur_chat: 'c1', deliver: 'local' })).toBe('c1')
    expect(reportsTo({ murmur_chat: 'c1' })).toBe('c1')
    expect(reportsTo({ murmur_chat: 'c1', deliver: 'telegram' })).toBeUndefined()
    expect(reportsTo({ deliver: 'local' })).toBeUndefined()
    expect(reportsTo({ murmur_chat: 42 })).toBeUndefined()
  })

  it('keeps each finding once, newest first, the newest few', () => {
    const kept = withFindings([{ run: 'a', at: 1 }], [{ run: 'b', at: 3 }, { run: 'a', at: 1 }])
    expect(kept).toEqual([{ run: 'b', at: 3 }, { run: 'a', at: 1 }])
    const many = Array.from({ length: KEPT + 5 }, (_, i) => ({ run: `r${i}`, at: i }))
    const capped = withFindings([], many)
    expect(capped).toHaveLength(KEPT)
    expect(capped[0].run).toBe(`r${KEPT + 4}`)
    // What Hermes kept is read warily: anything else is left out.
    expect(findingsOf({ murmur_findings: [{ run: 'a', at: 1 }, { run: 2 }, null, 'x'] })).toEqual([{ run: 'a', at: 1 }])
    expect(findingsOf({ murmur_findings: 'nope' })).toEqual([])
  })
})

describe('what a run found', () => {
  const brief = { role: 'user', content: '[IMPORTANT: You are running as a scheduled cron job. …]\n\nCheck Gmail' }

  it('is the agent’s last answer', () => {
    const found = findingIn([brief, { role: 'assistant', content: 'Looking…' }, { role: 'tool', content: '{}' }, { role: 'assistant', content: 'AIS replied.' }])
    expect(found).toBe('AIS replied.')
  })

  it('from before anyone replied in it', () => {
    const found = findingIn([brief, { role: 'assistant', content: 'AIS replied.' }, { role: 'user', content: 'Thanks!' }, { role: 'assistant', content: 'Anytime.' }])
    expect(found).toBe('AIS replied.')
  })

  it('and nothing when it had nothing to report', () => {
    expect(findingIn([brief, { role: 'assistant', content: '[SILENT]' }])).toBe('')
    expect(findingIn([brief])).toBe('')
  })
  it('and nothing when it failed, though Hermes’s apology reads like an answer', () => {
    const turnedAway = {
      role: 'assistant',
      content: 'Your request was not processed. Send it again if you still want me to carry it out.',
      display_kind: 'failed_turn',
      display_metadata: { error: 'HTTP 401: Invalid API key' },
    }
    expect(findingIn([brief, turnedAway])).toBe('')
    expect(failureIn([brief, turnedAway])).toBe('HTTP 401: Invalid API key')
    const marked = { role: 'assistant', content: '[CRON_FAILURE]\nThe Gmail sign-in expired.' }
    expect(findingIn([brief, marked])).toBe('')
    expect(failureIn([brief, marked])).toBe('The Gmail sign-in expired.')
    expect(failureIn([brief, { role: 'assistant', content: 'AIS replied.' }])).toBeUndefined()
  })
})

describe('a routine that fails', () => {
  it('is its job’s newest run failing: when, how many in a row, and why, without Python’s words for it', () => {
    const job = {
      last_status: 'error',
      last_error: 'RuntimeError: HTTP 401: Invalid API key',
      last_failure: { at: '2026-11-05T12:01:33+00:00', detail: 'RuntimeError: HTTP 401: Invalid API key' },
      failure_streak: 3,
      last_run_at: '2026-11-05T12:01:33+00:00',
    }
    expect(failingOf(job)).toEqual({ at: Date.parse('2026-11-05T12:01:33Z'), times: 3, why: 'HTTP 401: Invalid API key' })
    expect(failingOf({ ...job, last_status: 'ok' })).toBeUndefined()
    // A Hermes that doesn't count them, or keep the failure apart.
    expect(failingOf({ last_status: 'error', last_error: 'Timed out', last_run_at: '2026-11-05T12:01:33+00:00' })).toEqual({
      at: Date.parse('2026-11-05T12:01:33Z'),
      times: undefined,
      why: 'Timed out',
    })
  })

  it('says so in a line', () => {
    expect(couldntRun('HTTP 401: Invalid API key')).toBe('Couldn’t run: HTTP 401: Invalid API key')
    expect(couldntRun('Timed out', 3)).toBe('Couldn’t run the last 3 times: Timed out')
    expect(couldntRun('')).toBe('Couldn’t run.')
  })
})

describe('what goes along with a message', () => {
  const finding = { routine: 'Watch for AIS replies', when: 'today at 9:14 AM', text: '**AIS replied.** Priya approved it.' }

  it('is nothing, most of the time', () => {
    expect(along({ found: [] })).toBe('')
  })

  it('says when a routine couldn’t run', () => {
    const text = along({ found: [{ routine: 'Watch for AIS replies', when: 'today at 9:30 AM', text: 'Couldn’t run: Timed out', failed: true }] })
    expect(text).toContain('Your routine “Watch for AIS replies” couldn’t run today at 9:30 AM:\nCouldn’t run: Timed out')
  })

  it('is what routines reported, and once, how they report here', () => {
    const text = along({ found: [finding], note: true })
    expect(text).toMatch(/^--- From Murmur ---\n/)
    expect(text).toContain("deliver='local'")
    expect(text).toContain('Your routine “Watch for AIS replies” reported in this chat today at 9:14 AM:\n**AIS replied.** Priya approved it.')
    expect(toldIn(`Watch my inbox\n\n${text}`)).toBe(true)
    expect(toldIn(`Watch my inbox\n\n${along({ found: [finding] })}`)).toBe(false)
  })

  it('the newest few, each cut to size', () => {
    const found = Array.from({ length: 7 }, (_, i) => ({ ...finding, text: `${i}`.repeat(i === 6 ? 5000 : 1) }))
    const text = along({ found })
    expect(text).toContain('(2 earlier reports left out.)')
    expect(text).not.toContain('\n1\n')
    expect(text).toContain('…')
  })

  it('is left out when the message is shown again, whatever Hermes added after it', () => {
    const sent = `What did they say?\n\n${along({ found: [finding] })}`
    expect(sent.replace(ALONG, '')).toBe('What did they say?')
    const expanded = `${sent}\n--- Attached Context ---\n\nnotes.txt: hello`
    expect(expanded.replace(ALONG, '')).toBe('What did they say?\n--- Attached Context ---\n\nnotes.txt: hello')
    expect(`${sent}\n\nUmbrel Runtime Context: …`.replace(ALONG, '')).toBe('What did they say?\n\nUmbrel Runtime Context: …')
  })
})

describe('a message that may get something scheduled', () => {
  it('asks for later, or again', () => {
    for (const text of [
      'Watch my Gmail for a reply from AIS and let me know',
      'Remind me to call mom on Sunday',
      'Every morning, send me the weather',
      'Can you keep an eye on the price of this?',
      'Tell me when the package ships',
    ])
      expect(soundsScheduled(text), text).toBe(true)
  })

  it('and most messages don’t', () => {
    for (const text of ['What is the capital of France?', 'Write a haiku about rain', 'Summarize this PDF'])
      expect(soundsScheduled(text), text).toBe(false)
  })
})
