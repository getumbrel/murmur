// Vitest global setup: one Hermes, one fake model and one Murmur server for the
// whole run, with the fake model connected as the main agent's model. Their
// logs land in test-results/contract/ (CI keeps them when a run fails).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import { MODELS, startFakeModel } from './fake-model'
import { MAIL_PLUGIN, startHermes, startMurmur } from './harness'

declare module 'vitest' {
  export interface ProvidedContext {
    /** Murmur's server, which every test goes through. */
    murmur: string
    /** The fake model: `local` from the tests, `forHermes` from inside its container. */
    model: { local: string; forHermes: string }
    /** The Hermes container, directly (only the sign-in tests skip Murmur). */
    hermes: { image: string; version: string; url: string; container: string }
  }
}

const LOGS = 'test-results/contract'

export default async function setup(project: TestProject) {
  const model = await startFakeModel()
  const hermes = await startHermes().catch(async (error) => {
    await model.close()
    throw error
  })
  console.log(`Contract suite: Hermes ${hermes.version} (${hermes.image})${MAIL_PLUGIN ? `, with murmur-mail from ${MAIL_PLUGIN}` : ''}`)
  const dataDir = mkdtempSync(join(tmpdir(), 'murmur-contract-'))
  const murmur = await startMurmur(hermes.url, dataDir).catch(async (error) => {
    await Promise.all([hermes.stop(), model.close()])
    rmSync(dataDir, { recursive: true, force: true })
    throw error
  })

  const teardown = async () => {
    mkdirSync(LOGS, { recursive: true })
    writeFileSync(join(LOGS, 'hermes.log'), await hermes.logs())
    writeFileSync(join(LOGS, 'murmur.log'), murmur.output())
    await murmur.stop()
    await hermes.stop()
    await model.close()
    rmSync(dataDir, { recursive: true, force: true })
  }

  try {
    const forHermes = `http://host.docker.internal:${model.port}/v1`
    // What onboarding's connectLocal sends (src/state/models.ts).
    const res = await fetch(`${murmur.url}/hermes/api/providers/custom-endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '', name: 'Fake model', base_url: forHermes, model: MODELS[0], models: MODELS, make_default: true }),
    })
    if (!res.ok) throw new Error(`Couldn’t connect the fake model: ${res.status} ${await res.text()}`)

    project.provide('murmur', murmur.url)
    project.provide('model', { local: `http://127.0.0.1:${model.port}`, forHermes })
    project.provide('hermes', { image: hermes.image, version: hermes.version, url: hermes.url, container: hermes.name })
  } catch (error) {
    await teardown()
    throw error
  }
  return teardown
}
