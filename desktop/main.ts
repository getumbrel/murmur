// Murmur for macOS, Windows and Linux: Murmur's own server, started inside
// the app on a loopback port, and one window onto it.
//
// The window loads http://127.0.0.1:<port>/ (a secure context, so
// notifications, the clipboard and the microphone work as on the web). The
// page is sandboxed and isolated; preload.ts is all it can reach. It never
// leaves its own origin: links to anywhere else open in the browser.
//
// The user picks a Hermes in the app ("Connect to Hermes"); the server keeps
// the list in userData/murmur.json, as it keeps DATA_DIR/murmur.json elsewhere.

import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
  session,
  shell,
  type BrowserWindowConstructorOptions,
  type IpcMainEvent,
  type WebContents,
} from 'electron'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { startServer, type RunningServer, type ServerOptions } from '../server/app.ts'
import { contextMenu } from './menu.ts'
import { readState, saveState, type Bounds } from './state.ts'
import { startUpdates } from './updates.ts'

const APP_ID = 'com.umbrel.murmur'
const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

// Set by desktop/scripts/dev.ts: the Vite dev server to load, and the port it proxies /hermes and /murmur to.
const DEV_URL = app.isPackaged ? undefined : process.env.MURMUR_DEV_URL
const DEV_SERVER_PORT = app.isPackaged ? undefined : Number(process.env.MURMUR_DEV_SERVER_PORT) || undefined

// MURMUR_USER_DATA runs the app on other data (tests, a second profile).
// Development keeps its own, away from the installed app's.
if (process.env.MURMUR_USER_DATA) app.setPath('userData', resolve(process.env.MURMUR_USER_DATA))
else if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Murmur Dev'))

// MURMUR_SMOKE=1 (CI): start, render the first screen, print murmur-smoke-ok and quit; exit 1 if it can't.
const SMOKE = process.env.MURMUR_SMOKE === '1'
// No Keychain prompt on a CI runner for a throwaway profile.
if (SMOKE && isMac) app.commandLine.appendSwitch('use-mock-keychain')

// Only this app's own pages send the header, so nothing else on the computer
// can use the server through its port. A new one every launch. Not a cookie:
// cookies ignore the port, so the page would hand one to any other loopback
// server it loads an image from.
const ACCESS = { name: 'x-murmur-desktop', value: randomBytes(32).toString('base64url') }

const TITLE_BAR_HEIGHT = 44
const theme = () =>
  nativeTheme.shouldUseDarkColors ? { color: '#0b0b0c', symbolColor: '#f5f5f6' } : { color: '#fbfbfa', symbolColor: '#0e0e10' }

let server: RunningServer | null = null
let origin = ''
let main: BrowserWindow | null = null
// Set once Murmur is really quitting: until then, closing the window on a Mac only hides it.
let quitting = false

type ThemeMode = 'system' | 'light' | 'dark'
const THEME_MODES = new Set<unknown>(['system', 'light', 'dark'])

const ours = (url: string) => URL.canParse(url) && new URL(url).origin === origin

// ── The server ──────────────────────────────────────────────────────────────

async function serve() {
  const options: ServerOptions = {
    host: '127.0.0.1',
    dataDir: app.getPath('userData'),
    staticDir: join(__dirname, 'web'),
    // The app's settings only: a HERMES_URL or MURMUR_PASSWORD in the shell that opened it isn't meant for it.
    env: {},
    requireHeader: ACCESS,
  }
  // The last port again if it's free: the app's local storage belongs to its origin, port included.
  const wanted = DEV_SERVER_PORT ?? readState().port
  if (wanted) {
    try {
      return await startServer({ ...options, port: wanted })
    } catch (error) {
      if (DEV_SERVER_PORT) throw error
    }
  }
  const started = await startServer({ ...options, port: 0 })
  saveState({ port: started.port })
  return started
}

// ── The window ──────────────────────────────────────────────────────────────

const DEFAULT_SIZE = { width: 1200, height: 800 }
// Windows that have painted and shown once, so bringing one back never shows it blank.
const shown = new WeakSet<BrowserWindow>()

/** Saved bounds, if they still land on a screen (one may have been unplugged). */
function savedBounds() {
  const saved = readState().window
  if (!saved) return null
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) => {
    const width = Math.min(a.x + a.width, saved.x + saved.width) - Math.max(a.x, saved.x)
    const height = Math.min(a.y + a.height, saved.y + saved.height) - Math.max(a.y, saved.y)
    return width >= 120 && height >= 80
  })
  return onScreen ? saved : null
}

function rememberBounds(window: BrowserWindow) {
  let timer: NodeJS.Timeout | undefined
  const save = () => {
    if (window.isDestroyed() || window.isFullScreen() || window.isMinimized()) return
    const bounds: Bounds = window.getNormalBounds()
    saveState({ window: { ...bounds, maximized: window.isMaximized() } })
  }
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(save, 400)
  }
  window.on('resize', later)
  window.on('move', later)
  window.on('close', () => {
    clearTimeout(timer)
    save()
  })
}

function createWindow() {
  const saved = savedBounds()
  const colors = theme()
  const chrome: BrowserWindowConstructorOptions = isMac
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }
    : { titleBarStyle: 'hidden', titleBarOverlay: { ...colors, height: TITLE_BAR_HEIGHT } }
  const window = new BrowserWindow({
    ...(saved ?? DEFAULT_SIZE),
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'Murmur',
    backgroundColor: colors.color,
    ...chrome,
    ...(process.platform === 'linux' && { icon: join(__dirname, 'icon.png') }),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      devTools: !app.isPackaged || process.env.MURMUR_DEVTOOLS === '1',
    },
  })
  window.once('ready-to-show', () => {
    if (saved?.maximized) window.maximize()
    window.show()
    shown.add(window)
  })
  rememberBounds(window)
  window.webContents.on('context-menu', (_event, params) => contextMenu(window, params))
  window.on('closed', () => {
    if (main === window) main = null
  })
  // A Mac app keeps running with its window closed, and the page is what watches
  // Hermes, notifies and keeps the Dock badge: closing only hides it.
  window.on('close', (event) => {
    if (!isMac || quitting) return
    event.preventDefault()
    if (!window.isFullScreen()) return window.hide()
    window.once('leave-full-screen', () => window.hide())
    window.setFullScreen(false)
  })
  const fullScreen = (on: boolean) => () => window.webContents.send('murmur:fullscreen', on)
  window.on('enter-full-screen', fullScreen(true))
  window.on('leave-full-screen', fullScreen(false))
  void window.loadURL(DEV_URL ?? `${server!.url}/`)
  return window
}

function bringForward(window: BrowserWindow | null) {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  if (isMac) app.focus({ steal: true })
}

function setThemeSource(mode: ThemeMode) {
  if (nativeTheme.themeSource !== mode) nativeTheme.themeSource = mode
}

// Follows the OS, or Murmur's own Light or Dark (setTheme): the window's background and the caption buttons.
nativeTheme.on('updated', () => {
  const colors = theme()
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(colors.color)
    if (!isMac) window.setTitleBarOverlay({ ...colors, height: TITLE_BAR_HEIGHT })
  }
})

// ── What the page may do ─────────────────────────────────────────────────────

const EXTERNAL = new Set(['http:', 'https:', 'mailto:'])

function openOutside(url: string) {
  if (URL.canParse(url) && EXTERNAL.has(new URL(url).protocol)) void shell.openExternal(url)
}

/** A new window the page asked for: another site opens in the browser, Hermes's files download, Murmur's own pages open in place. */
function openRequested(contents: WebContents, url: string) {
  if (!ours(url)) return openOutside(url)
  const { pathname } = new URL(url)
  if (pathname.startsWith('/hermes/api/')) contents.downloadURL(url)
  else if (!pathname.startsWith('/hermes/') && !pathname.startsWith('/murmur/')) void contents.loadURL(url)
}

// Frames inside the page (agents' HTML previews) show their own documents, never another website.
const FRAME_DOCUMENT = /^(about|data|blob):/

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openRequested(contents, url)
    return { action: 'deny' }
  })
  const stay = (event: Electron.Event, url: string) => {
    if (ours(url)) return
    event.preventDefault()
    openOutside(url)
  }
  contents.on('will-navigate', stay)
  contents.on('will-redirect', stay)
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !ours(event.url) && !FRAME_DOCUMENT.test(event.url)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

// Notifications, dictation (the microphone only) and the clipboard, for Murmur's own page.
const PERMISSIONS = new Set(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'])

function guardSession() {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_contents, permission, allow, details) => {
    const microphoneOnly = permission !== 'media' || ('mediaTypes' in details && (details.mediaTypes ?? []).every((t) => t === 'audio'))
    allow(ours(details.requestingUrl) && PERMISSIONS.has(permission) && microphoneOnly)
  })
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => ours(requestingOrigin) && PERMISSIONS.has(permission))

  // The access header, on requests to Murmur's server from its own pages only: not from
  // an agent's sandboxed preview, whose origin is opaque.
  const ownPage = (frame: Electron.WebFrameMain | null | undefined) => {
    try {
      return !frame || frame.origin === origin
    } catch {
      return false
    }
  }
  const wsOrigin = origin.replace(/^http/, 'ws')
  ses.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`, `${wsOrigin}/*`] }, (details, done) => {
    const headers = { ...details.requestHeaders }
    if (details.resourceType === 'mainFrame' || ownPage(details.frame)) headers[ACCESS.name] = ACCESS.value
    done({ requestHeaders: headers })
  })

  // Scripts stay open: agents' HTML previews (sandboxed srcdoc frames) inherit this policy and run their own.
  const policy = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  ses.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, done) => {
    const headers = { ...details.responseHeaders }
    const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-security-policy') ?? 'Content-Security-Policy'
    headers[key] = [...(headers[key] ?? []), policy]
    done({ responseHeaders: headers })
  })
}

function trusted(event: IpcMainEvent) {
  const frame = event.senderFrame
  return Boolean(frame && frame === event.sender.mainFrame && ours(frame.url))
}

ipcMain.on('murmur:badge', (event, raw: unknown) => {
  if (!trusted(event)) return
  const count = Math.min(9999, Math.max(0, Math.floor(Number(raw)) || 0))
  if (!isWindows) return void app.setBadgeCount(count)
  BrowserWindow.fromWebContents(event.sender)?.setOverlayIcon(count ? badgeDot() : null, count ? `${count} unread` : '')
})

ipcMain.on('murmur:focus', (event) => {
  if (trusted(event)) bringForward(BrowserWindow.fromWebContents(event.sender))
})

ipcMain.on('murmur:theme', (event, mode: unknown) => {
  if (!trusted(event) || !THEME_MODES.has(mode)) return
  setThemeSource(mode as ThemeMode)
  saveState({ theme: mode as ThemeMode })
})

// The preload asks once, so a reload in full screen still knows.
ipcMain.on('murmur:fullscreen?', (event) => {
  event.returnValue = BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
})

/** Windows has no badge count: a small red dot over the taskbar icon instead. */
let dot: Electron.NativeImage | null = null
function badgeDot() {
  if (dot) return dot
  const size = 32
  const pixels = Buffer.alloc(size * size * 4)
  const centre = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Antialiased edge, premultiplied BGRA: #ff3b30.
      const a = Math.min(1, Math.max(0, size / 2 - 1 - Math.hypot(x - centre, y - centre) + 0.5))
      pixels.set([0x30 * a, 0x3b * a, 0xff * a, 0xff * a].map(Math.round), (y * size + x) * 4)
    }
  }
  return (dot = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 }))
}

// ── The app ─────────────────────────────────────────────────────────────────

function smoke(window: BrowserWindow) {
  const fail = (why: string) => {
    console.error(`murmur-smoke-failed: ${why}`)
    app.exit(1)
  }
  const timer = setTimeout(() => fail('nothing rendered within 60 seconds'), 60_000)
  window.webContents.once('did-fail-load', (_event, code, description) => fail(`${description} (${code})`))
  window.webContents.once('did-finish-load', async () => {
    const rendered = "document.documentElement.dataset.desktop && document.getElementById('root')?.childElementCount > 0"
    for (let i = 0; i < 100; i++) {
      if (await window.webContents.executeJavaScript(rendered).catch(() => false)) {
        clearTimeout(timer)
        console.log(`murmur-smoke-ok ${app.getVersion()} ${process.platform}-${process.arch}`)
        return app.exit(0)
      }
      await new Promise((done) => setTimeout(done, 200))
    }
    fail('the page loaded but the app never rendered')
  })
}

async function start() {
  try {
    server = await serve()
  } catch (error) {
    if (SMOKE) console.error(`murmur-smoke-failed: ${(error as Error).message}`)
    else dialog.showErrorBox('Murmur couldn’t start', (error as Error).message)
    return app.exit(1)
  }
  origin = new URL(DEV_URL ?? server.url).origin
  guardSession()
  if (!SMOKE) startUpdates()
  main = createWindow()
  if (SMOKE) smoke(main)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (isWindows) app.setAppUserModelId(APP_ID)
  app.setAboutPanelOptions({
    applicationName: 'Murmur',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Umbrel, Inc.',
    website: 'https://umbrel.com/murmur',
    ...(!isMac && { iconPath: join(__dirname, 'icon.png') }),
  })

  // The theme Murmur was last set to, so the window opens in it with no flash.
  const theme = readState().theme
  if (THEME_MODES.has(theme)) setThemeSource(theme!)

  app.on('second-instance', () => {
    if (server) bringForward(main ?? (main = createWindow()))
  })
  // macOS keeps the app (and its server) running with its window hidden; the Dock icon brings it back.
  app.on('activate', () => {
    if (!server) return
    if (!main) main = createWindow()
    else if (shown.has(main)) bringForward(main)
  })
  app.on('before-quit', () => {
    quitting = true
  })
  // Installing an update closes the windows before 'before-quit'.
  if (isMac) autoUpdater.on('before-quit-for-update', () => (quitting = true))
  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
  app.on('will-quit', () => void server?.close())

  void app.whenReady().then(start)
}
