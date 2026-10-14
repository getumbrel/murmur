// Running a model on the machine Hermes is on, with Hermes's own local runtime
// (Hermes 0.22+, /api/local-models). Murmur picks what to offer
// (local-tiers.ts) and drives one setup: get the runtime if it's missing,
// download the model, switch the main agent to it. Each leg is a Hermes job,
// so a reload or a dropped connection finds it again in /jobs and carries on.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, HermesError } from '@/hermes/rest'
import {
  deviceModels,
  jobFor,
  plainError,
  stageOf,
  UNSUPPORTED,
  type DeviceModels,
  type DeviceSetup,
  type Job,
  type Status,
  type CatalogRow,
  type HardwareRow,
} from './local-jobs'
import { PICKS, stagedId, type ModelPick } from './local-tiers'

export type { DeviceModel, DeviceModels, DeviceSetup, SetupStage } from './local-jobs'

export const localRuntimeKey = ['local-runtime'] as const

const M = '/api/local-models'

/** What this Hermes can run, priced for its machine. Unsupported (older Hermes) answers 404. */
export function useDeviceModels(enabled = true) {
  return useQuery({
    queryKey: localRuntimeKey,
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<DeviceModels> => {
      let status: Status
      try {
        status = await api.get<Status>(`${M}/status`)
      } catch (e) {
        if (e instanceof HermesError && (e.status === 404 || e.status === 405)) return UNSUPPORTED
        throw e
      }
      // Something answered, but not Hermes's local runtime.
      if (typeof status?.runtime_installed !== 'boolean' || !Array.isArray(status.models)) return UNSUPPORTED
      const [hw, catalog] = await Promise.all([
        api.get<HardwareRow>(`${M}/hardware`),
        api.get<{ models: CatalogRow[] }>(`${M}/catalog`).catch(() => ({ models: [] as CatalogRow[] })),
      ])
      return deviceModels(status, hw, catalog.models)
    },
  })
}

const POLL_MS = 900
const INTENT = 'murmur:local-setup'

/** The pick being set up, so a reload can carry on. Best effort. */
const intent = {
  get: () => {
    try {
      return localStorage.getItem(INTENT)
    } catch {
      return null
    }
  },
  set: (id: string | null) => {
    try {
      if (id) localStorage.setItem(INTENT, id)
      else localStorage.removeItem(INTENT)
    } catch {
      // Private mode: no carrying on after a reload, that's all.
    }
  },
}

class Paused extends Error {}
class Stopped extends Error {}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * Drives a setup. `onReady` runs once Hermes has switched to the model.
 * Leaving the screen stops watching, not the download: Hermes keeps going,
 * and coming back picks it up again.
 */
export function useDeviceSetup(onReady: () => Promise<void> | void) {
  const qc = useQueryClient()
  const [setup, setSetup] = useState<DeviceSetup | null>(null)
  const run = useRef(0)
  const job = useRef<string | null>(null)
  const ready = useRef(onReady)
  ready.current = onReady

  /** Polls a job until it settles, reporting as it goes. */
  const follow = useCallback(async (id: string, pick: ModelPick, token: number): Promise<Job> => {
    job.current = id
    for (;;) {
      if (run.current !== token) throw new Stopped()
      let j: Job
      try {
        j = await api.get<Job>(`${M}/jobs/${id}`)
      } catch (e) {
        // Hermes restarted and forgot its jobs: start that leg again.
        if (e instanceof HermesError && e.status === 404) throw new Stopped('gone')
        await sleep(POLL_MS * 2)
        continue
      }
      if (run.current !== token) throw new Stopped()
      const stage = stageOf(j)
      setSetup((s) => ({
        id: pick.id,
        stage: j.status === 'paused' ? 'paused' : stage,
        // A download's bytes are the model's; the runtime's are its own and not shown.
        done: stage === 'downloading' ? j.done_bytes : (s?.done ?? 0),
        total: stage === 'downloading' ? j.total_bytes : (s?.total ?? null),
        eta: stage === 'downloading' ? (j.eta_seconds ?? null) : null,
        canPause: Boolean(j.can_pause),
      }))
      if (j.status === 'paused') throw new Paused()
      if (j.status === 'error') throw new Error(plainError(j.error))
      if (j.status === 'done') return j
      await sleep(POLL_MS)
    }
  }, [])

  /** The setup, from wherever it is. Each leg looks for Hermes's job first and only starts one when there's none. */
  const go = useCallback(
    async (pick: ModelPick, resumePaused: boolean) => {
      const token = ++run.current
      intent.set(pick.id)
      setSetup((s) => ({
        id: pick.id,
        stage: s?.id === pick.id && s.stage === 'downloading' ? 'downloading' : 'preparing',
        done: s?.id === pick.id ? s.done : 0,
        total: s?.id === pick.id ? s.total : pick.bytes,
        eta: null,
        canPause: false,
      }))
      const leg = async (existing: Job | undefined, start: () => Promise<{ job_id: string | null }>) => {
        if (existing?.status === 'paused') {
          if (!resumePaused) {
            await follow(existing.job_id, pick, token)
            return
          }
          await api.post(`${M}/download/resume`, { job_id: existing.job_id })
        }
        const id = existing && existing.status !== 'done' ? existing.job_id : (await start()).job_id
        if (id) await follow(id, pick, token)
      }
      try {
        const { jobs } = await api.get<{ jobs: Job[] }>(`${M}/jobs`)
        if ('catalog' in pick.source) {
          // One quickstart does it all; a download started from Hermes's own screens is waited for first.
          const id = pick.source.catalog
          const quick = jobFor(jobs, pick, ['quickstart'])
          const download = jobFor(jobs, pick, ['model-download'])
          if (!quick && download && download.status !== 'done') await leg(download, async () => ({ job_id: null }))
          await leg(quick?.status === 'done' ? undefined : quick, () =>
            api.post<{ job_id: string }>(`${M}/quickstart`, { model_id: id }),
          )
        } else {
          const { repo, file } = pick.source
          const model = stagedId(file)
          let status = await api.get<Status>(`${M}/status`)
          if (!status.runtime_installed) {
            const installing = jobs.find(
              (j) => j.kind === 'runtime-install' && (j.status === 'running' || j.status === 'paused'),
            )
            await leg(installing, () => api.post<{ job_id: string }>(`${M}/runtime/install`, {}))
            status = await api.get<Status>(`${M}/status`)
          }
          if (!status.models.some((m) => m.id === model)) {
            const downloading = jobFor(jobs, pick, ['model-download'])
            await leg(downloading?.status === 'done' ? undefined : downloading, () =>
              api.post<{ job_id: string | null }>(`${M}/download-browsed`, { repo, paths: [file] }),
            )
          }
          if (run.current !== token) return
          setSetup((s) => s && { ...s, stage: 'starting', done: s.total ?? s.done, eta: null, canPause: false })
          await leg(undefined, () => api.post<{ job_id: string }>(`${M}/activate`, { model_id: model }))
        }
        if (run.current !== token) return
        intent.set(null)
        job.current = null
        setSetup((s) => s && { ...s, stage: 'ready', done: s.total ?? s.done, eta: null, canPause: false })
        void qc.invalidateQueries({ queryKey: localRuntimeKey })
        await ready.current()
      } catch (e) {
        if (e instanceof Stopped) {
          // Hermes lost the job (it restarted): go again from what's there.
          if (e.message === 'gone' && run.current === token) return void go(pick, true)
          return
        }
        if (run.current !== token) return
        if (e instanceof Paused) return
        setSetup((s) => ({
          id: pick.id,
          stage: 'error',
          done: s?.done ?? 0,
          total: s?.total ?? null,
          eta: null,
          canPause: false,
          error: e instanceof HermesError ? plainError(e.message) : e instanceof Error ? e.message : plainError(null),
        }))
      }
    },
    [follow, qc],
  )

  const start = useCallback(
    (id: string) => {
      const pick = PICKS.find((p) => p.id === id)
      if (pick) void go(pick, true)
    },
    [go],
  )

  const pause = useCallback(async () => {
    if (job.current) await api.post(`${M}/download/pause`, { job_id: job.current }).catch(() => {})
  }, [])

  const resume = useCallback(() => {
    const pick = PICKS.find((p) => p.id === setup?.id)
    if (pick) void go(pick, true)
  }, [go, setup?.id])

  /** Stops the download (what's there is kept, so choosing it again picks up where it left off) and forgets the setup. */
  const cancel = useCallback(async () => {
    run.current++
    intent.set(null)
    const id = job.current
    job.current = null
    setSetup(null)
    if (id) await api.post(`${M}/download/pause`, { job_id: id }).catch(() => {})
  }, [])

  // Coming back: a setup under way (a Hermes job for one of the picks, or one this browser asked for) shows again.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const wanted = intent.get()
      const jobs = await api
        .get<{ jobs: Job[] }>(`${M}/jobs`)
        .then((r) => r.jobs)
        .catch(() => null)
      if (cancelled || !jobs) return
      const live = (j: Job | undefined) => j?.status === 'running' || j?.status === 'paused'
      const kinds = ['quickstart', 'model-download', 'model-activate']
      const active = PICKS.find((p) => live(jobFor(jobs, p, kinds)))
      const installing = jobs.some((j) => j.kind === 'runtime-install' && live(j))
      const pick = active ?? PICKS.find((p) => p.id === wanted)
      if (!pick) return
      if (!active && !installing) {
        // Asked for before a reload, with nothing running now: carry on unless it's done already.
        const status = await api.get<Status>(`${M}/status`).catch(() => null)
        const done = !status || 'catalog' in pick.source || status.active_model_id === stagedId(pick.source.file)
        if (done) return intent.set(null)
      }
      if (!cancelled) void go(pick, false)
    })()
    return () => {
      cancelled = true
      run.current++
    }
  }, [go])

  return { setup, start, pause, resume, cancel }
}
