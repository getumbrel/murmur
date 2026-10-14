// The only bridge between the web app and the desktop shell. The page runs
// sandboxed with context isolation, so this is all it can ask of the app.
//
//   window.murmurDesktop = { platform, version, setBadge(count), focus(), setTheme(mode) }
//   <html data-desktop="mac" | "win" | "linux">, before the first paint
//   <html data-fullscreen>, while the window is full screen

import { contextBridge, ipcRenderer } from 'electron'

const platform = process.platform as 'darwin' | 'win32' | 'linux'
const desktop = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux'

let fullScreen = ipcRenderer.sendSync('murmur:fullscreen?') === true

// The preload runs before the document has an <html>; the parser adds it next.
function mark() {
  const html = document.documentElement
  if (!html) return false
  html.dataset.desktop = desktop
  if (fullScreen) html.dataset.fullscreen = ''
  else delete html.dataset.fullscreen
  return true
}
if (!mark()) {
  const observer = new MutationObserver(() => mark() && observer.disconnect())
  observer.observe(document, { childList: true })
}

ipcRenderer.on('murmur:fullscreen', (_event, on: unknown) => {
  fullScreen = on === true
  mark()
})

contextBridge.exposeInMainWorld(
  'murmurDesktop',
  Object.freeze({
    platform,
    version: __MURMUR_VERSION__,
    setBadge: (count: number) => ipcRenderer.send('murmur:badge', count),
    focus: () => ipcRenderer.send('murmur:focus'),
    setTheme: (mode: 'system' | 'light' | 'dark') => ipcRenderer.send('murmur:theme', mode),
  }),
)
