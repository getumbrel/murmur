import { describe, expect, it } from 'vitest'
import { formatSize, held, need, offersFor, PICKS, stagedId, startWindow, type Hardware } from './local-tiers'

const GB = 1e9

/** CPU or integrated graphics, as Hermes reports it: 80% of what's free is usable. */
const cpu = (free: number, total = 16): Hardware => ({
  uma: true,
  vramUsable: Math.min(free, total) * GB * 0.8,
  ramAvailable: free * GB,
  ramTotal: total * GB,
  gpuName: null,
})

const ids = (hw: Hardware, vetoed?: Set<string>) => offersFor(hw, vetoed).offers.map((o) => o.pick.id)

describe('what fits', () => {
  it('prices a pick the way Hermes does: weights, 64K of q8 KV, recurrent state, overhead', () => {
    const pick = PICKS.find((p) => p.id === 'qwen3.5-4b')!
    expect(need(pick)).toBe(2_740_937_888 + 32768 * 65536 * (34 / 64) + 24 * 4 * 2 ** 20 + 1.5 * 2 ** 30)
  })

  it('keeps the table in order of rank, one line at a time getting bigger', () => {
    const ranks = PICKS.map((p) => p.rank)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    for (const line of new Set(PICKS.map((p) => p.line))) {
      const sizes = PICKS.filter((p) => p.line === line).map((p) => p.bytes)
      expect([...sizes].sort((a, b) => a - b)).toEqual(sizes)
    }
  })
})

describe('the window Hermes starts at, in RAM', () => {
  const pick = (id: string) => PICKS.find((p) => p.id === id)!

  it('climbs as far as Hermes’s estimate fits 80% of the memory installed, however little is free', () => {
    expect(startWindow(pick('qwen3.5-2b'), cpu(3))).toBe(256 * 1024)
    expect(startWindow(pick('qwen3.5-4b'), cpu(3))).toBe(256 * 1024)
    expect(startWindow(pick('qwen3.5-9b'), cpu(3))).toBe(144 * 1024)
    expect(startWindow(pick('qwen3.5-2b'), cpu(3, 8))).toBe(144 * 1024)
    expect(startWindow(pick('qwen3.5-4b'), cpu(3, 8))).toBe(64 * 1024)
  })

  it('holds the weights, the whole q8 window and llama.cpp’s buffers: the 2B at 256K is the 3.6 GB seen on a 16 GB Umbrel', () => {
    const twoB = pick('qwen3.5-2b')
    expect(held(twoB, cpu(3))).toBe(twoB.weights + 12288 * 262144 * (34 / 64) + 18 * 4 * 2 ** 20 + 0.8 * GB)
    expect(held(twoB, cpu(3)) / GB).toBeCloseTo(3.87, 2)
  })
})

describe('what to offer', () => {
  it('a busy 16 GB Umbrel with about 3 GB free: nothing, since even the 2B starts at 256K and wouldn’t stay up', () => {
    expect(offersFor(cpu(3))).toEqual({ offers: [], tight: null })
  })

  it('a 16 GB Umbrel with 4 GB free: the 2B, and says it’s tight', () => {
    const { offers, tight } = offersFor(cpu(4))
    expect(offers.map((o) => o.pick.id)).toEqual(['qwen3.5-2b'])
    expect(offers[0]).toMatchObject({ recommended: true, fits: false, speed: 'Fastest' })
    expect(tight).toEqual({ free: 4 * GB })
  })

  it('a 16 GB Umbrel with room: the 2B, since the 4B starts at 256K', () => {
    expect(ids(cpu(8))).toEqual(['qwen3.5-2b'])
    expect(offersFor(cpu(8)).tight).toBeNull()
  })

  it('an 8 GB machine starts models at smaller windows, so the 4B fits in less', () => {
    expect(ids(cpu(6, 8))).toEqual(['qwen3.5-4b', 'qwen3.5-2b'])
  })

  it('plenty free, no graphics card: the 9B, never a slow 27B first', () => {
    expect(ids(cpu(12))).toEqual(['qwen3.5-9b-q6', 'qwen3.5-4b'])
    // On 32 GB the 27B starts at 216K and needs nearly 22 GB: it doesn’t fit in 24 free with room to spare.
    expect(offersFor(cpu(24, 32)).offers.map((o) => [o.pick.id, o.speed])).toEqual([
      ['qwen3.5-9b-q6', 'Steady'],
      ['qwen3.5-4b', 'Fast'],
    ])
    expect(offersFor(cpu(30, 32)).offers.map((o) => [o.pick.id, o.speed])).toEqual([
      ['qwen3.5-9b-q6', 'Steady'],
      ['qwen3.8-27b', 'Slow'],
    ])
  })

  it('a big machine without a graphics card: the 35B mixture of experts, quick for its size', () => {
    expect(offersFor(cpu(64, 64)).offers.map((o) => [o.pick.id, o.speed])).toEqual([
      ['qwen3.6-35b-a3b', 'Fast'],
      ['qwen3.8-27b-q8', 'Slow'],
    ])
  })

  it('a graphics card: the best that fits on it', () => {
    const card = (vram: number, free: number): Hardware => ({
      uma: false,
      vramUsable: vram * GB,
      ramAvailable: free * GB,
      ramTotal: 64 * GB,
      gpuName: 'NVIDIA GeForce RTX 4090',
    })
    expect(offersFor(card(21.8, 32)).offers.map((o) => [o.pick.id, o.speed])).toEqual([
      ['qwen3.8-27b-q3', 'Fast'],
      ['qwen3.6-35b-a3b', 'Fast'],
    ])
    expect(ids(card(40, 32))).toEqual(['qwen3.8-27b-q8', 'qwen3.6-35b-a3b'])
  })

  it('leaves out what Hermes’s catalog says can’t run here', () => {
    expect(ids(cpu(64, 64), new Set(['qwen3.6-35b-a3b']))).toEqual(['qwen3.5-9b-q6', 'qwen3.8-27b-q8'])
  })
})

describe('words', () => {
  it('sizes and file names', () => {
    expect(formatSize(2_740_937_888)).toBe('2.7 GB')
    expect(formatSize(13_146_393_504)).toBe('13 GB')
    expect(formatSize(532_517_120)).toBe('533 MB')
    expect(stagedId('Qwen3.5-4B-Q4_K_M.gguf')).toBe('Qwen3.5-4B-Q4_K_M')
  })
})
