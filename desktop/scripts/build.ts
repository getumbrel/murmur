// Assembles desktop/app/, the folder electron-builder packages:
//
//   main.js, preload.js   the Electron side and Murmur's server, bundled to CommonJS
//   web/                  the built web app (npm run build first), minus the .gz
//                         copies: Chromium always takes the .br ones
//   package.json          name, version and entry point; no dependencies, all bundled
//   icon.png, licenses
//
//   node desktop/scripts/build.ts          for packaging
//   node desktop/scripts/build.ts --dev    main.js and preload.js only, with source maps
//
// MURMUR_UPDATES=1 builds an app that updates itself (release builds in CI).

import { build, type BuildOptions } from 'esbuild'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
export const appDir = `${root}desktop/app`

const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { version: string; description: string; license: string }

export const bundleOptions = (dev: boolean): BuildOptions => ({
  entryPoints: { main: `${root}desktop/main.ts`, preload: `${root}desktop/preload.ts` },
  outdir: appDir,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  define: {
    __MURMUR_VERSION__: JSON.stringify(pkg.version),
    __MURMUR_UPDATES__: String(!dev && process.env.MURMUR_UPDATES === '1'),
  },
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  logLevel: 'warning',
})

function writePackage() {
  const manifest = {
    name: 'murmur',
    productName: 'Murmur',
    version: pkg.version,
    description: pkg.description,
    license: pkg.license,
    author: { name: 'Umbrel, Inc.', url: 'https://umbrel.com' },
    homepage: 'https://umbrel.com/murmur',
    main: 'main.js',
    // Linux: the window's app id, so desktops match it to murmur.desktop.
    desktopName: 'murmur.desktop',
  }
  writeFileSync(`${appDir}/package.json`, JSON.stringify(manifest, null, 2) + '\n')
}

export async function assemble(dev = false) {
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(appDir, { recursive: true })
  await build(bundleOptions(dev))
  writePackage()
  copyFileSync(`${root}desktop/resources/icon.png`, `${appDir}/icon.png`)
  if (dev) return
  if (!existsSync(`${root}dist/index.html`)) throw new Error('Build the web app first: npm run build')
  cpSync(`${root}dist`, `${appDir}/web`, { recursive: true, filter: (src) => !src.endsWith('.gz') })
  // MIT asks for these notices to travel with every copy, as in the Docker image.
  mkdirSync(`${appDir}/licenses`)
  copyFileSync(`${root}LICENSE`, `${appDir}/LICENSE`)
  copyFileSync(`${root}src/hermes/vendor/LICENSE`, `${appDir}/licenses/hermes-agent.LICENSE`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dev = process.argv.includes('--dev')
  await assemble(dev)
  console.log(`Desktop app assembled in ${appDir}${dev ? ' (development)' : ''}`)
}
