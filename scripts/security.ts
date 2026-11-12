// npm run security
//
// Is anything Murmur ships missing a published fix? It checks:
//
// - Node in the image, on every platform release.yml publishes: no newer
//   security release on its line, and the line not past its end of life (a
//   warning from 90 days before). Docker can publish a tag's architectures
//   hours apart, so one digest can hold different Nodes: each is checked.
// - The npm packages that ship: the web app's dependencies, and Electron and
//   electron-updater, which the desktop apps run and bundle (Murmur's server
//   runs on Electron's own Node there). A high or critical advisory with a fix
//   fails; the same in the build tools only warns, since they don't ship.
// - Electron's major still getting fixes (the newest three do).
//
// It changes nothing; it only says what to update. CI runs it on every push to
// master and before a release publishes (.github/workflows/security.yml).

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

const ci = Boolean(process.env.GITHUB_ACTIONS)
let failed = false
function fail(message: string) {
  failed = true
  console.log(ci ? `::error::${message}` : `✗ ${message}`)
}
function warn(message: string) {
  console.log(ci ? `::warning::${message}` : `! ${message}`)
}
function ok(message: string) {
  console.log(`✓ ${message}`)
}

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

const parse = (version: string) => version.replace(/^v/, '').split('.').map(Number)
function newer(a: string, b: string) {
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}
const days = (date: string) => Math.ceil((Date.parse(date) - Date.now()) / 86_400_000)

// ── Node in the image ───────────────────────────────────────────────────────

type Index = { manifests: { digest: string; platform: { os: string; architecture: string } }[] }

// The Node in each platform of node@sha256:…, from the image's own NODE_VERSION.
async function nodeVersions(digest: string, platforms: string[]) {
  const { token } = await json<{ token: string }>(
    'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull',
  )
  const registry = 'https://registry-1.docker.io/v2/library/node'
  const auth = { Authorization: `Bearer ${token}` }
  const index = await json<Index>(`${registry}/manifests/${digest}`, {
    ...auth,
    Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
  })
  const versions = new Map<string, string>()
  for (const platform of platforms) {
    const [os, architecture] = platform.split('/')
    const entry = index.manifests.find((m) => m.platform.os === os && m.platform.architecture === architecture)
    if (!entry) throw new Error(`node@${digest} has no ${platform} image`)
    const manifest = await json<{ config: { digest: string } }>(`${registry}/manifests/${entry.digest}`, {
      ...auth,
      Accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
    })
    const config = await json<{ config: { Env: string[] } }>(`${registry}/blobs/${manifest.config.digest}`, auth)
    const version = config.config.Env.find((e) => e.startsWith('NODE_VERSION='))?.slice('NODE_VERSION='.length)
    if (!version) throw new Error(`node@${digest} (${platform}) doesn't say its Node version`)
    versions.set(platform, version)
  }
  return versions
}

async function checkNode() {
  const digests = [...read('Dockerfile').matchAll(/^FROM\s.*\bnode:\S*@(sha256:[0-9a-f]{64})/gm)].map((m) => m[1])
  if (!digests.length) throw new Error('The Dockerfile has no node image pinned by digest')
  const platforms = read('.github/workflows/release.yml')
    .match(/^\s*platforms:\s*(\S+)/m)?.[1]
    .split(',')
  if (!platforms) throw new Error("release.yml doesn't say which platforms it publishes")

  const [releases, schedule] = await Promise.all([
    json<{ version: string; date: string; security: boolean }[]>('https://nodejs.org/dist/index.json'),
    json<Record<string, { end: string }>>('https://raw.githubusercontent.com/nodejs/Release/main/schedule.json'),
  ])

  const found = new Map<string, string[]>()
  for (const digest of new Set(digests)) {
    for (const [platform, version] of await nodeVersions(digest, platforms)) {
      found.set(version, [...(found.get(version) ?? []), platform])
    }
  }
  for (const [version, where] of found) {
    const line = `v${parse(version)[0]}`
    const label = `Node ${version} in the image (${where.join(', ')})`
    const fixes = releases.filter((r) => r.security && r.version.startsWith(`${line}.`) && newer(r.version, version))
    const end = schedule[line]?.end
    if (fixes.length) {
      const latest = fixes[0]
      fail(
        `${label} is missing security fixes: Node ${latest.version.slice(1)} (${latest.date}) has them. Pin the node lines in the Dockerfile to it.`,
      )
    } else if (!end) {
      warn(`${label}: Node's release schedule doesn't list ${line}.`)
    } else if (days(end) <= 0) {
      fail(
        `${label}: Node ${line.slice(1)} reached its end of life on ${end} and gets no more fixes. Move to the current LTS.`,
      )
    } else if (days(end) <= 90) {
      warn(
        `${label}: Node ${line.slice(1)} reaches its end of life on ${end}, in ${days(end)} days. Move to the current LTS before then.`,
      )
    } else {
      ok(`${label} has every security release for Node ${line.slice(1)}, which gets fixes until ${end}.`)
    }
  }
}

// ── npm packages ────────────────────────────────────────────────────────────

// Not dependencies of the web app, but in the desktop apps: Electron runs
// them, and desktop/scripts/build.ts bundles electron-updater into them.
const DESKTOP = ['electron', 'electron-updater']

type Lock = { packages: Record<string, { version?: string; dependencies?: Record<string, string> }> }

// The lockfile paths of everything that ships, found the way Node resolves
// each dependency: the nearest node_modules up from the one asking for it.
function shippedPaths() {
  const lock = JSON.parse(read('package-lock.json')) as Lock
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
  const resolve = (from: string, name: string) => {
    for (let dir = from; ; dir = dir.slice(0, Math.max(0, dir.lastIndexOf('/node_modules/')))) {
      const path = `${dir ? `${dir}/` : ''}node_modules/${name}`
      if (lock.packages[path]) return path
      if (!dir) return undefined
    }
  }
  const shipped = new Set<string>()
  const visit = (path: string | undefined) => {
    if (!path || shipped.has(path)) return
    shipped.add(path)
    for (const name of Object.keys(lock.packages[path].dependencies ?? {})) visit(resolve(path, name))
  }
  for (const name of [...Object.keys(pkg.dependencies), ...DESKTOP]) visit(resolve('', name))
  return { shipped, lock }
}

type Advisory = { title: string; url: string; severity: string }
type Audit = {
  vulnerabilities: Record<
    string,
    {
      severity: string
      nodes: string[]
      via: (Advisory | string)[]
      fixAvailable: boolean | { name: string; version: string }
    }
  >
}

function checkPackages() {
  // npm audit exits 1 when it finds anything; its report is still on stdout.
  const run = spawnSync('npm', ['audit', '--json'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const audit = JSON.parse(run.stdout) as Audit & { error?: { summary: string } }
  if (audit.error) throw new Error(`npm audit: ${audit.error.summary}`)
  const { shipped, lock } = shippedPaths()

  const tools: string[] = []
  let serious = 0
  let shipping = 0
  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities ?? {})) {
    const advisories = vulnerability.via.filter(
      (via): via is Advisory => typeof via === 'object' && (via.severity === 'high' || via.severity === 'critical'),
    )
    if (!advisories.length) continue
    serious++
    const ships = vulnerability.nodes.filter((path) => shipped.has(path))
    if (!ships.length) {
      tools.push(name)
      continue
    }
    const versions = [...new Set(ships.map((path) => lock.packages[path].version))].join(', ')
    const what = advisories.map((a) => `${a.title} (${a.severity}, ${a.url})`).join('; ')
    const fix = vulnerability.fixAvailable
    shipping++
    if (fix === false) {
      warn(`${name} ${versions} ships with an advisory that has no fix yet: ${what}.`)
    } else {
      const to = typeof fix === 'object' && fix.name === name ? ` to ${fix.version}` : ''
      fail(`${name} ${versions} ships with a known issue that's fixed: ${what}. Update ${name}${to}.`)
    }
  }
  if (tools.length)
    warn(
      `Build tools (they don't ship) have high or critical advisories: ${tools.join(', ')}. npm audit fix may clear them.`,
    )
  if (!serious) ok('No npm package has a high or critical advisory.')
  else if (!shipping) ok('No npm package that ships has a high or critical advisory.')
}

// ── Electron's support window ───────────────────────────────────────────────

async function checkElectron() {
  const lock = JSON.parse(read('package-lock.json')) as Lock
  const version = lock.packages['node_modules/electron']?.version
  if (!version) throw new Error('package-lock.json has no electron')
  const registry = await json<{ 'dist-tags': { latest: string }; time: Record<string, string> }>(
    'https://registry.npmjs.org/electron',
  )
  const latest = registry['dist-tags'].latest
  const [major, newest] = [parse(version)[0], parse(latest)[0]]
  if (major < newest - 2) {
    fail(
      `Electron ${major} no longer gets fixes: only the newest three majors do, and ${newest} is out. Move to Electron ${newest}.`,
    )
  } else if (major === newest - 2) {
    warn(`Electron ${major} gets fixes only until Electron ${newest + 1} comes out. Plan the move to ${newest}.`)
  } else {
    ok(`Electron ${version} is on a major that gets fixes (the newest is ${latest}).`)
  }
  // Electron's patch releases carry Chromium's and Node's fixes, mostly without
  // advisories of their own, so a newer one on this major is worth a look.
  const patches = Object.keys(registry.time)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v) && parse(v)[0] === major && newer(v, version))
    .sort((a, b) => (newer(a, b) ? -1 : 1))
  if (patches.length) {
    const age = -days(registry.time[patches.at(-1)!])
    warn(
      `Electron ${patches[0]} is out (${patches.length} newer on ${major}, the first ${age} days ago); this is on ${version}. Its release notes say what it fixes.`,
    )
  }
}

for (const check of [checkNode, checkPackages, checkElectron]) {
  try {
    await check()
  } catch (error) {
    fail(`Couldn't check: ${(error as Error).message}`)
  }
}
process.exit(failed ? 1 : 0)
