// Agents' browsers, live (src/state/screen.ts): Hermes's Bot Screen, where an
// agent's browser opens for the person to watch and take over, and the
// murmur-screen plugin in Umbrel's Hermes image (getumbrel/hermes-agent-umbrel,
// umbrel-context/plugins/murmur-screen) that lets the agent ask for a hand.
// Murmur's own syncScreens, watch, takeOver, handBack and installScreen run
// here against a real Hermes, and the agent browses a page served inside its
// container, through the fake model.
//
// Which tests run depends on the Hermes under test, as the app does:
//  - one with the screen's packages and murmur-screen (Umbrel's image): every
//    agent shows its browser, live, and asks for a hand when it needs one,
//    and the person in control can paste into it;
//  - one with the packages and not the plugin (Nous's desktop image): the same,
//    once Murmur has added the plugin;
//  - one without the packages (Nous's own image, a Hermes of someone's own on
//    Linux): nothing changes by itself; the chat offers a one-time install.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { rpc, startGateway, stopGateway } from '@/hermes/gateway'
import type { PluginsManageResult } from '@/hermes/vendor/gateway-contract.generated'
import type { GatewayEvent } from '@/hermes/vendor/json-rpc-gateway'
import { createAgent } from '@/state/agents'
import {
  ASK_TOOL,
  SCREEN_PLUGIN,
  addScreenPlugin,
  controlOf,
  handBack,
  installScreen,
  loadScreen,
  syncScreens,
  takeOver,
  useInstall,
  useScreens,
  watch,
  type Screen,
} from '@/state/screen'
import { tookFor } from '@/features/chat/tool-labels'
import { agentName, api, connect, modelRequests, newChat, q, removeAgent, sleep, turn, type Socket } from './client'
import { toolsTag } from './fake-model'

const run = promisify(execFile)
const hermes = inject('hermes')
const exec = (...argv: string[]) =>
  run('docker', ['exec', '-u', 'hermes', hermes.container, ...argv], { maxBuffer: 1 << 20 })

/** A page for the agent to browse, served inside Hermes's container (its browser runs there). */
const PAGE = 'http://127.0.0.1:8765/'
const TITLE = 'Murmur contract shop'

let socket: Socket
let host: Screen | null
let plugin: boolean
let other: string | undefined

beforeAll(async () => {
  startGateway()
  socket = await connect()
  host = await loadScreen('default')
  plugin = (await pluginOn('default')) !== undefined
  await exec(
    'sh',
    '-c',
    `mkdir -p /tmp/site && printf '<title>${TITLE}</title><h1>${TITLE}</h1><p>Prove you are human.</p>' > /tmp/site/index.html` +
      ` && printf '<title>Sign in</title><input id="password">' > /tmp/site/sign-in.html`,
  )
  // Detached, it lives as long as the container.
  await run('docker', [
    'exec',
    '-d',
    '-u',
    'hermes',
    '-w',
    '/tmp/site',
    hermes.container,
    '/opt/hermes/.venv/bin/python3',
    '-m',
    'http.server',
    '8765',
    '--bind',
    '127.0.0.1',
  ])
  // Hermes keeps an agent's browser off this machine's own addresses unless told otherwise.
  await api.put(`/api/config?${q('default')}`, { config: { browser: { allow_private_urls: true } } })
}, 180_000)

afterAll(async () => {
  if (other) await removeAgent(other)
  socket?.close()
  stopGateway()
})

/** Whether murmur-screen is on for an agent (undefined: this Hermes has no such plugin). */
const pluginOn = (profile: string) =>
  rpc<PluginsManageResult>('plugins.manage', { action: 'list', profile }).then((r) => {
    const row = (r.plugins ?? []).find((p) => p.name === SCREEN_PLUGIN || p.key === SCREEN_PLUGIN)
    return row && row.status === 'enabled'
  })

/** What an agent's own config says about its browser and its screen. */
async function shownFor(profile: string) {
  const config = await api.get(`/api/config?${q(profile)}&include_defaults=false`)
  return { headed: config.browser?.headed, autoStart: config.bot_desktop?.auto_start }
}

/** The latest chat request Hermes sent the model: its system prompt, and the tools it offered (listed or loaded on demand). */
async function lastAsk() {
  const requests = await modelRequests()
  const last = requests.findLast((r) => r.body.tools?.length)
  const messages = (last?.body.messages ?? []) as { role: string; content: unknown }[]
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n')
  const tools = (last?.body.tools ?? []) as { function: { name: string; description?: string } }[]
  const listing = tools.find((t) => t.function.name === 'tool_search')?.function.description ?? ''
  const names = tools.map((t) => t.function.name)
  return {
    system,
    direct: names.includes(ASK_TOOL),
    offered: names.includes(ASK_TOOL) || new RegExp(`\\b${ASK_TOOL}\\b`).test(listing),
  }
}

/** A call to `name`, the way a model reaches it: directly when it's in the tool list, else through Hermes's tool_call. */
const reach = (name: string, args: Record<string, unknown>, direct: boolean) =>
  direct ? { name, args } : { name: 'tool_call', args: { calls: [{ name, arguments: args }] } }

/** The first event `find` matches from now on. */
function next<T>(what: string, find: (e: GatewayEvent) => T | undefined, timeoutMs = 90_000) {
  const from = socket.events.length
  return () =>
    socket.until(
      what,
      () =>
        socket.events
          .slice(from)
          .map(find)
          .find((v) => v !== undefined),
      timeoutMs,
    )
}

/** Resolves once Murmur's own screen store (fed by Hermes's events alone) says `check`. */
function seen(what: string, check: (screen: Screen | undefined) => boolean, timeoutMs = 90_000) {
  return new Promise<void>((resolve, reject) => {
    const done = () => (unsubscribe(), clearTimeout(timer), resolve())
    const unsubscribe = useScreens.subscribe((s) => check(s.screens.default) && done())
    const timer = setTimeout(() => (unsubscribe(), reject(new Error(`Timed out waiting for ${what}`))), timeoutMs)
    if (check(useScreens.getState().screens.default)) done()
  })
}

/**
 * The agent's browser at work, the way Hermes's default browser tool (browser_exec, the Browser Use CLI)
 * drives it: Python with browser helpers, a comment first that Hermes shows as the step.
 */
const step = (comment: string, code: string) => ({ name: 'browser_exec', args: { code: `# ${comment}\n${code}` } })
const OPEN = step('Opening the shop', `new_tab("${PAGE}")\nwait_for_load()\nprint(js("document.title"))`)
const LOOK = step('Looking at the page', 'print(js("document.title"))')

/** A sign-in page with its password field ready for what's typed or pasted; and what's in that field. */
const SIGN_IN = step(
  'Opening the sign-in page',
  `new_tab("${PAGE}sign-in.html")\nwait_for_load()\njs("document.getElementById('password').focus()")\nprint(js("document.activeElement.id"))`,
)
const PASSWORD = step('Reading the password field', `print(js("document.getElementById('password').value"))`)

const CONTROL = 0xffe3
const V = 0x76

/**
 * A bare viewer on the agent's screen, the way noVNC connects through
 * Murmur's /hermes proxy: just enough RFB to put text on the screen's
 * clipboard and press keys, as the live view does when you paste.
 */
async function viewer(url: string) {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  let got = Buffer.alloc(0)
  let more = () => {}
  ws.onmessage = (e) => {
    got = Buffer.concat([got, Buffer.from(e.data as ArrayBuffer)])
    more()
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('The live picture didn’t connect'))
  })
  const deadline = Date.now() + 15_000
  const read = async (n: number) => {
    while (got.length < n) {
      if (Date.now() > deadline) throw new Error('The screen stopped answering')
      await new Promise<void>((resolve) => ((more = resolve), setTimeout(resolve, 200)))
    }
    const head = got.subarray(0, n)
    got = got.subarray(n)
    return head
  }
  // Hermes's screen asks for no password (its bridge is the gate): version, security None, shared.
  ws.send(await read(12))
  await read((await read(1))[0])
  ws.send(Uint8Array.of(1))
  expect((await read(4)).readUInt32BE(0)).toBe(0)
  ws.send(Uint8Array.of(1))
  await read((await read(24)).readUInt32BE(20))
  const key = (keysym: number, down: boolean) => {
    const m = Buffer.alloc(8)
    m[0] = 4
    m[1] = down ? 1 : 0
    m.writeUInt32BE(keysym, 4)
    ws.send(m)
  }
  return {
    clipboard(text: string) {
      const t = Buffer.from(text, 'latin1')
      const m = Buffer.alloc(8)
      m[0] = 6
      m.writeUInt32BE(t.length, 4)
      ws.send(Buffer.concat([m, t]))
    },
    paste() {
      key(CONTROL, true)
      key(V, true)
      key(V, false)
      key(CONTROL, false)
    },
    close: () => ws.close(1000),
  }
}

/**
 * Pasting into the agent's browser while you have it: Hermes takes what you
 * copied onto the screen's clipboard from the viewer in control, and only
 * from them, and Ctrl+V pastes it into the page.
 */
async function pastes() {
  const { runtime } = await newChat(socket)
  await turn(socket, runtime, toolsTag([SIGN_IN]))
  expect(printed(runtime)[0]).toContain('password')
  const screen = await viewer(await watch('default'))
  try {
    // Only watching, nothing reaches the screen's clipboard.
    screen.clipboard('seen from somewhere else')
    await takeOver('default')
    await sleep(500)
    screen.paste()
    await sleep(500)
    const secret = 'Tr0ub4dor&3-correct-horse-battery-staple-é'
    screen.clipboard(secret)
    screen.paste()
    await sleep(1000)
    await handBack('default')
    await turn(socket, runtime, toolsTag([PASSWORD]))
    expect(printed(runtime)[0].trim()).toBe(secret)
  } finally {
    screen.close()
  }
}

/** The sign-in page, marked as this chat's: a browser opened again shows it with nothing on it. */
const MINE = step(
  'Opening the sign-in page',
  `new_tab("${PAGE}sign-in.html")\nwait_for_load()\njs("window.mine = 'still mine'")`,
)
const WHERE = step('Checking where I am', `print(js("[window.mine, location.href].join(' ')"))`)

/** Whether an agent's browser is open on its screen (each agent has a screen, and a browser, of its own). */
async function browserOpen(agent: string) {
  const { stdout } = await run('docker', [
    ...['exec', hermes.container, 'sh', '-c'],
    `for p in $(pgrep -x chrome); do grep -q "profiles/${agent}/bot-desktop/" /proc/$p/cmdline && echo $p; done; true`,
  ])
  return stdout.trim() !== ''
}

/** Waits for Hermes to close a chat's browser for sitting idle (browser.inactivity_timeout, 2 minutes). */
async function idledOut(agent: string, chat: string) {
  const logs = `/opt/data/logs/agent.log /opt/data/profiles/${agent}/logs/agent.log`
  for (const until = Date.now() + 240_000; Date.now() < until; await sleep(2000)) {
    // "Cleaning up inactive session for task: <chat>@…" on 0.22.5, "… session <chat>@…" from 0.22.6.
    const { stdout } = await run('docker', [
      ...['exec', hermes.container, 'sh', '-c'],
      `grep -h "Cleaning up inactive session.*${chat}" ${logs} 2>/dev/null; true`,
    ])
    if (stdout.trim()) return
  }
  throw new Error(`Hermes didn’t close ${chat}’s idle browser in 4 minutes`)
}

/**
 * Every chat's agent browses in the one browser on the screen. The chat that
 * opened it letting go of it (Hermes closes a chat's browser a little after
 * the chat is left, or, for an agent other than the main one, once it has sat
 * idle) used to close it under another chat waiting for a sign-in: the person
 * came to an empty screen. It stays for that chat now, on its page, and closes
 * once no chat has it. With an agent of its own, so no other chat here has
 * that browser.
 */
async function sharesTheBrowser() {
  const agent = await createAgent({ name: agentName('browser'), hue: 140, role: 'Shopping' })
  try {
    await api.put(`/api/config?${q(agent)}`, { config: { browser: { allow_private_urls: true } } })
    await syncScreens([agent])
    // On a Hermes without murmur-screen, joins the install the sync started (one with it has it on already).
    if (!(await pluginOn(agent))) await addScreenPlugin(agent)
    expect(await pluginOn(agent)).toBe(true)

    const first = await newChat(socket, agent)
    await turn(socket, first.runtime, toolsTag([OPEN]), agent)
    expect(printed(first.runtime)[0]).toContain(TITLE)
    const { direct } = await lastAsk()

    // Another chat opens the sign-in page and asks for a hand; the first sits idle until Hermes lets its browser go.
    const second = await newChat(socket, agent)
    const reason = 'Sign in to the shop'
    const asked = next('the ask', (e) =>
      e.type === 'tool.start' && e.session_id === second.runtime && JSON.stringify(e.payload).includes(ASK_TOOL)
        ? e
        : undefined,
    )
    const done = next(
      'the second chat to carry on',
      (e) => (e.type === 'message.complete' && e.session_id === second.runtime ? e : undefined),
      300_000,
    )
    const text = toolsTag([MINE, reach(ASK_TOOL, { reason }, direct), WHERE])
    await socket.request('prompt.submit', { session_id: second.runtime, text, profile: agent })
    await asked()
    await idledOut(agent, first.stored)
    await sleep(5000) // Hermes notes it, then closes it
    expect(await browserOpen(agent)).toBe(true)

    // The person signs in, and the chat carries on, on its page as it left it.
    await takeOver(agent, reason)
    await sleep(1000)
    await handBack(agent)
    await done()
    expect(printed(second.runtime)[0].trim()).toBe(`still mine ${PAGE}sign-in.html`)

    // Once that chat lets its browser go too, nothing's left using it: it closes.
    await idledOut(agent, second.stored)
    for (let i = 0; i < 30 && (await browserOpen(agent)); i++) await sleep(1000)
    expect(await browserOpen(agent)).toBe(false)
  } finally {
    await removeAgent(agent)
  }
}

/** What browser_exec printed in a chat, latest first. */
const printed = (runtime: string) =>
  socket
    .of(runtime)
    .filter((e) => e.type === 'tool.complete' && (e.payload as { name?: string }).name === 'browser_exec')
    .map((e) => String((e.payload as { result?: { output?: unknown } }).result?.output ?? ''))
    .reverse()

/** The agent opens the page; its browser printed the page's title. */
async function browse(runtime: string) {
  await turn(socket, runtime, toolsTag([OPEN]))
  expect(printed(runtime)[0]).toContain(TITLE)
}

/** What a command prints on the agent's screen, run there the way its desktop runs things. */
async function onTheScreen(command: string) {
  const { stdout } = await run('docker', [
    ...['exec', '-u', 'hermes', hermes.container, 'sh', '-c'],
    `set -a; . /opt/data/bot-desktop/env; ${command}`,
  ])
  return stdout.trim()
}

/**
 * The agent's browser came up through murmur-screen's launcher: maximized on
 * the screen, without Chrome for Testing's bar, in a frame of its own (no title
 * bar), and with no window buttons (Chromium takes them from the screen's
 * desktop layout).
 */
async function openedForTheScreen() {
  const { stdout } = await run('docker', ['exec', hermes.container, 'ps', '-eo', 'args'])
  const launched = stdout
    .split('\n')
    .some((p) => p.includes('--user-data-dir') && p.includes('--start-maximized') && p.includes('--disable-infobars'))
  const frames = await onTheScreen(
    `for w in $(xwininfo -root -tree | awk '/Chromium-browser/ && !/ 1x1\\+| 10x10\\+/ { print $1 }'); do xprop -id $w _MOTIF_WM_HINTS; done`,
  )
  const ownFrame = frames !== '' && frames.split('\n').every((f) => f.endsWith('= 0x2, 0x0, 0x0, 0x0, 0x0'))
  const layout = await onTheScreen('xfconf-query -c xsettings -p /Gtk/DecorationLayout')
  return launched && ownFrame && layout === 'menu:'
}

describe('the host', () => {
  it('says what it can show, without Murmur assuming anything about it', () => {
    expect(host).toMatchObject({ profile: 'default', supported: true })
    expect(host?.profile_key).toBeTruthy()
    // Either it's ready, or Hermes says what's missing and how to install it.
    if (!host?.installed) {
      expect(host?.missing.length).toBeGreaterThan(0)
      expect(host?.install_command).toEqual(expect.any(String))
    }
  })
})

describe('a Hermes made for this (the screen and murmur-screen)', () => {
  const ready = () => !!host?.installed && plugin

  it('keeps an agent’s browser where nobody sees it until Murmur puts it on the screen', async (ctx) => {
    if (!ready()) return ctx.skip()
    expect(await shownFor('default')).toEqual({ headed: undefined, autoStart: undefined })
    expect(await pluginOn('default')).toBe(false)
    const { runtime } = await newChat(socket)
    await browse(runtime)
    expect((await loadScreen('default'))?.running).toBe(false)
  })

  it('shows it even where an older Murmur’s switch turned it off: there’s no switch now', async (ctx) => {
    if (!ready()) return ctx.skip()
    // Off, as that switch left it: the plugin disabled (Hermes doesn't keep a headed: false, its default).
    await rpc('plugins.manage', { action: 'toggle', key: SCREEN_PLUGIN, enable: false, profile: 'default' })
    await syncScreens(['default'])
    expect(await shownFor('default')).toEqual({ headed: true, autoStart: true })
    expect(await pluginOn('default')).toBe(true)
  })

  it('shows every agent’s browser once Murmur puts them in step', async (ctx) => {
    if (!ready()) return ctx.skip()
    other = await createAgent({ name: `Contract Screen ${Date.now().toString(36)}`, hue: 200, role: 'Shopping' })
    await api.put(`/api/config?${q(other)}`, { config: { browser: { allow_private_urls: true } } })
    await syncScreens(['default', other])
    for (const agent of ['default', other]) {
      expect(await shownFor(agent)).toEqual({ headed: true, autoStart: true })
      expect(await pluginOn(agent)).toBe(true)
    }
  })

  it('catches up an agent left half-done (Murmur closed between its browser and its tool)', async (ctx) => {
    if (!ready() || !other) return ctx.skip()
    await rpc('plugins.manage', { action: 'toggle', key: SCREEN_PLUGIN, enable: false, profile: other })
    await syncScreens(['default', other])
    expect(await pluginOn(other)).toBe(true)
  })

  it('tells the agent when to ask for a hand, in a chat that can show its browser', async (ctx) => {
    if (!ready()) return ctx.skip()
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, 'Hello')
    const ask = await lastAsk()
    expect(ask.offered).toBe(true)
    expect(ask.system).toContain(`call \`${ASK_TOOL}\``)
  })

  it('lets the agent type what it’s given: Hermes’s “never type a password” doesn’t reach the model', async (ctx) => {
    if (!ready()) return ctx.skip()
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, toolsTag([{ name: 'tool_describe', args: { names: ['browser_vault'] } }]))
    const last = (await modelRequests()).findLast((r) => r.body.tools?.length)
    const tools = (last?.body.tools ?? []) as { function: { name: string; description?: string } }[]
    const typing = tools.find((t) => /^browser_(exec|type)$/.test(t.function.name))?.function.description ?? ''
    const described = ((last?.body.messages ?? []) as { role: string; content: unknown }[])
      .filter((m) => m.role === 'tool')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n')
    // The vault is still there, and so is the way to it on the tool the agent types with…
    expect(typing).toContain('browser_vault')
    expect(described).toContain('save_login')
    // …but nothing telling it not to type a password, card or code, whatever Hermes's wording.
    const never = /\b(never|don[’']t|do not)\b[^.]*\b(type|enter|ask for)\b[^.]*\b(password|card|code)/i
    expect(typing).not.toMatch(never)
    expect(described).not.toMatch(never)
  })

  it('opens the browser on its screen, live through Murmur, as soon as the agent browses', async (ctx) => {
    if (!ready()) return ctx.skip()
    // The screen was off a moment ago (the agent browsed where nobody sees it): showing it counts at once.
    const { runtime } = await newChat(socket)
    await browse(runtime)
    // Murmur hears it from Hermes, without asking again.
    await seen('the screen to start', (s) => !!s?.running)

    const { data_url } = await rpc<{ data_url: string | null }>('display.thumbnail', { profile: 'default' })
    expect(data_url).toMatch(/^data:image\//)

    // The live picture, through Murmur's own /hermes proxy: Hermes's RFB bridge answers with its version.
    const ws = new WebSocket(await watch('default'))
    ws.binaryType = 'arraybuffer'
    const hello = await new Promise<string>((resolve, reject) => {
      ws.onmessage = (e) => resolve(Buffer.from(e.data as ArrayBuffer).toString('latin1'))
      ws.onerror = () => reject(new Error('The live picture didn’t connect'))
      setTimeout(() => reject(new Error('No picture in 15s')), 15_000)
    })
    ws.close(1000)
    expect(hello).toMatch(/^RFB 003\.00\d\n/)
    expect(await openedForTheScreen()).toBe(true)
  })

  it('waits while the person has the browser, and carries on once they hand it back', async (ctx) => {
    if (!ready()) return ctx.skip()
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, 'Hello')
    const { direct } = await lastAsk()
    const reason = 'Solve the check on 127.0.0.1'

    const asked = next('the ask', (e) =>
      e.type === 'tool.start' && e.session_id === runtime && JSON.stringify(e.payload).includes(ASK_TOOL)
        ? e
        : undefined,
    )
    const answered = next('the hand back', (e) =>
      e.type === 'tool.complete' && e.session_id === runtime && (e.payload as { name?: string }).name === ASK_TOOL
        ? (e.payload as { result: unknown })
        : undefined,
    )
    const leased = next('the lease', (e) =>
      e.type === 'display.lease' && (e.payload as { lease?: { holder?: string } }).lease?.holder === 'human'
        ? e
        : undefined,
    )
    const done = turn(socket, runtime, toolsTag([OPEN, reach(ASK_TOOL, { reason }, direct), LOOK]))
    await asked()
    await takeOver('default', reason)
    await leased()
    const { screens, held } = useScreens.getState()
    expect(controlOf(screens.default, held.default)).toBe('you')

    // The agent waits for as long as the person has it.
    await sleep(2500)
    expect(
      socket.of(runtime).some((e) => e.type === 'tool.complete' && (e.payload as { name?: string }).name === ASK_TOOL),
    ).toBe(false)

    await handBack('default')
    const { result } = await answered()
    expect(tookFor(ASK_TOOL, result)).toBeGreaterThanOrEqual(2000)
    await done
    // Its page is still there, as the person left it.
    expect(printed(runtime)[0]).toContain(TITLE)
    expect(controlOf(useScreens.getState().screens.default, useScreens.getState().held.default)).toBe('agent')
  })

  it('takes a paste into the page from the person in control, and from nobody else', async (ctx) => {
    if (!ready()) return ctx.skip()
    await pastes()
  })

  it('keeps one chat’s browser open when another chat ends', async (ctx) => {
    if (!ready()) return ctx.skip()
    await sharesTheBrowser()
  }, 600_000)

  it('goes by each agent’s own setting', async (ctx) => {
    if (!ready() || !other) return ctx.skip()
    await api.put(`/api/config?${q(other)}`, { config: { browser: { headed: false } } })
    const { runtime } = await newChat(socket, other)
    await turn(socket, runtime, 'Hello', other)
    expect((await lastAsk()).system).not.toContain(ASK_TOOL)
    await api.put(`/api/config?${q(other)}`, { config: { browser: { headed: true } } })
  })

  it('has what murmur-screen uses from Hermes where it looks for it', async (ctx) => {
    if (!plugin) return ctx.skip()
    // The plugin looks each one up when it's used and fails soft without it; this is where a Hermes
    // update that moved one shows up. The browser's are a Hermes's that starts Chromium itself (0.22.6
    // on) or agent-browser's, found the way the plugin finds them: by tools.browser_launcher.
    const needs = {
      always: {
        'tools.environments.base': ['touch_activity_if_due'],
        'tools.bot_desktop.runtime': ['touch_activity', 'published_env', 'is_supported_host', 'missing_binaries'],
        'tools.bot_desktop.lease': ['get', 'HUMAN'],
        'gateway.session_context': ['get_session_env'],
        'tools.interrupt': ['is_interrupted'],
        'tools.registry': ['no_cache_check_fn'],
        'hermes_cli.config': ['read_raw_config'],
        'tools.bot_desktop.browser': ['executable', 'profile_dir'],
      },
      chromium: {
        'tools.browser_launcher': ['build_chromium_argv', 'get_browser'],
        'tools.browser_session': ['_cleanup_lock', '_session_last_activity'],
        'tools.browser_session_lifecycle': ['update_session_activity'],
        'tools.browser_session_cloud': ['is_headed_mode'],
        'tools.bot_desktop.browser': ['dock_argv'],
        'hermes_cli.browser_runtime': ['chromium_executable'],
        hermes_constants: ['get_hermes_home'],
      },
      agentBrowser: {
        'tools.browser_tool': ['_cleanup_lock', '_session_last_activity'],
        'tools.browser_tool_lifecycle': ['_update_session_activity'],
        'tools.bot_desktop.browser': ['running_instance_cdp_port'],
      },
    }
    const script = [
      'import importlib, importlib.util, json, sys',
      'needs = json.loads(sys.argv[1])',
      'browser = needs["chromium" if importlib.util.find_spec("tools.browser_launcher") else "agentBrowser"]',
      'missing = []',
      'for module, names in [*needs["always"].items(), *browser.items()]:',
      '    try:',
      '        found = importlib.import_module(module)',
      '        missing += [f"{module}.{n}" for n in names if not hasattr(found, n)]',
      '    except Exception as error:',
      '        missing.append(f"{module} ({error})")',
      'print(json.dumps(missing))',
    ].join('\n')
    const { stdout } = await run(
      'docker',
      [
        'exec',
        '-u',
        'hermes',
        '-w',
        '/opt/hermes',
        hermes.container,
        '/opt/hermes/.venv/bin/python3',
        '-c',
        script,
        JSON.stringify(needs),
      ],
      { maxBuffer: 1 << 20 },
    )
    expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '[]')).toEqual([])
  })
})

describe('a Hermes of someone’s own, with the screen (Nous’s desktop image)', () => {
  const own = () => !!host?.installed && !plugin

  it('shows its agents’ browsers by itself, and gives them the tool to ask for a hand the way it gives email', async (ctx) => {
    if (!own()) return ctx.skip()
    await syncScreens([])
    expect(await shownFor('default')).toEqual({ headed: true, autoStart: true })
    // Murmur doesn't wait for the plugin to clone: this joins the install it started.
    await addScreenPlugin('default')
    expect(await pluginOn('default')).toBe(true)
    // Live, with no restart.
    const { runtime } = await newChat(socket)
    await turn(socket, runtime, 'Hello')
    expect((await lastAsk()).offered).toBe(true)
  })

  it('opens its browser the way it does on Umbrel’s image: maximized on the screen, with no testing bar or window buttons', async (ctx) => {
    if (!own()) return ctx.skip()
    const { runtime } = await newChat(socket)
    await browse(runtime)
    await seen('the screen to start', (s) => !!s?.running)
    expect(await openedForTheScreen()).toBe(true)
  })

  it('takes a paste into the page from the person in control, and from nobody else', async (ctx) => {
    if (!own()) return ctx.skip()
    await pastes()
  })

  it('keeps one chat’s browser open when another chat ends', async (ctx) => {
    if (!own()) return ctx.skip()
    await sharesTheBrowser()
  }, 600_000)
})

describe('a Hermes without the screen (Linux, not set up for it)', () => {
  const bare = () => !host?.installed

  it('leaves its agents as they are until it’s set up', async (ctx) => {
    if (!bare()) return ctx.skip()
    const name = agentName('screen')
    other = await createAgent({ name, hue: 30, role: 'Shopping' })
    await syncScreens(['default', other])
    expect(await shownFor('default')).toEqual({ headed: undefined, autoStart: undefined })
    expect(await shownFor(other)).toEqual({ headed: undefined, autoStart: undefined })
  })

  it('sets it up with Hermes’s own installer, and says what to run when it can’t', async (ctx) => {
    if (!bare()) return ctx.skip()
    // Nobody types the server's password here: asked for one, the person gives up.
    const unsubscribe = useInstall.subscribe((s) => {
      const state = s.default
      if (state?.phase === 'password') state.answer('')
    })
    try {
      await installScreen()
    } finally {
      unsubscribe()
    }
    const state = useInstall.getState().default
    expect(state).toMatchObject({ phase: 'failed' })
    expect(state?.phase === 'failed' && state.command).toEqual(expect.any(String))
    expect((await loadScreen('default'))?.installed).toBe(false)
    // Nous's own image runs Hermes without root or sudo: an install can't work there, and Murmur knows it.
    const { stdout } = await exec('sh', '-c', 'id -u; command -v sudo || true')
    const [uid, sudo] = stdout.trim().split('\n')
    if (uid !== '0' && !sudo) {
      expect(state).toMatchObject({ unprivileged: true })
      expect(state?.phase === 'failed' && state.command).not.toMatch(/^sudo /)
    }
  })
})
