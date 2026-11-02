// A machine's screen, from umbrelOS's machine tools (its Machines: virtual
// computers an agent can drive). control_machine does one thing with the
// keyboard or mouse and hands back a screenshot a second later, and
// get_machine_screenshot just looks, so an agent at work takes dozens. They're
// one screen that changes, so Murmur shows them as one: each machine's latest
// picture, in place, with the ones before it a swipe away.
//
// The shapes are umbrelOS's (packages/umbreld/source/modules/mcp/tools/machines.ts):
// the tool's text is {machineId, action?, screenshot: {width, height}}, and
// Hermes caches the picture and names it on a MEDIA: line (umbrel/finds.ts).
// Only the tool names are matched, never the server's, since a person may have
// connected umbrelOS under any name.

import { unwrap } from '@/features/umbrel/finds'

const MCP = /^mcp__(.+?)__(get_machine_screenshot|control_machine)$/
const IMAGE = /\.(?:png|jpe?g|webp)$/i

/** Actions that press where they point: the screen shows where. */
const PRESSES = new Set([
  'left_click',
  'right_click',
  'middle_click',
  'double_click',
  'triple_click',
  'long_press',
  'left_click_drag',
])

/** One picture of a machine's screen. */
export type Shot = {
  /** The machine, on its server: one screen per machine. */
  key: string
  machine: string
  /** The picture, a file on the Hermes host. */
  path: string
  /** Its size in pixels, which the agent's coordinates are in. */
  w?: number
  h?: number
  /** Where the action it followed pressed, in those pixels. */
  at?: [number, number]
}

/** Whether a tool is one of the machine tools that hand back a screenshot. */
export const isMachineTool = (name: string) => MCP.test(name)

type Json = Record<string, unknown>
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function argsOf(args: unknown): Json {
  if (typeof args !== 'string') return obj(args) ?? {}
  try {
    return obj(JSON.parse(args)) ?? {}
  } catch {
    return {}
  }
}

/** The screenshot a machine tool handed back, or null for any other tool (or one that failed). */
export function shotOf(name: string, args: unknown, result: unknown): Shot | null {
  const m = MCP.exec(name)
  if (!m) return null
  const out = unwrap(result)
  const path = out?.media.find((p) => IMAGE.test(p))
  const value = obj(out?.value)
  const a = argsOf(args)
  const machine = typeof value?.machineId === 'string' ? value.machineId : typeof a.machineId === 'string' ? a.machineId : undefined
  if (!path || !machine) return null
  const size = obj(value?.screenshot)
  const point = Array.isArray(a.coordinate) ? a.coordinate.map(num) : []
  const at: [number, number] | undefined =
    m[2] === 'control_machine' && PRESSES.has(String(a.action)) && point[0] !== undefined && point[1] !== undefined
      ? [point[0], point[1]]
      : undefined
  return { key: `${m[1]}/${machine}`, machine, path, w: num(size?.width), h: num(size?.height), ...(at && { at }) }
}

/** A machine's screen over a stretch of work: every picture, the latest last. */
export type Screen = { key: string; machine: string; shots: Shot[] }

/** "ubuntu-desktop" → "Ubuntu Desktop": umbrelOS makes a machine's id from its name. */
export const machineName = (id: string) => id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * A reply's screens, each under the run of steps that last showed it, holding
 * every picture of that machine in the reply so far. Runs are the reply's
 * stretches of work, in order, as `placeFinds` takes them.
 */
export function placeScreens(runs: Shot[][]): Screen[][] {
  const all = new Map<string, Shot[]>()
  const lastRun = new Map<string, number>()
  runs.forEach((run, i) => {
    for (const shot of run) {
      all.set(shot.key, [...(all.get(shot.key) ?? []), shot])
      lastRun.set(shot.key, i)
    }
  })
  return runs.map((_, i) =>
    [...lastRun].filter(([, at]) => at === i).map(([key]) => ({ key, machine: all.get(key)![0].machine, shots: all.get(key)! })),
  )
}
