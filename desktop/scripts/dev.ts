// npm run desktop:dev: the desktop app on Vite's dev server.
//
// Electron starts Murmur's server on a free port and loads the Vite dev server,
// which proxies /hermes and /murmur to it (vite.config.ts, MURMUR_SERVER), so
// the web app hot-reloads as usual. Changes to desktop/ or server/ rebuild and
// restart Electron. Its data lives in "Murmur Dev", apart from the installed app.

import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { context } from 'esbuild'
import { appDir, assemble, bundleOptions } from './build.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

const freePort = () =>
  new Promise<number>((done, fail) => {
    const probe = net.createServer().once('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => done(port))
    })
  })

const serverPort = await freePort()
process.env.MURMUR_SERVER = `http://127.0.0.1:${serverPort}`

await assemble(true)
const { createServer } = await import('vite')
const vite = await createServer({ root, configFile: `${root}vite.config.ts` })
await vite.listen()
const devUrl = vite.resolvedUrls?.local[0] ?? `http://localhost:${vite.config.server.port}/`
vite.printUrls()

const electron = createRequire(import.meta.url)('electron') as unknown as string
let app: ChildProcess | null = null
let quitting = false
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
process.on('exit', () => app?.kill())

function launch() {
  app = spawn(electron, [appDir], {
    stdio: 'inherit',
    env: { ...process.env, MURMUR_DEV_URL: devUrl, MURMUR_DEV_SERVER_PORT: String(serverPort) },
  })
  app.on('exit', () => {
    app = null
    if (!quitting) void stop()
  })
}

function relaunch() {
  if (!app) return launch()
  const old = app
  old.removeAllListeners('exit')
  old.once('exit', () => {
    app = null
    launch()
  })
  old.kill()
}

// Rebuild main.js and preload.js on change, then restart Electron.
let first = true
const watcher = await context({
  ...bundleOptions(true),
  plugins: [
    {
      name: 'murmur:relaunch',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) return
          if (first) {
            first = false
            launch()
          } else {
            console.log('Desktop app changed, restarting…')
            relaunch()
          }
        })
      },
    },
  ],
})
await watcher.watch()

async function stop() {
  quitting = true
  app?.kill()
  await watcher.dispose()
  await vite.close()
  process.exit(0)
}
