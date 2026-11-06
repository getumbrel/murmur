// An agent's screen: the desktop on its Hermes host where its browser opens
// (Hermes's Bot Screen, over the same socket as chats: display.*). Murmur shows
// that browser live in the chat, lets the person take it over for something
// only they can do (a check that they're human, a sign-in, a code) and hand it
// back. Hermes guards it: while the person has control the agent's browser
// tools wait, and only the viewer in control can type into the screen.
//
// Every agent's browser opens there, wherever its Hermes host has the screen:
// Murmur keeps each agent's config so (browser.headed, and
// bot_desktop.auto_start so the screen comes up with the browser), and gives
// each the murmur-screen plugin, its tool to ask for a hand (ASK_TOOL).
// Nothing here assumes an Umbrel: it goes by what Hermes says its host can do.
//  - A Hermes with the screen (Umbrel's image, which comes with murmur-screen;
//    Nous's desktop image; any Linux Hermes with the packages): its agents'
//    browsers show, and Murmur adds murmur-screen where it's missing, the way
//    it adds murmur-mail (Hermes's own plugin installer).
//  - A Linux Hermes without the screen's packages: the first time an agent
//    browses, the chat offers the one-time install (about 200 MB).
//  - A Hermes on a Mac or Windows has no screen to show: nothing is offered.

import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { api } from '@/hermes/rest'
import { gateway, rpc, type GatewayEvent } from '@/hermes/gateway'
import { HERMES_PARAM, scoped, tabHermes } from '@/hermes/instance'
import { rememberedSet, upkeep } from '@/lib/upkeep'
import type { GatewayEventMap } from '@/hermes/vendor/gateway-events'
import type {
  DisplayInstallResult,
  DisplayLease,
  DisplayLeaseResult,
  DisplayObserveResult,
  DisplayStatus,
  DisplayThumbnailResult,
  PluginsManageResult,
} from '@/hermes/vendor/gateway-contract.generated'

export type Screen = DisplayStatus

/** The plugin with the agent's tool for asking for a hand (getumbrel/hermes-agent-umbrel). */
export const SCREEN_PLUGIN = 'murmur-screen'
export { ASK_TOOL, OPENS_PAGES } from '@/features/chat/tool-labels'

/** The desktop's own bars, top and bottom, in screen pixels: the agent's browser is what's between them. */
export const CHROME = { top: 28, bottom: 44 }
/** Under the browser's tabs and address bar: just the page. */
export const PAGE = { top: CHROME.top + 87, bottom: CHROME.bottom }

/** The screen's size as Hermes made it ("1440x900"). */
export function sizeOf(screen: Screen | undefined) {
  const [w, h] = (screen?.geometry ?? '').split('x').map(Number)
  return w > 0 && h > 0 ? { w, h } : { w: 1440, h: 900 }
}

/** The payload of one kind of event, or undefined for any other. */
const payloadOf = <K extends keyof GatewayEventMap>(ev: GatewayEvent, type: K) =>
  ev.type === type ? (ev.payload as GatewayEventMap[K] | undefined) : undefined

type Store = {
  screens: Record<string, Screen>
  /** The lease this window holds, per agent, as Hermes names its holder (the viewer's hash). */
  held: Record<string, string | undefined>
  /**
   * Agents whose screen runs but sends no picture of itself: nothing to show
   * in the chat until it's started again.
   */
  unseen: Record<string, true | undefined>
}

export const useScreens = create<Store>(() => ({ screens: {}, held: {}, unseen: {} }))

function setUnseen(profile: string, unseen: boolean) {
  if (!!useScreens.getState().unseen[profile] !== unseen)
    useScreens.setState((s) => ({ unseen: { ...s.unseen, [profile]: unseen || undefined } }))
}

/** Hermes names a screen in its events by the agent's Hermes home; Murmur names it by the agent. */
const agentOf = new Map<string, string>()

function put(screen: Screen) {
  agentOf.set(screen.profile_key, screen.profile)
  useScreens.setState((s) => ({ screens: { ...s.screens, [screen.profile]: screen } }))
  // A screen that stops is given another chance the next time it starts.
  if (!screen.running) setUnseen(screen.profile, false)
}

function putLease(profile: string, lease: DisplayLease) {
  const screen = useScreens.getState().screens[profile]
  if (screen) put({ ...screen, lease })
}

let wired = false

function wire() {
  if (wired) return
  wired = true
  gateway.onEvent((ev) => {
    const status = payloadOf(ev, 'display.status') ?? payloadOf(ev, 'display.install.done')?.status
    if (status?.profile) put(status)
    const lease = payloadOf(ev, 'display.lease')
    const profile = lease && agentOf.get(lease.profile_key)
    if (lease && profile) putLease(profile, lease.lease)
  })
  // Hermes knows a viewer only on the connection that made it: a new connection makes a new one.
  gateway.onState((state) => {
    if (state !== 'open') viewer = undefined
  })
}

const asking = new Map<string, Promise<Screen | null>>()

/** The agent's screen as Hermes has it now; null when this Hermes has none to offer. */
export function loadScreen(profile: string): Promise<Screen | null> {
  wire()
  const running = asking.get(profile)
  if (running) return running
  const job = rpc<Screen>('display.status', { profile })
    .then((screen) => (put(screen), screen))
    .catch(() => null)
    .finally(() => asking.delete(profile))
  asking.set(profile, job)
  return job
}

/** The agent's screen, kept current by Hermes's events. */
export function useScreen(profile: string | undefined) {
  useEffect(() => {
    if (profile) void loadScreen(profile)
  }, [profile])
  return useScreens((s) => (profile ? s.screens[profile] : undefined))
}

/** Whether there's a picture of the agent's browser to show: its screen runs, and sends one. */
export function useShowable(profile: string | undefined) {
  const running = !!useScreen(profile)?.running
  const unseen = useScreens((s) => (profile ? !!s.unseen[profile] : false))
  return running && !unseen
}

/** Who has the agent's browser: the agent, you (in this window), or you somewhere else (another device). */
export type Control = 'agent' | 'you' | 'elsewhere'

export function controlOf(screen: Screen | undefined, held: string | undefined): Control {
  if (screen?.lease.holder !== 'human') return 'agent'
  return held && screen.lease.viewer_hash === held ? 'you' : 'elsewhere'
}

export function useControl(profile: string | undefined): Control {
  const screen = useScreen(profile)
  const held = useScreens((s) => (profile ? s.held[profile] : undefined))
  return controlOf(screen, held)
}

// ── Watching and taking over ─────────────────────────────────────────────────

/** This window, to Hermes: made on the first watch and kept for the connection, so control survives a redraw. */
let viewer: string | undefined

/** The address of the screen's live picture, with a ticket that's good once, for 30 seconds. */
export async function watch(profile: string) {
  wire()
  const { ticket, path, viewer_id, ...screen } = await rpc<DisplayObserveResult>('display.observe', {
    profile,
    ...(viewer && { viewer_id: viewer }),
  })
  viewer = viewer_id
  put(screen)
  const params = new URLSearchParams({ display_ticket: ticket })
  const hermes = tabHermes()
  if (hermes) params.set(HERMES_PARAM, hermes)
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/hermes${path}?${params}`
}

/** Takes the agent's browser, from wherever the person had it: its browser tools wait until it's handed back. */
export async function takeOver(profile: string, reason = '') {
  if (!viewer) await watch(profile)
  const { lease } = await rpc<DisplayLeaseResult>('display.lease.acquire', { profile, viewer_id: viewer, reason })
  useScreens.setState((s) => ({ held: { ...s.held, [profile]: lease.viewer_hash ?? undefined } }))
  putLease(profile, lease)
}

/** Gives the browser back to the agent, which carries on (one that asked for a hand does by itself). */
export async function handBack(profile: string) {
  let lease = await rpc<DisplayLeaseResult>('display.lease.release', { profile, viewer_id: viewer }).then(
    (r) => r.lease,
    () => undefined,
  )
  // Taken on a connection that's since been replaced, or on another device: Hermes knows that viewer
  // by another name, but control is still the person's to give back.
  if (!lease || lease.holder === 'human')
    lease = (await rpc<DisplayLeaseResult>('display.lease.release', { profile, force: true })).lease
  useScreens.setState((s) => ({ held: { ...s.held, [profile]: undefined } }))
  putLease(profile, lease)
}

// ── Stills ───────────────────────────────────────────────────────────────────

/** Asked this many times in a row while its screen runs, and never a picture: it has none to send. */
const MISSES = 4

/**
 * A still of the agent's screen every `every` ms while `on` and the page is in
 * view: cheap enough for a chat, and nothing is fetched while nobody looks.
 * Hermes sends none while the person has control (it could show what they
 * type), so the last one stays. A screen that runs and never sends one (a
 * Hermes that can't take them) is marked unseen: see useShowable.
 */
export function useStill(profile: string | undefined, on = true, every = 1500) {
  const [still, setStill] = useState<string | null>(null)
  useEffect(() => {
    if (!profile || !on) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let pictured = false
    let misses = 0
    const miss = () => {
      if (!pictured && ++misses >= MISSES && useScreens.getState().screens[profile]?.running) setUnseen(profile, true)
    }
    const tick = async () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') {
        try {
          const { data_url, suppressed } = await rpc<DisplayThumbnailResult>('display.thumbnail', { profile }, 10_000)
          if (!alive) return
          if (data_url) {
            pictured = true
            setStill(data_url)
            setUnseen(profile, false)
          } else if (!suppressed) miss()
        } catch {
          // The next tick tries again.
          if (alive) miss()
        }
      }
      if (alive) timer = setTimeout(tick, every)
    }
    const seen = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', seen)
    void tick()
    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', seen)
    }
  }, [profile, on, every])
  return still
}

// ── Every agent's browser on its screen ──────────────────────────────────────

/** The main agent: its Hermes host's screen is what this Hermes can show at all. */
const MAIN = 'default'

const yes = (v: unknown) => v === true || (typeof v === 'string' && /^(true|1|yes|on)$/i.test(v.trim()))

/**
 * Whether the agent's browser opens on its screen, as its own config says;
 * undefined when it was never set (Hermes's default then: one nobody sees).
 * Hermes doesn't save a value that's the same as its default, so an agent
 * switched off before it was ever on reads as never set too.
 */
async function readShown(profile: string): Promise<boolean | undefined> {
  const config = await api.get<{ browser?: { headed?: unknown } }>(
    `/api/config?profile=${encodeURIComponent(profile)}&include_defaults=false`,
  )
  const headed = config?.browser?.headed
  return headed === undefined || headed === null ? undefined : yes(headed)
}

/** The murmur-screen plugin, as this Hermes has it for an agent; undefined when it has none. */
const screenPlugin = (profile: string) =>
  rpc<PluginsManageResult>('plugins.manage', { action: 'list', profile }).then((r) =>
    (r.plugins ?? []).find((p) => p.name === SCREEN_PLUGIN || p.key === SCREEN_PLUGIN),
  )

type Plugin = Awaited<ReturnType<typeof screenPlugin>>

/** An agent as it is: whether its browser shows (undefined: never set), and murmur-screen for it, if any. */
async function agentState(profile: string) {
  const [shown, plugin] = await Promise.all([readShown(profile), screenPlugin(profile).catch(() => undefined)])
  return { shown, plugin }
}

/**
 * Opens the agent's browser on its screen from now on, with its tool to ask
 * for a hand. The screen comes up with the browser and stops once it's been
 * idle a while (Hermes's own bot_desktop settings).
 */
async function showBrowser(profile: string, plugin: Plugin) {
  // PUT deep-merges into the agent's config file, so only these keys change. Hermes holds the screen
  // back below 1.5 GB of free memory, but the browser runs either way: the screen itself takes ~100 MB.
  await api.put(`/api/config?profile=${encodeURIComponent(profile)}`, {
    config: { browser: { headed: true }, bot_desktop: { auto_start: true, min_free_memory_mb: 512 } },
  })
  if (plugin && plugin.status !== 'enabled')
    await rpc('plugins.manage', { action: 'toggle', key: plugin.key, enable: true, profile })
  // Not waited for: the browser shows without it, and a clone can take a while.
  else if (!plugin) void addScreenPlugin(profile)
}

/**
 * Where murmur-screen comes from for a Hermes without it (Nous's own image, a
 * Hermes installed with pip): its folder in getumbrel/hermes-agent-umbrel, at
 * the release of the Umbrel image Murmur pins (umbrel/murmur/docker-compose.yml),
 * like murmur-mail (MAIL_PLUGIN_SOURCE). It moves with that image.
 */
export const SCREEN_PLUGIN_SOURCE = {
  repo: 'getumbrel/hermes-agent-umbrel',
  path: 'umbrel-context/plugins/murmur-screen',
  // v0.23.0-2 (Hermes's installer takes only a full commit)
  ref: '0b86d231df4c123f92c1f794bad7510dbe46403a',
} as const

const adding = new Map<string, Promise<void>>()

/**
 * Gives an agent the tool to ask for a hand, with Hermes's own installer:
 * cloned at SCREEN_PLUGIN_SOURCE's release and switched on, live, no restart.
 * Quiet when it can't (no way to github.com): everything else works without it,
 * and the next sync tries again.
 */
export function addScreenPlugin(profile: string) {
  let job = adding.get(profile)
  if (!job) {
    const { repo, path, ref } = SCREEN_PLUGIN_SOURCE
    job = rpc(
      'plugins.manage',
      { action: 'install', identifier: `${repo}/${path}`, ref, enable: true, profile },
      5 * 60_000,
    )
      .then(
        () => {},
        () => {},
      )
      .finally(() => adding.delete(profile))
    adding.set(profile, job)
  }
  return job
}

// Agents already in step, remembered across reloads (for a day).
const synced = rememberedSet(scoped('murmur:screen:2'))

/** The agents the app knows of, for a sync once the screen is installed. */
let known: readonly string[] = []

/**
 * Shows every agent's browser on its screen, with its tool to ask for a hand,
 * wherever its Hermes host has the screen. Never installs the screen itself:
 * that's offered in the chat (src/features/screen/screen-setup.tsx).
 */
export async function syncScreens(agentIds: readonly string[]) {
  if (!(await loadScreen(MAIN))?.installed) return
  for (const id of [MAIN, ...agentIds.filter((id) => id !== MAIN)]) {
    // Its browser and its tool to ask with, each checked: one left behind (Murmur closed between the
    // two) is caught up next time.
    const { shown, plugin } = await agentState(id)
    if (!shown || plugin?.status !== 'enabled') await showBrowser(id, plugin)
    synced.add(id)
  }
}

/**
 * Every agent's browser shows, agents made since in here or in another app
 * included. Quiet, like the rest of Murmur's upkeep: idle-time requests, one
 * at a time, nothing once every agent is in step.
 */
export function useScreenSync(agentIds: readonly string[] | undefined) {
  const key = agentIds?.join('\n') ?? ''
  useEffect(() => {
    const ids = key ? key.split('\n') : []
    known = ids
    if (ids.every((id) => synced.has(id))) return
    void upkeep(() => syncScreens(ids)).catch(() => {})
  }, [key])
}

/** The screen as the main agent's Hermes host has it: what this Hermes can show at all. */
export const useHostScreen = () => useScreen(MAIN)

// ── Installing the screen (a Linux Hermes without it) ────────────────────────

export type Install =
  | { phase: 'idle' }
  /** `line`: the installer's latest line of output. */
  | { phase: 'running'; line?: string }
  /** Hermes needs the host's password for sudo: `answer` sends it ('' gives up). */
  | { phase: 'password'; answer: (password: string) => void }
  /**
   * `command`: what to run on the host instead, when Hermes can't install it itself.
   * `unprivileged`: Hermes runs without root and there's no sudo, as in a container,
   * where the screen has to come with the image.
   */
  | { phase: 'failed'; command?: string | null; line?: string; unprivileged?: boolean }

export const useInstall = create<Record<string, Install>>(() => ({}))

/** Hermes's installer ending on a host where it has no root and no sudo to get it (tools/bot_desktop/install.py). */
const NO_SUDO = -2

/**
 * Installs the screen's packages on the Hermes host with Hermes's own installer
 * (display.install): once, and about 200 MB. When Hermes asks for the host's
 * sudo password the person types it, and it goes straight to Hermes.
 */
export async function installScreen(profile = MAIN) {
  wire()
  const set = (state: Install) => useInstall.setState({ [profile]: state })
  set({ phase: 'running' })
  const key = (await loadScreen(profile))?.profile_key
  let line: string | undefined
  let finish: (done: { code: number; status?: Screen }) => void = () => {}
  const done = new Promise<{ code: number; status?: Screen }>((resolve) => (finish = resolve))
  const offRequest = gateway.onRequest((req) => {
    if (req.method !== 'display.install.sudo' || req.params.profile_key !== key) return false
    set({
      phase: 'password',
      answer: (password) => {
        req.respond({ value: password })
        set({ phase: 'running', line })
      },
    })
  })
  const offEvents = gateway.onEvent((ev) => {
    const log = payloadOf(ev, 'display.install.log')
    if (log && log.profile_key === key && log.line.trim()) set({ phase: 'running', line: (line = log.line.trim()) })
    const end = payloadOf(ev, 'display.install.done')
    if (end && end.profile_key === key) finish(end)
  })
  const failed = (command = useScreens.getState().screens[profile]?.install_command) =>
    set({ phase: 'failed', command, line })
  try {
    const started = await rpc<DisplayInstallResult>('display.install', { profile })
    if (!started.started) return failed(started.command)
    const { code, status } = await done
    if (code === 0 && status?.installed) {
      set({ phase: 'idle' })
      // Every agent's browser on the screen it has now.
      synced.clear()
      await syncScreens(known).catch(() => {})
    } else if (code === NO_SUDO)
      set({ phase: 'failed', command: status?.install_command?.replace(/^sudo /, ''), line, unprivileged: true })
    else failed(status?.install_command)
  } catch {
    failed()
  } finally {
    offRequest()
    offEvents()
  }
}
