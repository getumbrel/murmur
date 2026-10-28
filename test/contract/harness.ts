// The real thing the suite runs against: a Hermes container set up the way
// Murmur ships its built-in one, and Murmur's own server signed in to it.

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../..', import.meta.url))

export const HERMES_USERNAME = 'murmur'
export const HERMES_PASSWORD = 'contract-test-password'

/** The Hermes Murmur ships (the umbrelOS package's), unless HERMES_IMAGE names another. */
export function hermesImage({ pinned = false } = {}) {
  if (process.env.HERMES_IMAGE && !pinned) return process.env.HERMES_IMAGE
  const compose = readFileSync(`${root}/umbrel/murmur/docker-compose.yml`, 'utf8')
  const image = compose.match(/^ {2}hermes:\n(?: {4}.*\n)*? {4}image: *(\S+)/m)?.[1]
  if (!image) throw new Error('No hermes image in umbrel/murmur/docker-compose.yml')
  return image
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until<T>(what: string, timeoutMs: number, check: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value !== undefined) return value
    } catch (error) {
      last = error
    }
    await sleep(500)
  }
  throw new Error(`Timed out waiting for ${what}${last ? ` (${String(last)})` : ''}`)
}

/**
 * The murmur-mail plugin to put into the Hermes under test, for an image that
 * doesn't bundle it (Hermes's own releases, in the nightly run) or to try a
 * working copy without building an image. MURMUR_MAIL_PLUGIN is the plugin's
 * folder (umbrel-context/plugins/murmur-mail in getumbrel/hermes-agent-umbrel),
 * or `pinned` for the one in the Umbrel image Murmur pins. Unset: the image's own.
 */
export const MAIL_PLUGIN = process.env.MURMUR_MAIL_PLUGIN?.trim() || ''

async function mailPlugin(): Promise<{ dir: string; done: () => void } | null> {
  if (!MAIL_PLUGIN) return null
  if (MAIL_PLUGIN !== 'pinned') return { dir: resolve(MAIL_PLUGIN), done: () => {} }
  const pinned = hermesImage({ pinned: true })
  const dir = mkdtempSync(join(tmpdir(), 'murmur-mail-plugin-'))
  const holder = `murmur-contract-plugin-${process.pid}`
  try {
    await run('docker', ['rm', '-f', holder]).catch(() => {})
    await run('docker', ['create', '--name', holder, pinned], { maxBuffer: 1 << 20 })
    await run('docker', ['cp', `${holder}:/opt/hermes/plugins/murmur-mail/.`, dir])
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`No murmur-mail plugin in the pinned Hermes image (${pinned}) to test with: ${String(error)}`)
  } finally {
    await run('docker', ['rm', '-f', holder]).catch(() => {})
  }
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }
}

export type HermesContainer = { name: string; image: string; url: string; version: string; logs: () => Promise<string>; stop: () => Promise<void> }

/**
 * A fresh Hermes with no saved data: the dashboard behind a username and
 * password, and the messaging gateway running (routines need it), like the
 * built-in Hermes in umbrel/murmur/docker-compose.yml.
 */
export async function startHermes(image = hermesImage()): Promise<HermesContainer> {
  const name = `murmur-contract-${process.pid}`
  const port = await freePort()
  await run('docker', ['rm', '-f', name]).catch(() => {})
  const plugin = await mailPlugin()
  await run('docker', [
    plugin ? 'create' : 'run', ...(plugin ? [] : ['-d']), '--name', name,
    '-p', `127.0.0.1:${port}:9119`,
    // So Hermes can reach the fake model on this machine.
    '--add-host', 'host.docker.internal:host-gateway',
    '-e', 'HERMES_UID=1000', '-e', 'HERMES_GID=1000',
    '-e', 'HERMES_DASHBOARD=1',
    '-e', `HERMES_DASHBOARD_BASIC_AUTH_USERNAME=${HERMES_USERNAME}`,
    '-e', `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=${HERMES_PASSWORD}`,
    '-e', 'HERMES_DASHBOARD_BASIC_AUTH_SECRET=contract-test-session-secret',
    '-e', 'HERMES_GATEWAY_BOOTSTRAP_STATE=running',
    '-e', 'HERMES_UMBREL_CONTEXT=0',
    image, 'gateway', 'run',
  ], { maxBuffer: 1 << 20 })
  if (plugin) {
    // Where Umbrel's image puts it: among Hermes's bundled plugins.
    await run('docker', ['cp', `${plugin.dir}/.`, `${name}:/opt/hermes/plugins/murmur-mail`])
    plugin.done()
    await run('docker', ['start', name])
  }

  const url = `http://127.0.0.1:${port}`
  // Hermes logs to both streams.
  const logs = () =>
    run('docker', ['logs', '--tail', '500', name], { maxBuffer: 16 << 20 }).then(
      ({ stdout, stderr }) => stdout + stderr,
      (error: Error) => `Couldn’t read the logs: ${error.message}`,
    )
  const stop = async () => void (await run('docker', ['rm', '-f', name]).catch(() => {}))
  try {
    const version = await until('Hermes to start', 180_000, async () => {
      const status = (await (await fetch(`${url}/api/status`)).json()) as { version?: string; gateway_running?: boolean }
      return status.gateway_running ? status.version : undefined
    })
    return { name, image, url, version: version ?? 'unknown', logs, stop }
  } catch (error) {
    console.error(await logs())
    await stop()
    throw error
  }
}

export type MurmurServer = { url: string; output: () => string; stop: () => Promise<void> }

/** Murmur's server, pinned to that Hermes and signed in with its password, from a fresh data folder. */
export async function startMurmur(hermesUrl: string, dataDir: string): Promise<MurmurServer> {
  const port = await freePort()
  let output = ''
  const child: ChildProcess = spawn(process.execPath, ['server/index.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      DATA_DIR: dataDir,
      HERMES_URL: hermesUrl,
      HERMES_USERNAME,
      HERMES_PASSWORD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout!.on('data', (chunk) => (output += chunk))
  child.stderr!.on('data', (chunk) => (output += chunk))
  const url = `http://127.0.0.1:${port}`
  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve()
      child.once('exit', () => resolve())
      child.kill()
    })
  try {
    await until('Murmur to start', 20_000, async () => ((await fetch(`${url}/healthz`)).ok ? true : undefined))
  } catch (error) {
    console.error(output)
    await stop()
    throw error
  }
  return { url, output: () => output, stop }
}
