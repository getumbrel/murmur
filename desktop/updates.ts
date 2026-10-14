// Updates from GitHub releases (electron-updater), in release builds only:
// checked at launch and every few hours, downloaded quietly, installed on the
// next quit, or now from "Restart to Update". Development and unsigned local
// builds never look for updates.

import { app, dialog, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { setMenu } from './menu.ts'

const EVERY_MS = 4 * 60 * 60 * 1000
const FIRST_AFTER_MS = 15_000

/** Whether this build may update itself. Linux updates only as an AppImage. */
export const updatesEnabled = () =>
  __MURMUR_UPDATES__ && app.isPackaged && (process.platform !== 'linux' || Boolean(process.env.APPIMAGE))

export function startUpdates() {
  if (!updatesEnabled()) return setMenu()
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: () => {}, warn: console.warn, error: console.error, debug: () => {} }

  let ready: string | undefined
  let asked = false
  const restart = () => autoUpdater.quitAndInstall()

  // A check someone asked for answers either way; the scheduled ones stay quiet.
  async function check(manual = false) {
    try {
      const result = await autoUpdater.checkForUpdates()
      if (!manual || ready) return
      const current = app.getVersion()
      const next = result?.updateInfo.version
      if (!result?.isUpdateAvailable || !next || next === current) {
        await message('Murmur is up to date.', `You have the latest version, ${current}.`)
      } else {
        await message(`Murmur ${next} is on its way.`, 'It’s downloading now. You can restart to use it as soon as it’s ready.')
      }
    } catch (error) {
      console.warn('Murmur: update check failed:', (error as Error).message)
      if (manual) await message('Murmur couldn’t check for updates.', 'Check your internet connection, then try again.')
    }
  }

  autoUpdater.on('update-downloaded', async (info) => {
    ready = info.version
    setMenu({ ready, restart })
    if (asked) return
    asked = true
    // Not on a window closed to the Dock: a sheet on a hidden window is never seen.
    const window = BrowserWindow.getAllWindows().find((w) => w.isVisible())
    const options = {
      type: 'info' as const,
      message: `Murmur ${info.version} is ready.`,
      detail: 'Restart Murmur to start using it, or it’ll update the next time you quit.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }
    const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
    if (response === 0) restart()
  })

  setMenu({ check: () => void check(true) })
  setTimeout(() => void check(), FIRST_AFTER_MS)
  setInterval(() => void check(), EVERY_MS)
}

function message(text: string, detail: string) {
  const window = BrowserWindow.getFocusedWindow()
  const options = { type: 'info' as const, message: text, detail, buttons: ['OK'] }
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
}
