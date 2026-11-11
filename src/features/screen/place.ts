// Where a reply's browser goes in the thread, the way a machine's screen does
// (features/machine/shots.ts): an agent has one browser, so a reply shows it
// once, under the run of steps that last used it, and the chat shows it once,
// in its latest reply.

import { domain } from '@/features/chat/tool-labels'
import { frameId } from './frame'

/** A step an agent took in its browser, as the thread has it. */
export type BrowserUse = {
  /** Whose browser: the agent's id. */
  agent: string
  /** The step, as the thread names it. */
  id: string
  /** Hermes's id for the call: the same while the reply streams and when it's read back. */
  call?: string
  done: boolean
  /** The site it opened, if it opened one, and that page's whole address when a link can go there. */
  site?: string
  page?: string
}

/** An agent's browser in a reply. */
export type Browsing = {
  agent: string
  /** Its first step there this reply: what a live card waits on before it shows the page (drawn.ts). */
  step: { key: string; done: boolean }
  /** What its last picture is kept under (state/browser-frames.ts): that first step's call. */
  frame?: string
  /** Where it left off: the last site it opened, and that page's address. */
  site?: string
  page?: string
}

/** What a chat's replies fold by: one browser per agent. */
export const browserKey = (agent = '') => `browser ${agent}`

/**
 * A reply's browsers, each under the run of steps that last used it. Runs
 * are the reply's stretches of work, in order, as `placeScreens` takes them.
 */
export function placeBrowsers(runs: BrowserUse[][]): Browsing[][] {
  const first = new Map<string, BrowserUse>()
  const opened = new Map<string, BrowserUse>()
  const lastRun = new Map<string, number>()
  runs.forEach((run, i) => {
    for (const use of run) {
      if (!first.has(use.agent)) first.set(use.agent, use)
      if (use.site || use.page) opened.set(use.agent, use)
      lastRun.set(use.agent, i)
    }
  })
  return runs.map((_, i) =>
    [...lastRun]
      .filter(([, at]) => at === i)
      .map(([agent]) => {
        const { id, call, done } = first.get(agent)!
        const to = opened.get(agent)
        return {
          agent,
          step: { key: id, done },
          ...(call && { frame: frameId(call) }),
          ...(to && { site: to.page ? domain(to.page) : to.site }),
          ...(to?.page && { page: to.page }),
        }
      }),
  )
}

/**
 * For each reply, oldest first, the screens it shows that a later reply
 * shows too: those fold to a line, so a chat has each screen once, in the
 * latest reply to show it.
 */
export function foldedIn(replies: string[][]): string[][] {
  const later = new Set<string>()
  const folded: string[][] = replies.map(() => [])
  for (let i = replies.length - 1; i >= 0; i--) {
    const keys = [...new Set(replies[i])]
    folded[i] = keys.filter((k) => later.has(k))
    for (const k of keys) later.add(k)
  }
  return folded
}
