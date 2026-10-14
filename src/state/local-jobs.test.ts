import { describe, expect, it } from 'vitest'
import { deviceModels, jobFor, overall, plainError, stageOf, type Job } from './local-jobs'
import { PICKS } from './local-tiers'

const job = (over: Partial<Job>): Job => ({
  job_id: 'j1',
  kind: 'model-download',
  model_id: 'Qwen3.5-4B-Q4_K_M',
  status: 'running',
  phase: 'downloading',
  total_bytes: 100,
  done_bytes: 50,
  error: null,
  ...over,
})

describe('one setup, one bar', () => {
  it('reads Hermes’s jobs as three looks', () => {
    expect(stageOf(job({ kind: 'runtime-install', phase: 'downloading-runtime' }))).toBe('preparing')
    expect(stageOf(job({ kind: 'model-download', phase: 'starting' }))).toBe('downloading')
    expect(stageOf(job({ kind: 'model-activate', phase: 'setting-default' }))).toBe('starting')
    // A quickstart walks through all three.
    expect(stageOf(job({ kind: 'quickstart', phase: 'starting' }))).toBe('preparing')
    expect(stageOf(job({ kind: 'quickstart', phase: 'unpacking-runtime' }))).toBe('preparing')
    expect(stageOf(job({ kind: 'quickstart', phase: 'downloading' }))).toBe('downloading')
    expect(stageOf(job({ kind: 'quickstart', phase: 'starting-server' }))).toBe('starting')
    expect(stageOf(job({ kind: 'quickstart', phase: 'done' }))).toBe('starting')
  })

  it('fills the bar by bytes, with a sliver before and a stretch after', () => {
    expect(overall({ stage: 'preparing', done: 0, total: 100 })).toBeCloseTo(0.03)
    expect(overall({ stage: 'downloading', done: 0, total: 100 })).toBeCloseTo(0.04)
    expect(overall({ stage: 'downloading', done: 50, total: 100 })).toBeCloseTo(0.5)
    expect(overall({ stage: 'paused', done: 50, total: 100 })).toBeCloseTo(0.5)
    expect(overall({ stage: 'downloading', done: 200, total: 100 })).toBeCloseTo(0.96)
    expect(overall({ stage: 'starting', done: 100, total: 100 })).toBeCloseTo(0.97)
    expect(overall({ stage: 'ready', done: 100, total: 100 })).toBe(1)
  })

  it('says what went wrong in one plain line', () => {
    expect(plainError('[Errno 28] No space left on device')).toBe('Not enough storage space.')
    expect(plainError('<urlopen error [Errno -3] Temporary failure in name resolution>')).toBe(
      'Couldn’t reach the download. Check the internet connection.',
    )
    expect(plainError('The local server could not start — check the runtime is installed')).toBe(
      'Not enough free memory to start it.',
    )
    expect(plainError('Setup is already running')).toBe('Another setup is already running.')
    expect(plainError('KeyError: blah')).toBe('Something went wrong. Try again.')
  })

  it('finds a pick’s job, by Hermes’s name for it', () => {
    const small = PICKS.find((p) => p.id === 'qwen3.5-4b')!
    const big = PICKS.find((p) => p.id === 'qwen3.8-27b')!
    const jobs = [
      job({ job_id: 'a', model_id: 'Qwen3.5-4B-Q4_K_M', status: 'error' }),
      job({ job_id: 'b', model_id: 'Qwen3.5-4B-Q4_K_M', status: 'paused' }),
      job({ job_id: 'c', kind: 'quickstart', model_id: 'qwen3.8-27b' }),
    ]
    expect(jobFor(jobs, small, ['model-download'])?.job_id).toBe('b')
    expect(jobFor(jobs, big, ['quickstart'])?.job_id).toBe('c')
    expect(jobFor(jobs, big, ['model-download'])).toBeUndefined()
  })
})

describe('what Hermes says, as offers', () => {
  const status = {
    runtime_installed: true,
    active_model_id: null,
    models: [{ id: 'Qwen3.5-2B-Q4_K_M', size_bytes: 1 }],
  }
  const hw = (free: number) => ({
    uma: true,
    vram_usable_bytes: free * 0.8,
    ram_available_bytes: free,
    ram_total_bytes: 16e9,
    gpu_name: null,
  })

  it('marks what’s already downloaded', () => {
    // An 8 GB machine with 6 free: Hermes starts the 4B at 64K there.
    const out = deviceModels(status, { ...hw(6e9), ram_total_bytes: 8e9 }, [])
    expect(out.models.map((m) => [m.id, m.downloaded, m.recommended])).toEqual([
      ['qwen3.5-4b', false, true],
      ['qwen3.5-2b', true, false],
    ])
  })

  it('takes the catalog’s verdict and size for its own entries', () => {
    const catalog = [
      { id: 'qwen3.6-35b-a3b', fits: false, size_bytes: 1, downloaded: false, downloaded_model_id: null },
      { id: 'qwen3.8-27b', fits: true, size_bytes: 17_395_586_656, downloaded: true, downloaded_model_id: 'x' },
    ]
    const out = deviceModels(status, { ...hw(64e9), ram_total_bytes: 64e9 }, catalog)
    expect(out.models.map((m) => m.id)).not.toContain('qwen3.6-35b-a3b')
    const roomy = deviceModels(status, { ...hw(40e9), uma: false, vram_usable_bytes: 40e9, gpu_name: 'RTX' }, catalog)
    expect(roomy.models.find((m) => m.id === 'qwen3.8-27b')).toBeUndefined()
  })
})
