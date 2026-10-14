// Which model to run on the machine Hermes is on. Hermes 0.22 runs models
// itself (its local runtime, /api/local-models); this table is what Murmur
// offers from it, smallest first, and the one place to update as models move.
//
// Each pick is priced the way Hermes prices a launch
// (hermes_cli/local_runtime/estimator.py physics_check, context_policy.py):
// the weights, plus the KV cache at Hermes's 64K floor (q8 with flash
// attention, ×1.2 when a draft head rides along), plus 4 MiB of state per
// recurrent layer, plus 1.5 GiB of runtime overhead. Hermes refuses to launch
// a model whose total exceeds what it may use, which is its `hardware`
// answer: on CPU and integrated graphics (`uma`), 80% of the memory free right
// now; with a graphics card, its usable memory plus free RAM.
//
// Sizes are the exact files on Hugging Face (huggingface.co/api/models/<repo>/tree/main),
// checked October 2026. Text only: the vision add-on isn't downloaded for the
// small ones. The two catalog picks are Hermes's own entries, which it
// downloads with their extras; its catalog's `fits` and size win when present.

const GB = 1e9
const MIB = 1 << 20
const GIB = 1 << 30

/** Hermes's minimum window (context_policy.FLOOR). */
export const FLOOR = 64 * 1024
/** q8_0 KV with flash attention, per f16 byte (estimator.kv_dtype_factor). */
export const Q8 = 34 / 32 / 2
const RECURRENT_STATE = 4 * MIB
/** context_policy.RUNTIME_OVERHEAD_BYTES. */
export const OVERHEAD = 1.5 * GIB

export type Speed = 'Fastest' | 'Fast' | 'Steady' | 'Slow'
export type Smarts = 'Basic' | 'Good' | 'Smart' | 'Smarter' | 'Smartest'

export type Source =
  /** A Hermes catalog entry: one quickstart job installs, downloads and switches to it. */
  | { catalog: string }
  /** A file from Hugging Face, through Hermes's download-browsed; `parts` are every file of a split one, in order. */
  | { repo: string; file: string; parts?: string[] }

export type ModelPick = {
  id: string
  name: string
  /** Picks that are the same model at another size share a line: only one is ever offered. */
  line: string
  source: Source
  /** The download. */
  bytes: number
  /** What loads into memory (the main file; a catalog entry's extras ride on top). */
  weights: number
  /** KV bytes per token at f16, over the full-attention layers (the rest are recurrent). */
  kvPerToken: number
  recurrentLayers: number
  /** Carries a draft head, whose context adds about a fifth (estimator.ModelProfile.kv_scale). */
  draft?: boolean
  /** Higher is better at agent work; decides between picks that fit. */
  rank: number
  smarts: Smarts
  speed: { cpu: Speed; gpu: Speed }
  /** Buddy hue for its card. */
  hue: number
}

export const PICKS: ModelPick[] = [
  {
    id: 'qwen3.5-2b',
    name: 'Qwen3.5 2B',
    line: 'qwen3.5-2b',
    source: { repo: 'unsloth/Qwen3.5-2B-GGUF', file: 'Qwen3.5-2B-Q4_K_M.gguf' },
    bytes: 1_280_835_840,
    weights: 1_280_835_840,
    // 6 of 24 layers attend, 2 KV heads × (256 + 256) dims × 2 bytes.
    kvPerToken: 6 * 2048,
    recurrentLayers: 18,
    rank: 1,
    smarts: 'Basic',
    speed: { cpu: 'Fastest', gpu: 'Fastest' },
    hue: 192,
  },
  {
    id: 'qwen3.5-4b',
    name: 'Qwen3.5 4B',
    line: 'qwen3.5-4b',
    source: { repo: 'unsloth/Qwen3.5-4B-GGUF', file: 'Qwen3.5-4B-Q4_K_M.gguf' },
    bytes: 2_740_937_888,
    weights: 2_740_937_888,
    // 8 of 32 layers attend, 4 KV heads × 512 × 2.
    kvPerToken: 8 * 4096,
    recurrentLayers: 24,
    rank: 2,
    smarts: 'Good',
    speed: { cpu: 'Fast', gpu: 'Fastest' },
    hue: 278,
  },
  {
    id: 'qwen3.5-9b',
    name: 'Qwen3.5 9B',
    line: 'qwen3.5-9b',
    source: { repo: 'unsloth/Qwen3.5-9B-GGUF', file: 'Qwen3.5-9B-Q4_K_M.gguf' },
    bytes: 5_680_522_464,
    weights: 5_680_522_464,
    kvPerToken: 8 * 4096,
    recurrentLayers: 24,
    rank: 3,
    smarts: 'Smart',
    speed: { cpu: 'Steady', gpu: 'Fastest' },
    hue: 222,
  },
  {
    // The same 9B with finer weights, when there's room for them.
    id: 'qwen3.5-9b-q6',
    name: 'Qwen3.5 9B',
    line: 'qwen3.5-9b',
    source: { repo: 'unsloth/Qwen3.5-9B-GGUF', file: 'Qwen3.5-9B-Q6_K.gguf' },
    bytes: 7_458_301_152,
    weights: 7_458_301_152,
    kvPerToken: 8 * 4096,
    recurrentLayers: 24,
    rank: 3.5,
    smarts: 'Smart',
    speed: { cpu: 'Steady', gpu: 'Fastest' },
    hue: 222,
  },
  {
    // Mixture of experts: 35B of knowledge, about 3B at work per word, so quick even without a graphics card.
    id: 'qwen3.6-35b-a3b',
    name: 'Qwen3.6 35B',
    line: 'qwen3.6-35b-a3b',
    source: { catalog: 'qwen3.6-35b-a3b' },
    bytes: 22_663_387_424 + 899_283_584,
    weights: 22_663_387_424 + 899_283_584,
    kvPerToken: 10 * 2048,
    recurrentLayers: 30,
    draft: true,
    rank: 4,
    smarts: 'Smarter',
    speed: { cpu: 'Fast', gpu: 'Fastest' },
    hue: 338,
  },
  {
    // The 27B in less space, for 16–22 GB to spare.
    id: 'qwen3.8-27b-q3',
    name: 'Qwen3.8 27B',
    line: 'qwen3.8-27b',
    source: { repo: 'unsloth/Qwen3.8-27B-GGUF', file: 'Qwen3.8-27B-UD-Q3_K_XL.gguf' },
    bytes: 13_146_393_504,
    weights: 13_146_393_504,
    kvPerToken: 16 * 4096,
    recurrentLayers: 48,
    rank: 4.5,
    smarts: 'Smartest',
    speed: { cpu: 'Slow', gpu: 'Fast' },
    hue: 28,
  },
  {
    // Hermes's own pick for agent work.
    id: 'qwen3.8-27b',
    name: 'Qwen3.8 27B',
    line: 'qwen3.8-27b',
    source: { catalog: 'qwen3.8-27b' },
    bytes: 17_395_586_656,
    weights: 17_395_586_656,
    kvPerToken: 16 * 4096,
    recurrentLayers: 48,
    draft: true,
    rank: 5,
    smarts: 'Smartest',
    speed: { cpu: 'Slow', gpu: 'Fast' },
    hue: 28,
  },
  {
    id: 'qwen3.8-27b-q8',
    name: 'Qwen3.8 27B',
    line: 'qwen3.8-27b',
    source: { repo: 'unsloth/Qwen3.8-27B-GGUF', file: 'Qwen3.8-27B-Q8_0.gguf' },
    bytes: 29_047_086_048,
    weights: 29_047_086_048,
    kvPerToken: 16 * 4096,
    recurrentLayers: 48,
    rank: 5.5,
    smarts: 'Smartest',
    speed: { cpu: 'Slow', gpu: 'Fast' },
    hue: 28,
  },
]

/** What memory math needs of a model: a pick, or one found by name (local-hf.ts). */
export type Shape = Pick<ModelPick, 'weights' | 'kvPerToken' | 'recurrentLayers' | 'draft'>

/** Hermes's /api/local-models/hardware, as Murmur reads it. */
export type Hardware = {
  uma: boolean
  vramUsable: number
  ramAvailable: number
  ramTotal: number
  gpuName?: string | null
}

/** What grows with the window: the q8 KV cache over the attending layers, and the recurrent layers' state. */
const windowBytes = (pick: Shape, window: number) =>
  pick.kvPerToken * window * Q8 * (pick.draft ? 1.2 : 1) + pick.recurrentLayers * RECURRENT_STATE

/** Memory a pick needs to start, as Hermes reckons it. */
export function need(pick: Shape) {
  return pick.weights + windowBytes(pick, FLOOR) + OVERHEAD
}

/** What Hermes lets a model use right now. */
export const usable = (hw: Hardware) => (hw.uma ? hw.vramUsable : hw.vramUsable + hw.ramAvailable)

// On a CPU or integrated graphics (most Umbrels) the model lives in system
// RAM, beside every other app, and two things about Hermes 0.22 decide whether
// it survives there:
//
// - The window it starts at. Hermes climbs its ladder (64K, 96K, 144K, 216K,
//   the model's own 256K) as far as its estimate fits 80% of the RAM the
//   machine *has*, not what's free (hardware.probe_budget(planning=True);
//   launch_budget() never narrows unified memory). So a 16 GB Umbrel starts
//   the 2B and 4B at their full 256K, however little is free.
// - What that window really costs. llama.cpp zeroes the whole KV cache when it
//   loads, so all of it is held from the first token. Hermes's estimate adds
//   1.5 GiB for graphics-card contexts and a 2 GB logits buffer that a CPU
//   never fills; what's held is the weights, the window, and about RUNTIME
//   more (measured: Qwen3.5 0.8B and 2B, llama.cpp b11370's CPU build, with
//   Hermes's flags, at 64K and 256K).
//
// Murmur prices a pick at that window as it's really held, against what's
// free now, so a pick that fits starts and stays up. If Hermes ever sizes the
// window to free memory (as it does for graphics cards), only `startWindow`
// changes: smaller windows, more that fits.

/** The ladder Hermes climbs (context_policy.ladder): 64K, then half as much again, up to the model's own. */
const NATIVE = 256 * 1024
const LADDER = [FLOOR, FLOOR * 1.5, FLOOR * 2.25, FLOOR * 3.375, NATIVE]
/** The logits buffer Hermes prices for its 2048-token microbatch (context_policy.ub_logits_bytes), at Qwen's 248K vocabulary. */
const LOGITS = 2048 * 248_320 * 4
/** What llama.cpp holds beyond the weights and window: compute buffers, slots, the process itself. */
const RUNTIME = 0.8 * GB

/** The window Hermes starts a pick at on this machine (context_policy.initial_window, with the capacity budget). */
export function startWindow(pick: Shape, hw: Hardware) {
  const budget = hw.uma ? hw.ramTotal * 0.8 : hw.vramUsable
  const estimate = (window: number) => pick.weights + windowBytes(pick, window) + OVERHEAD + LOGITS
  return LADDER.filter((w) => estimate(w) <= budget).at(-1) ?? FLOOR
}

/** The memory a pick really holds once started on a CPU or integrated graphics. */
export const held = (pick: Shape, hw: Hardware) => pick.weights + windowBytes(pick, startWindow(pick, hw)) + RUNTIME

/** Runs out of system RAM: no graphics card, nor unified memory with an NVIDIA chip behind it. */
export const inRam = (hw: Hardware) => hw.uma && !hw.gpuName

/**
 * Whether a pick runs on a graphics processor: a card it fits on, or unified
 * memory Hermes found an NVIDIA chip behind. CPU and integrated graphics (most
 * Umbrels) aren't.
 */
function onGpu(pick: ModelPick, hw: Hardware) {
  if (hw.uma) return Boolean(hw.gpuName)
  return hw.vramUsable > 0 && need(pick) <= hw.vramUsable
}

export const speedOn = (pick: ModelPick, hw: Hardware): Speed => pick.speed[onGpu(pick, hw) ? 'gpu' : 'cpu']

export type Offer = {
  pick: ModelPick
  /** First of the two, the one Murmur suggests. */
  recommended: boolean
  speed: Speed
  /** Hermes would start it with what's free right now. */
  fits: boolean
}

export type Offers = {
  offers: Offer[]
  /** Even the suggestion is a squeeze: what's free now, to say so. */
  tight: { free: number } | null
}

/**
 * Up to two picks for this machine. The suggestion is the best one that fits
 * and isn't slow here; the other is the best one above it that fits too (a
 * trade of speed for smarts, e.g. the 27B on a machine without a graphics
 * card), else the next one down. When nothing fits with room to spare, the
 * smallest that still fits in what's free, marked tight; when even that won't,
 * nothing: an offer that falls over mid-reply is worse than none.
 *
 * `vetoed` holds picks Hermes's catalog says can't run here.
 */
export function offersFor(hw: Hardware, vetoed: ReadonlySet<string> = new Set()): Offers {
  const room = usable(hw)
  const picks = PICKS.filter((p) => !vetoed.has(p.id)).sort((a, b) => a.rank - b.rank)
  if (!picks.length) return { offers: [], tight: null }
  // In RAM: what it really holds, with Hermes's 20% to spare to fit, or just inside what's free to squeeze.
  const fits = (p: ModelPick) => (inRam(hw) ? held(p, hw) : need(p)) <= room
  const squeezes = (p: ModelPick) => !inRam(hw) || held(p, hw) <= hw.ramAvailable
  if (!squeezes(picks[0])) return { offers: [], tight: null }
  const good = picks.filter((p) => fits(p) && speedOn(p, hw) !== 'Slow')
  const first = good.at(-1) ?? picks[0]
  const i = picks.indexOf(first)
  const up = picks
    .slice(i + 1)
    .filter((p) => p.line !== first.line && fits(p))
    .at(-1)
  const down = picks
    .slice(0, i)
    .reverse()
    .find((p) => p.line !== first.line)
  const second = up ?? down
  const offer = (pick: ModelPick, recommended: boolean): Offer => ({
    pick,
    recommended,
    speed: speedOn(pick, hw),
    fits: fits(pick),
  })
  return {
    offers: [offer(first, true), ...(second ? [offer(second, false)] : [])],
    tight: fits(first) ? null : { free: hw.ramAvailable },
  }
}

/** Hermes's name for a downloaded file: its name without folder, `.gguf`, or a split's `-00001-of-00003`. */
export const stagedId = (file: string) =>
  file
    .split('/')
    .at(-1)!
    .replace(/(?:-\d{5}-of-\d{5})?\.gguf$/i, '')

/** "2.7 GB"; under a gigabyte, "530 MB". */
export function formatSize(bytes: number) {
  const gb = bytes / GB
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`
}
