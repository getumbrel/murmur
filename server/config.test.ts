import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addBuiltin,
  addTarget,
  decided,
  listTargets,
  nameFor,
  noteSetupSeen,
  removeTarget,
  updateTarget,
  useEnv,
  type Env,
} from './config.ts'

let dir: string
const BUILTIN = { MURMUR_BUILTIN_HERMES_URL: 'http://murmur_hermes_1:9119', MURMUR_BUILTIN_HERMES_PASSWORD: 'secret' }
const use = (env: Env = {}) => useEnv({ DATA_DIR: dir, ...env })
const stored = () => JSON.parse(readFileSync(join(dir, 'murmur.json'), 'utf8'))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'murmur-config-'))
  use()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  useEnv(process.env)
})

describe('names', () => {
  it('call the umbrelOS app Hermes Agent', () => {
    expect(nameFor('http://hermes-agent_web_1:18789')).toBe('Hermes Agent')
    expect(nameFor('http://127.0.0.1:9119')).toBe('This computer')
    expect(nameFor('http://studio.local:9119')).toBe('studio.local')
  })

  it('rename a saved “This Umbrel” that nobody typed', () => {
    writeFileSync(
      join(dir, 'murmur.json'),
      JSON.stringify({
        connections: [
          { id: 'main', name: 'This Umbrel', url: 'http://hermes-agent_web_1:18789' },
          { id: 'abc', name: 'This Umbrel', url: 'http://studio.local:9119' },
        ],
      }),
    )
    expect(listTargets().map((t) => t.name)).toEqual(['Hermes Agent', 'This Umbrel'])
  })
})

describe('decided', () => {
  it('not on a first run, with or without a built-in', () => {
    expect(decided()).toBe(false)
    use(BUILTIN)
    expect(decided()).toBe(false)
    expect(listTargets()[0].source).toBe('default')
  })

  it('when pinned by HERMES_URL', () => {
    use({ HERMES_URL: 'http://hermes-agent_web_1:18789', ...BUILTIN })
    expect(decided()).toBe(true)
    expect(listTargets()[0]).toMatchObject({ id: 'env', name: 'Hermes Agent', source: 'env' })
  })

  it('once a Hermes is saved', () => {
    addTarget({ url: 'http://studio.local:9119' })
    expect(decided()).toBe(true)
    expect(listTargets()[0].id).toBe('main')
  })
})

describe('the built-in', () => {
  it('joins the list once, with its sign-in from the environment', () => {
    use(BUILTIN)
    addBuiltin()
    addBuiltin()
    expect(decided()).toBe(true)
    expect(listTargets()).toEqual([
      {
        id: 'builtin',
        name: 'Built-in',
        url: 'http://murmur_hermes_1:9119',
        source: 'builtin',
        credentials: { username: 'murmur', password: 'secret' },
      },
    ])
    // Nothing secret is written down for it.
    expect(stored().connections).toEqual([{ id: 'builtin', name: 'Built-in', url: '', builtin: true }])
  })

  it('keeps its place: one added after it gets an id of its own', () => {
    use(BUILTIN)
    addBuiltin()
    const other = addTarget({ url: 'http://hermes-agent_web_1:18789' })
    expect(other.id).not.toBe('main')
    expect(listTargets().map((t) => t.id)).toEqual(['builtin', other.id])
  })

  it('can be renamed, never removed', () => {
    use(BUILTIN)
    addBuiltin()
    updateTarget('builtin', { name: 'Home', url: 'http://elsewhere:1' })
    removeTarget('builtin')
    expect(listTargets()).toMatchObject([{ id: 'builtin', name: 'Home', url: 'http://murmur_hermes_1:9119' }])
    expect(stored().connections[0].builtin).toBe(true)
  })

  it('drops out when Murmur runs without one, and the choice is open again', () => {
    use(BUILTIN)
    addBuiltin()
    use()
    expect(decided()).toBe(false)
  })
})

describe('an update from before the choice', () => {
  it('is told apart from a new install, once', () => {
    expect(noteSetupSeen()).toBe(false)
    expect(noteSetupSeen()).toBe(false)
    expect(stored()).toEqual({ setupSeen: true })
  })

  it('is recognised by data written before', () => {
    writeFileSync(join(dir, 'murmur.json'), JSON.stringify({ managedName: 'Home' }))
    expect(noteSetupSeen()).toBe(true)
    expect(noteSetupSeen()).toBe(false)
    expect(stored()).toEqual({ managedName: 'Home', setupSeen: true })
  })
})
