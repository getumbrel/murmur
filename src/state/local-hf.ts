// Any model on Hugging Face, by name. What someone types is read as a repo,
// maybe with a quant or a file; Hermes lists the repo's files
// (/api/local-models/search/files: a split model's parts come as one entry,
// vision add-ons and draft heads left out); this picks the one to download
// and prices it with the same math as the picks in local-tiers.ts. No
// fetching here; local-runtime.ts asks.
//
// Hermes's download-browsed takes the model's own files only, so a model
// added this way is text only, like the small picks.

import type { DeviceModel, Fit, HFDetails } from './local-jobs'
import {
  FLOOR,
  formatSize,
  held,
  inRam,
  need,
  OVERHEAD,
  PICKS,
  Q8,
  stagedId,
  usable,
  type Hardware,
  type Shape,
  type Source,
} from './local-tiers'

/** What was typed: a repo, and maybe which quant or which file. */
export type ModelRef = { repo: string; quant?: string; path?: string }

/** One downloadable model in a repo, as Hermes lists it. */
export type FileGroup = { label: string; paths: string[]; total_bytes: number; fit?: string }

const NAME = /^[A-Za-z0-9][\w.-]*$/
const GGUF = /\.gguf$/i
const SPLIT = /-\d{5}-of-\d{5}(?=\.gguf$)/i
const QUANT = /(?:UD-)?(?:I?Q\d|TQ\d)(?:_[A-Z0-9]+)*|\b(?:BF16|F16|F32|MXFP4)\b/gi

/**
 * `owner/repo`, `owner/repo:Q4_K_M`, `hf.co/owner/repo[:quant]`, a
 * huggingface.co link (to the repo, a quant's folder, or a file), or
 * `owner/repo/file.gguf`. Anything else is null.
 */
export function parseModelRef(input: string): ModelRef | null {
  let s = input
    .trim()
    .replace(/^["'<]+|["'>]+$/g, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^(?:www\.)?(?:huggingface\.co|hf\.co)\//i, '')
    .replace(/[?#].*$/, '')
  let quant: string | undefined
  const colon = s.lastIndexOf(':')
  if (colon > 0) {
    quant = s.slice(colon + 1).trim()
    s = s.slice(0, colon)
  }
  const [owner, name, ...rest] = s.split('/').filter(Boolean)
  if (!owner || !name || !NAME.test(owner) || !NAME.test(name) || /^(?:models|datasets|spaces)$/.test(owner))
    return null
  const ref: ModelRef = { repo: `${owner}/${name}` }
  // /blob/main/… and /resolve/main/… name a file; /tree/main/Q4_K_M a quant's folder.
  const [kind, , ...after] = rest
  const tail = kind === 'blob' || kind === 'resolve' || kind === 'tree' ? after : rest
  const path = decode(tail.join('/'))
  if (path && GGUF.test(path)) ref.path = path
  else if (kind === 'tree' && path) quant = path.split('/').at(-1)
  if (quant && GGUF.test(quant)) ref.path ??= quant
  else if (quant && !/^latest$/i.test(quant)) ref.quant = quant
  return ref
}

function decode(s: string) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** A file's quant, "Q4_K_M" or "UD-Q4_K_XL", from its name; null when it doesn't say. */
export function quantOf(path: string): string | null {
  const stem = path.split('/').at(-1)!.replace(SPLIT, '').replace(GGUF, '')
  return stem.match(QUANT)?.at(-1)?.toUpperCase() ?? null
}

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()
const loose = (q: string) => q.toUpperCase().replace(/^UD-/, '')

/**
 * Preference when nothing was asked for: the 4-bit quants that run best for
 * their size, then 5 and 3 bits, then bigger, then the very small ones that
 * lose too much (only when there's nothing else).
 */
// prettier-ignore
const ORDER = [
  'Q4_K_M', 'UD-Q4_K_XL', 'IQ4_XS', 'Q4_K_S', 'IQ4_NL', 'Q4_0', 'Q4_1', 'MXFP4',
  'Q5_K_M', 'UD-Q5_K_XL', 'Q5_K_S', 'Q5_0',
  'Q3_K_M', 'UD-Q3_K_XL', 'Q3_K_L', 'IQ3_M', 'Q3_K_S', 'UD-IQ3_XXS', 'IQ3_XXS',
  'Q6_K', 'UD-Q6_K_XL', 'Q8_0', 'UD-Q8_K_XL', 'BF16', 'F16',
]

function rank(quant: string | null) {
  if (!quant) return ORDER.length
  const i = ORDER.indexOf(quant)
  if (i >= 0) return i
  // Same family, unlisted: just after its family's own.
  const bits = /^(?:UD-)?I?Q(\d)/.exec(quant)?.[1]
  const last = { '4': 'MXFP4', '5': 'Q5_0', '3': 'IQ3_XXS', '6': 'UD-Q6_K_XL', '8': 'UD-Q8_K_XL' }[bits ?? '']
  return last ? ORDER.indexOf(last) + 0.5 : ORDER.length
}

/** Too small to be worth it (2 bits and under), or too big for any machine to bother (F32). */
const meagre = (quant: string | null) => Boolean(quant && /^(?:UD-)?(?:I?Q[12]|TQ\d)|^F32$/.test(quant))

/** Vision projectors, draft heads and other companions: never the model itself. */
const companion = (path: string) => /^(?:mmproj|dspark|mtp-)|draft/i.test(path.split('/').at(-1)!)

/**
 * A model's shape, for the same memory math as the picks. A repo one of the
 * picks comes from is known exactly; otherwise its window is guessed at half
 * its weights per 64K, between 256 MB and Hermes's own 4 GB fill-in, and
 * taken to reach the 256K the picks do.
 */
function shapeOf(bytes: number, repo: string): Shape {
  const known = PICKS.find((p) => 'repo' in p.source && same(p.source.repo, repo))
  if (known) return { ...known, weights: bytes }
  const window = Math.min(4 * 2 ** 30, Math.max(2 ** 28, bytes / 2))
  return { weights: bytes, kvPerToken: window / (FLOOR * Q8), recurrentLayers: 0 }
}

/** Memory a model needs to start, as Hermes reckons it (its 64K estimate). */
export const needOf = (bytes: number, repo: string) => need(shapeOf(bytes, repo))

/**
 * The memory it needs here, honestly. On a CPU or integrated graphics, what
 * it really holds at the window Hermes starts it at (local-tiers.ts `held`);
 * with a graphics card, Hermes's estimate, which it won't launch without.
 */
export const heldOf = (bytes: number, repo: string, hw: Hardware) =>
  inRam(hw) ? held(shapeOf(bytes, repo), hw) : needOf(bytes, repo)

/**
 * Fits; might (worth trying); or can't. Judged as the picks are: in RAM, what
 * it holds against what Hermes lets it use (fits) or just what's free (tight);
 * with a graphics card, Hermes's estimate fits, or its weights do with no window.
 */
export function fitOf(bytes: number, repo: string, hw: Hardware): Fit {
  const room = usable(hw)
  const holds = heldOf(bytes, repo, hw)
  if (holds <= room) return 'fits'
  if (inRam(hw)) return holds <= hw.ramAvailable ? 'tight' : 'too-big'
  return bytes + OVERHEAD <= room ? 'tight' : 'too-big'
}

export type Choice =
  { group: FileGroup; quant: string | null; fit: Fit } | { error: 'no-gguf' | 'no-quant' | 'no-file' }

/**
 * Which of a repo's files to get. The file or quant asked for when there is
 * one; otherwise the most preferred quant that fits, else the smallest that
 * might, else the smallest (which then says it's too big).
 */
export function pickFile(groups: FileGroup[], ref: ModelRef, hw: Hardware): Choice {
  const all = groups.filter((g) => g.paths.length && GGUF.test(g.paths[0]) && !g.paths.some(companion))
  if (!all.length) return { error: 'no-gguf' }
  const choose = (group: FileGroup) => {
    const quant = quantOf(group.paths[0])
    return { group, quant, fit: fitOf(group.total_bytes, ref.repo, hw) }
  }
  const smallest = (list: FileGroup[]) => list.reduce((a, b) => (b.total_bytes < a.total_bytes ? b : a))

  if (ref.path) {
    const want = ref.path.toLowerCase()
    const file = (p: string) => p.toLowerCase().split('/').at(-1)
    const hit =
      all.find((g) => g.paths.some((p) => p.toLowerCase() === want)) ??
      (!want.includes('/') ? all.find((g) => g.paths.some((p) => file(p) === want)) : undefined)
    return hit ? choose(hit) : { error: 'no-file' }
  }

  if (ref.quant) {
    const exact = all.filter((g) => same(quantOf(g.paths[0]) ?? '', ref.quant!))
    const near = all.filter((g) => loose(quantOf(g.paths[0]) ?? '') === loose(ref.quant!))
    const hits = exact.length ? exact : near
    return hits.length ? choose(smallest(hits)) : { error: 'no-quant' }
  }

  const sane = all.filter((g) => !meagre(quantOf(g.paths[0])))
  const pool = (sane.length ? sane : all).map(choose)
  const best = pool.filter((c) => c.fit === 'fits').sort((a, b) => rank(a.quant) - rank(b.quant))[0]
  if (best) return best
  const tight = pool.filter((c) => c.fit === 'tight')
  const least = (list: typeof pool) => list.reduce((a, b) => (b.group.total_bytes < a.group.total_bytes ? b : a))
  return least(tight.length ? tight : pool)
}

/** "unsloth/Qwen3.5-0.8B-GGUF" → "Qwen3.5 0.8B"; a quant in the name goes too. */
export function prettyName(repo: string) {
  const full = repo.split('/').at(-1)!
  const name = full.replace(/[-_.]gguf$/i, '').replace(new RegExp(`[-_.](?:${QUANT.source})$`, 'i'), '')
  return name.replace(/[-_]+/g, ' ').trim() || full
}

/** Buddy hues for a model found by name: never the reds and greens that mean "stop" and "fits", nor a yellow button. */
const HUES = [172, 192, 210, 236, 258, 278, 296, 314, 330, 346]

/** A steady hue per repo, for its buddy. */
export function hueOf(repo: string) {
  let h = 0
  for (const ch of repo.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return HUES[h % HUES.length]
}

/** A model typed in by name, ready to set up: its card, and where its files are. */
export type HFModel = DeviceModel & { hf: HFDetails; source: Extract<Source, { repo: string }> }

/** The chosen file, as a card. `staged` are Hermes's ids for what's already downloaded. */
export function hfModel(
  repo: string,
  choice: Extract<Choice, { group: FileGroup }>,
  hw: Hardware,
  staged: ReadonlySet<string>,
): HFModel {
  const { group, quant, fit } = choice
  const file = group.paths[0]
  const id = stagedId(file)
  return {
    id: `hf:${id}`,
    name: prettyName(repo),
    bytes: group.total_bytes,
    speed: '',
    smarts: '',
    hue: hueOf(repo),
    recommended: false,
    fits: fit !== 'too-big',
    downloaded: staged.has(id),
    hf: {
      repo,
      quant: quant ?? id,
      fit,
      least: heldOf(group.total_bytes, repo, hw),
      // In RAM, what's free is the honest comparison; with a card, all Hermes may use.
      room: inRam(hw) ? hw.ramAvailable : usable(hw),
    },
    source: { repo, file, ...(group.paths.length > 1 && { parts: group.paths }) },
  }
}

/** What went wrong finding a model, in one short line. */
export function lookupError(
  why: 'unreadable' | Extract<Choice, { error: string }>['error'] | { status: number; message: string },
  ref?: ModelRef | null,
): string {
  if (why === 'unreadable') return 'Try a Hugging Face name, like unsloth/Qwen3.5-9B-GGUF.'
  if (why === 'no-gguf') return 'That repo has no models Hermes can run.'
  if (why === 'no-quant') return `That repo has no ${ref?.quant?.toUpperCase() ?? 'such'} version.`
  if (why === 'no-file') return 'That file isn’t in the repo.'
  const { status, message } = why
  if (status === 0) return message
  if (status === 404 || status === 405) return 'This Hermes can’t get models from Hugging Face.'
  if (/gated|restricted|HTTP Error 403/i.test(message)) return 'That model needs a Hugging Face sign-in.'
  // Hugging Face answers 401 for a private repo and for one that isn't there, alike.
  if (/HTTP Error 40[14]|not found|Unauthorized/i.test(message)) return 'No public model by that name.'
  return 'Couldn’t reach Hugging Face. Check the internet connection.'
}

/** Under the button, for a model that can't run here, or only might. */
export const fitLine = (hf: HFDetails) =>
  hf.fit === 'too-big'
    ? `Needs about ${formatSize(hf.least)} of memory; ${formatSize(hf.room)} is free.`
    : `About ${formatSize(hf.room)} free right now. Closing an app or two helps.`
