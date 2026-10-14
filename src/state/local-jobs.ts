// What Hermes's local runtime says (/api/local-models), read for Murmur: the
// offers for this machine, and its jobs as one setup with one bar. No
// fetching here; local-runtime.ts asks and drives.

import { offersFor, PICKS, stagedId, type Hardware, type Offers, type ModelPick } from './local-tiers'

export type Status = {
  runtime_installed: boolean
  active_model_id: string | null
  models: { id: string; size_bytes: number }[]
}

export type HardwareRow = {
  uma: boolean
  vram_usable_bytes: number
  ram_available_bytes: number
  ram_total_bytes: number
  gpu_name: string | null
}

export type CatalogRow = {
  id: string
  fits: boolean
  size_bytes: number
  downloaded: boolean
  downloaded_model_id: string | null
  model_id?: string
}

export type Job = {
  job_id: string
  kind: 'runtime-install' | 'model-download' | 'quickstart' | 'model-activate' | string
  model_id: string | null
  status: 'running' | 'paused' | 'done' | 'error'
  phase: string
  total_bytes: number | null
  done_bytes: number
  eta_seconds?: number | null
  can_pause?: boolean
  can_resume?: boolean
  error: string | null
}

export type DeviceModel = {
  id: string
  name: string
  bytes: number
  speed: string
  smarts: string
  hue: number
  recommended: boolean
  fits: boolean
  /** Already on the machine: no download. */
  downloaded: boolean
}

export type DeviceModels = {
  /** This Hermes can run models itself. */
  supported: boolean
  models: DeviceModel[]
  /** What's free now, when even the suggestion is a squeeze. */
  tight: { free: number } | null
}

export const UNSUPPORTED: DeviceModels = { supported: false, models: [], tight: null }

/** Hermes's answers → the offers, with the catalog's own verdicts and sizes where it has them. */
export function deviceModels(status: Status, hw: HardwareRow, catalog: CatalogRow[]): DeviceModels {
  const rows = new Map(catalog.map((r) => [r.id, r]))
  const vetoed = new Set(
    PICKS.filter((p) => 'catalog' in p.source && rows.get(p.source.catalog)?.fits === false).map((p) => p.id),
  )
  const hardware: Hardware = {
    uma: hw.uma,
    vramUsable: hw.vram_usable_bytes,
    ramAvailable: hw.ram_available_bytes,
    ramTotal: hw.ram_total_bytes,
    gpuName: hw.gpu_name,
  }
  const { offers, tight }: Offers = offersFor(hardware, vetoed)
  const staged = new Set(status.models.map((m) => m.id))
  return {
    supported: true,
    tight,
    models: offers.map(({ pick, recommended, speed, fits }) => {
      const row = 'catalog' in pick.source ? rows.get(pick.source.catalog) : undefined
      return {
        id: pick.id,
        name: pick.name,
        bytes: row?.size_bytes || pick.bytes,
        speed,
        smarts: pick.smarts,
        hue: pick.hue,
        recommended,
        fits,
        downloaded: row ? row.downloaded : staged.has(stagedId((pick.source as { file: string }).file)),
      }
    }),
  }
}

// ── One setup, from nothing to a working model ──────────────────────────────

export type SetupStage = 'preparing' | 'downloading' | 'starting' | 'ready' | 'paused' | 'error'

export type DeviceSetup = {
  /** The pick being set up. */
  id: string
  stage: SetupStage
  /** Model bytes so far, and of how many. */
  done: number
  total: number | null
  /** Seconds left, when Hermes can tell. */
  eta: number | null
  canPause: boolean
  error?: string
}

/** Which of the three looks a job's phase belongs to. */
export function stageOf(job: Pick<Job, 'kind' | 'phase'>): 'preparing' | 'downloading' | 'starting' {
  if (job.kind === 'runtime-install') return 'preparing'
  if (job.kind === 'model-download') return 'downloading'
  if (job.kind === 'model-activate') return 'starting'
  // A quickstart walks through all three.
  if (job.phase === 'downloading') return 'downloading'
  if (job.phase === 'starting' || job.phase.includes('runtime')) return 'preparing'
  return 'starting'
}

/**
 * The whole setup as one bar: a sliver for getting ready, nearly all of it
 * for the download (by bytes), the last stretch for starting up.
 */
export function overall(setup: Pick<DeviceSetup, 'stage' | 'done' | 'total'>) {
  const bytes = setup.total ? Math.min(1, setup.done / setup.total) : 0
  switch (setup.stage) {
    case 'preparing':
      return 0.03
    case 'downloading':
    case 'paused':
    case 'error':
      return 0.04 + 0.92 * bytes
    case 'starting':
      return 0.97
    case 'ready':
      return 1
  }
}

/** Hermes's failure, in one plain line. */
export function plainError(raw: string | null | undefined): string {
  const text = raw ?? ''
  if (/no space|ENOSPC|disk (is )?full|not enough (disk|storage|space)/i.test(text)) return 'Not enough storage space.'
  if (/needs ~|VRAM\+RAM|could not start|out of memory|OOM|cannot allocate/i.test(text))
    return 'Not enough free memory to start it.'
  if (
    /hugging ?face|urlopen|timed? ?out|connection|resolve|network|unreachable|HTTP Error 5|SSL|getaddrinfo/i.test(text)
  )
    return 'Couldn’t reach the download. Check the internet connection.'
  if (/already running/i.test(text)) return 'Another setup is already running.'
  return 'Something went wrong. Try again.'
}

/** Hermes's job for this pick, if one is under way (running or paused) or just finished. */
export function jobFor(jobs: Job[], pick: ModelPick, kinds: string[]): Job | undefined {
  const target = 'catalog' in pick.source ? pick.source.catalog : stagedId(pick.source.file)
  return jobs.find((j) => kinds.includes(j.kind) && j.model_id === target && j.status !== 'error')
}
