// The little the shell remembers between launches, in userData/desktop.json:
// where the window was, Murmur's theme, and the port the server last used (the
// app's storage belongs to its origin, port included, so keeping it keeps the
// storage).

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Bounds = { x: number; y: number; width: number; height: number }
type State = { port?: number; window?: Bounds & { maximized?: boolean }; theme?: 'system' | 'light' | 'dark' }

const file = () => join(app.getPath('userData'), 'desktop.json')

let state: State | null = null

export function readState(): State {
  if (state) return state
  try {
    state = JSON.parse(readFileSync(file(), 'utf8')) as State
  } catch {
    state = {}
  }
  return state
}

export function saveState(patch: State) {
  state = { ...readState(), ...patch }
  try {
    writeFileSync(file(), JSON.stringify(state, null, 2) + '\n')
  } catch (error) {
    console.warn(`Murmur: couldn’t save ${file()} (${(error as Error).message}).`)
  }
}
