import { describe, expect, it } from 'vitest'
import {
  fitLine,
  fitOf,
  hfModel,
  lookupError,
  parseModelRef,
  pickFile,
  prettyName,
  quantOf,
  type FileGroup,
} from './local-hf'
import { plainError } from './local-jobs'
import { offersFor, PICKS, stagedId, type Hardware } from './local-tiers'

const GB = 1e9

/** CPU or integrated graphics, on Umbrel's image: 80% of what's free is usable. */
const cpu = (free: number, total = 16): Hardware => ({
  uma: true,
  vramUsable: free * GB * 0.8,
  ramAvailable: free * GB,
  ramTotal: total * GB,
  gpuName: null,
  narrows: true,
})

const one = (path: string, bytes: number): FileGroup => ({ label: '', paths: [path], total_bytes: bytes })

// unsloth/Qwen3.5-0.8B-GGUF, as Hermes lists it (largest first, vision add-ons already left out).
const SMALL = [
  one('Qwen3.5-0.8B-BF16.gguf', 1_516_744_736),
  one('Qwen3.5-0.8B-UD-Q8_K_XL.gguf', 1_186_443_520),
  one('Qwen3.5-0.8B-Q8_0.gguf', 811_843_840),
  one('Qwen3.5-0.8B-Q6_K.gguf', 639_029_504),
  one('Qwen3.5-0.8B-UD-Q4_K_XL.gguf', 558_772_480),
  one('Qwen3.5-0.8B-Q4_K_M.gguf', 532_517_120),
  one('Qwen3.5-0.8B-IQ4_XS.gguf', 492_605_696),
  one('Qwen3.5-0.8B-UD-Q3_K_XL.gguf', 492_216_576),
  one('Qwen3.5-0.8B-Q3_K_M.gguf', 470_167_808),
  one('Qwen3.5-0.8B-UD-Q2_K_XL.gguf', 417_718_528),
  one('Qwen3.5-0.8B-UD-IQ2_XXS.gguf', 338_227_456),
]

describe('reading what was typed', () => {
  it('takes a repo, with or without a quant', () => {
    expect(parseModelRef('unsloth/Qwen3.5-9B-GGUF')).toEqual({ repo: 'unsloth/Qwen3.5-9B-GGUF' })
    expect(parseModelRef('  unsloth/Qwen3.5-9B-GGUF:Q4_K_M ')).toEqual({
      repo: 'unsloth/Qwen3.5-9B-GGUF',
      quant: 'Q4_K_M',
    })
    expect(parseModelRef('unsloth/Qwen3.5-9B-GGUF:latest')).toEqual({ repo: 'unsloth/Qwen3.5-9B-GGUF' })
  })

  it('takes hf.co names and huggingface.co links', () => {
    expect(parseModelRef('hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:q4_k_m')).toEqual({
      repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
      quant: 'q4_k_m',
    })
    expect(parseModelRef('https://huggingface.co/unsloth/Qwen3.5-9B-GGUF')).toEqual({ repo: 'unsloth/Qwen3.5-9B-GGUF' })
    expect(parseModelRef('https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/tree/main')).toEqual({
      repo: 'unsloth/Qwen3.5-9B-GGUF',
    })
    expect(parseModelRef('huggingface.co/unsloth/Qwen3.5-9B-GGUF?library=llama-cpp')).toEqual({
      repo: 'unsloth/Qwen3.5-9B-GGUF',
    })
    // A page of the repo that isn't a file still means the repo.
    expect(parseModelRef('https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/discussions')).toEqual({
      repo: 'unsloth/Qwen3.5-9B-GGUF',
    })
  })

  it('takes a link to a file, or to a quant’s folder', () => {
    expect(
      parseModelRef('https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/blob/main/Qwen3.5-9B-UD-Q4_K_XL.gguf'),
    ).toEqual({ repo: 'unsloth/Qwen3.5-9B-GGUF', path: 'Qwen3.5-9B-UD-Q4_K_XL.gguf' })
    expect(
      parseModelRef(
        'https://huggingface.co/unsloth/Big-GGUF/resolve/main/Q4_K_M/Big-Q4_K_M-00001-of-00003.gguf?download=true',
      ),
    ).toEqual({ repo: 'unsloth/Big-GGUF', path: 'Q4_K_M/Big-Q4_K_M-00001-of-00003.gguf' })
    expect(parseModelRef('https://huggingface.co/unsloth/Big-GGUF/tree/main/UD-Q4_K_XL')).toEqual({
      repo: 'unsloth/Big-GGUF',
      quant: 'UD-Q4_K_XL',
    })
  })

  it('takes a file by its path in the repo', () => {
    expect(parseModelRef('unsloth/Qwen3.5-9B-GGUF/Qwen3.5-9B-Q6_K.gguf')).toEqual({
      repo: 'unsloth/Qwen3.5-9B-GGUF',
      path: 'Qwen3.5-9B-Q6_K.gguf',
    })
    expect(parseModelRef('unsloth/Qwen3.5-9B-GGUF:Qwen3.5-9B-Q6_K.gguf')).toEqual({
      repo: 'unsloth/Qwen3.5-9B-GGUF',
      path: 'Qwen3.5-9B-Q6_K.gguf',
    })
  })

  it('turns away what isn’t a model name', () => {
    expect(parseModelRef('')).toBeNull()
    expect(parseModelRef('qwen')).toBeNull()
    expect(parseModelRef('Qwen3.5-9B-Q4_K_M.gguf')).toBeNull()
    expect(parseModelRef('https://huggingface.co/datasets/foo/bar')).toBeNull()
    expect(parseModelRef('a b/c')).toBeNull()
  })
})

describe('quants', () => {
  it('reads a file’s quant from its name', () => {
    expect(quantOf('Qwen3.5-0.8B-Q4_K_M.gguf')).toBe('Q4_K_M')
    expect(quantOf('Qwen3.5-0.8B-UD-Q4_K_XL.gguf')).toBe('UD-Q4_K_XL')
    expect(quantOf('qwen2.5-7b-instruct-iq4_xs.gguf')).toBe('IQ4_XS')
    expect(quantOf('Q4_K_M/Big-Q4_K_M-00001-of-00003.gguf')).toBe('Q4_K_M')
    expect(quantOf('QwQ-32B-BF16.gguf')).toBe('BF16')
    expect(quantOf('model.gguf')).toBeNull()
  })

  it('finds the one asked for, in any case, with or without unsloth’s UD-', () => {
    const pick = (quant: string) => {
      const c = pickFile(SMALL, { repo: 'unsloth/Qwen3.5-0.8B-GGUF', quant }, cpu(8))
      return 'group' in c ? c.group.paths[0] : c.error
    }
    expect(pick('q4_k_m')).toBe('Qwen3.5-0.8B-Q4_K_M.gguf')
    expect(pick('UD-Q4_K_XL')).toBe('Qwen3.5-0.8B-UD-Q4_K_XL.gguf')
    expect(pick('Q4_K_XL')).toBe('Qwen3.5-0.8B-UD-Q4_K_XL.gguf')
    // Asked for by name, even the tiny ones.
    expect(pick('UD-IQ2_XXS')).toBe('Qwen3.5-0.8B-UD-IQ2_XXS.gguf')
    expect(pick('Q5_K_M')).toBe('no-quant')
  })
})

describe('split models', () => {
  const parts = [
    'Q4_K_M/Big-Q4_K_M-00001-of-00003.gguf',
    'Q4_K_M/Big-Q4_K_M-00002-of-00003.gguf',
    'Q4_K_M/Big-Q4_K_M-00003-of-00003.gguf',
  ]
  const BIG = [{ label: 'Q4_K_M', paths: parts, total_bytes: 140 * GB }, one('Big-UD-IQ1_S.gguf', 40 * GB)]
  const roomy: Hardware = {
    uma: false,
    vramUsable: 80 * GB,
    ramAvailable: 120 * GB,
    ramTotal: 128 * GB,
    gpuName: 'H100',
  }

  it('gets every part, named by Hermes as one model', () => {
    const c = pickFile(BIG, { repo: 'unsloth/Big-GGUF' }, roomy)
    expect('group' in c && c.group.paths).toEqual(parts)
    const model = hfModel(
      'unsloth/Big-GGUF',
      c as Extract<typeof c, { group: unknown }>,
      roomy,
      new Set(['Big-Q4_K_M']),
    )
    expect(model.source).toEqual({ repo: 'unsloth/Big-GGUF', file: parts[0], parts })
    expect(model).toMatchObject({ id: 'hf:Big-Q4_K_M', downloaded: true, bytes: 140 * GB, name: 'Big' })
    expect(stagedId(parts[1])).toBe('Big-Q4_K_M')
  })

  it('finds the model from a link to any of its parts', () => {
    const c = pickFile(BIG, { repo: 'unsloth/Big-GGUF', path: parts[2] }, roomy)
    expect('group' in c && c.group.paths[0]).toBe(parts[0])
    const byName = pickFile(BIG, { repo: 'unsloth/Big-GGUF', path: 'big-q4_k_m-00002-of-00003.gguf' }, roomy)
    expect('group' in byName && byName.group.paths[0]).toBe(parts[0])
    expect(pickFile(BIG, { repo: 'unsloth/Big-GGUF', path: 'Big-Q8_0.gguf' }, roomy)).toEqual({ error: 'no-file' })
  })
})

describe('the default, by what’s free', () => {
  const pick = (groups: FileGroup[], hw: Hardware) => {
    const c = pickFile(groups, { repo: 'someone/Model-GGUF' }, hw)
    return 'group' in c ? [c.quant, c.fit] : c.error
  }

  it('Q4_K_M when it fits, even with room for bigger', () => {
    expect(pick(SMALL, cpu(32))).toEqual(['Q4_K_M', 'fits'])
  })

  it('then UD-Q4_K_XL, then IQ4_XS, then 5 and 3 bits', () => {
    const without = (...quants: string[]) => SMALL.filter((g) => !quants.includes(quantOf(g.paths[0])!))
    expect(pick(without('Q4_K_M'), cpu(32))).toEqual(['UD-Q4_K_XL', 'fits'])
    expect(pick(without('Q4_K_M', 'UD-Q4_K_XL'), cpu(32))).toEqual(['IQ4_XS', 'fits'])
    const fives = [one('M-Q5_K_M.gguf', 5 * GB), one('M-Q3_K_M.gguf', 3 * GB), one('M-Q8_0.gguf', 8 * GB)]
    expect(pick(fives, cpu(32))).toEqual(['Q5_K_M', 'fits'])
  })

  it('a smaller quant when the 4-bit one doesn’t fit', () => {
    const nine = [one('M-Q6_K.gguf', 7.4 * GB), one('M-Q4_K_M.gguf', 5.7 * GB), one('M-Q3_K_M.gguf', 4.4 * GB)]
    // Hermes starts each at 64K here: 9 GB free only squeezes the Q3_K_M in, 10 fits it, 13 fits the Q4_K_M.
    expect(pick(nine, cpu(9))).toEqual(['Q3_K_M', 'tight'])
    expect(pick(nine, cpu(10))).toEqual(['Q3_K_M', 'fits'])
    expect(pick(nine, cpu(13))).toEqual(['Q4_K_M', 'fits'])
  })

  it('the smallest when nothing fits, which says so', () => {
    expect(pick(SMALL, cpu(1))).toEqual(['Q3_K_M', 'too-big'])
  })

  it('skips the 2-bit quants unless that’s all there is', () => {
    const tiny = [one('M-UD-IQ2_XXS.gguf', 1 * GB), one('M-Q4_K_M.gguf', 9 * GB)]
    expect(pick(tiny, cpu(5))).toEqual(['Q4_K_M', 'too-big'])
    expect(pick([one('M-UD-IQ2_XXS.gguf', 1 * GB)], cpu(5))).toEqual(['UD-IQ2_XXS', 'fits'])
  })

  it('never a vision projector or a draft head', () => {
    const odd = [one('mmproj-F16.gguf', 0.2 * GB), one('Model-draft-Q8_0.gguf', 0.3 * GB), one('model.gguf', 2 * GB)]
    expect(pick(odd, cpu(16))).toEqual([null, 'fits'])
    expect(pick([one('mmproj-F16.gguf', 0.2 * GB)], cpu(16))).toBe('no-gguf')
    expect(pick([], cpu(16))).toBe('no-gguf')
  })
})

describe('fit', () => {
  it('prices a repo one of the picks comes from exactly', () => {
    // The Qwen3.5 9B's window is small (8 of 32 layers attend); a stranger the same size is guessed at a
    // dense model's, so with less free it's judged too big where the known one still fits.
    expect(fitOf(5_680_522_464, 'unsloth/Qwen3.5-9B-GGUF', cpu(15, 32))).toBe('fits')
    expect(fitOf(5_680_522_464, 'someone/Other-9B-GGUF', cpu(9, 32))).toBe('too-big')
    expect(fitOf(29 * GB, 'someone/Other-27B-GGUF', cpu(10))).toBe('too-big')
  })

  it('in RAM, prices what it really holds at the window Hermes starts it at, not Hermes’s 64K estimate', () => {
    // With little free, Hermes starts the 2B at 64K, where it holds about 2.6 GB: 4 GB free fits it,
    // 3 GB only squeezes it in, 2 GB can't.
    const twoB = 1_280_835_840
    expect(fitOf(twoB, 'unsloth/Qwen3.5-2B-GGUF', cpu(4))).toBe('fits')
    expect(fitOf(twoB, 'unsloth/Qwen3.5-2B-GGUF', cpu(3))).toBe('tight')
    expect(fitOf(twoB, 'unsloth/Qwen3.5-2B-GGUF', cpu(2))).toBe('too-big')
  })

  it('agrees with the picks Murmur offers', () => {
    const machines = [cpu(3), cpu(4), cpu(5), cpu(6, 8), cpu(9), cpu(12), cpu(20, 32), cpu(40, 64)]
    for (const hw of machines) {
      for (const { pick, fits } of offersFor(hw).offers) {
        if (!('repo' in pick.source)) continue
        expect(
          fitOf(pick.bytes, pick.source.repo, hw) === 'fits',
          `${pick.id} on ${hw.ramAvailable / GB} GB free`,
        ).toBe(fits)
      }
    }
    // Every pick from a repo, offered or not.
    for (const hw of machines) {
      for (const pick of PICKS) {
        if (!('repo' in pick.source)) continue
        const offered = offersFor(hw, new Set(PICKS.filter((p) => p !== pick).map((p) => p.id))).offers[0]
        if (offered) expect(fitOf(pick.bytes, pick.source.repo, hw) === 'fits').toBe(offered.fits)
      }
    }
  })

  it('says what it really needs when it’s too big', () => {
    const c = pickFile([one('Qwen3.5-4B-Q4_K_M.gguf', 2_740_937_888)], { repo: 'unsloth/Qwen3.5-4B-GGUF' }, cpu(3))
    const model = hfModel('unsloth/Qwen3.5-4B-GGUF', c as Extract<typeof c, { group: unknown }>, cpu(3), new Set())
    expect(model.hf.fit).toBe('too-big')
    expect(model.fits).toBe(false)
    // Sizes keep their unit on the same line (a no-break space).
    expect(fitLine(model.hf).replace(/\s/g, ' ')).toBe('Needs about 4.8 GB of memory; 3.0 GB is free.')
  })

  it('with a graphics card, as Hermes reckons it', () => {
    const card: Hardware = { uma: false, vramUsable: 8 * GB, ramAvailable: 4 * GB, ramTotal: 16 * GB, gpuName: 'RTX' }
    // Hermes's estimate for the 9B is about 8.5 GB: inside the card and free RAM together.
    expect(fitOf(5_680_522_464, 'unsloth/Qwen3.5-9B-GGUF', card)).toBe('fits')
    expect(fitOf(29 * GB, 'someone/Other-27B-GGUF', card)).toBe('too-big')
  })
})

describe('words', () => {
  it('names', () => {
    expect(prettyName('unsloth/Qwen3.5-0.8B-GGUF')).toBe('Qwen3.5 0.8B')
    expect(prettyName('bartowski/Meta-Llama-3.1-8B-Instruct-GGUF')).toBe('Meta Llama 3.1 8B Instruct')
    expect(prettyName('google/gemma-3-4b-it-qat-q4_0-gguf')).toBe('gemma 3 4b it qat')
    expect(prettyName('someone/GGUF')).toBe('GGUF')
  })

  it('what went wrong, in one line', () => {
    const hermes = (message: string, status = 502) => lookupError({ status, message })
    expect(hermes('Could not list x/y: HTTP Error 401: Unauthorized')).toBe('No public model by that name.')
    expect(hermes('Could not list x/y: <urlopen error [Errno -3] Temporary failure in name resolution>')).toBe(
      'Couldn’t reach Hugging Face. Check the internet connection.',
    )
    expect(hermes('Not Found', 404)).toBe('This Hermes can’t get models from Hugging Face.')
    expect(hermes('Can’t reach Hermes. Check that it’s running.', 0)).toBe(
      'Can’t reach Hermes. Check that it’s running.',
    )
    expect(lookupError('no-gguf')).toBe('That repo has no models Hermes can run.')
    expect(lookupError('no-quant', { repo: 'a/b', quant: 'q5_k_m' })).toBe('That repo has no Q5_K_M version.')
    // A gated model lists fine; its download is what's refused.
    expect(plainError('HTTP Error 401: Unauthorized')).toBe('That model needs a Hugging Face sign-in.')
  })
})
