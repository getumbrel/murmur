import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

// In development the Murmur server (npm run dev:server, :3000) proxies Hermes;
// Vite forwards those paths to it so the browser stays same-origin. Host is
// kept as the browser sent it: the server checks Origin against it.
const server = process.env.MURMUR_SERVER ?? 'http://localhost:3000'

// Settings → About shows the version in package.json, baked in at build time.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

const src = (path = '') => fileURLToPath(new URL(`./src${path && '/' + path}`, import.meta.url))
// Code the server runs too (shared/): plain TypeScript, no browser or Node APIs.
const shared = fileURLToPath(new URL('./shared', import.meta.url))

/**
 * Writes `.br` and `.gz` beside every text asset in the build, compressed once
 * at the highest settings, so the server (server/index.ts) only picks a file
 * and never compresses per request. A sibling is skipped when it saves too
 * little to be worth a lookup. Images, fonts and source maps are left alone.
 */
function precompress(): Plugin {
  const TEXT = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt', '.xml', '.wasm'])
  let outDir = 'dist'
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
  return {
    name: 'murmur:precompress',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        for (const file of walk(outDir)) {
          if (!TEXT.has(extname(file)) || statSync(file).size < 1024) continue
          const raw = readFileSync(file)
          const br = brotliCompressSync(raw, {
            params: {
              [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
              [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
            },
          })
          const gz = gzipSync(raw, { level: 9 })
          if (br.length < raw.length * 0.9) writeFileSync(`${file}.br`, br)
          if (gz.length < raw.length * 0.9) writeFileSync(`${file}.gz`, gz)
        }
      },
    },
  }
}

/**
 * Tells the service worker (public/sw.js) what this build is made of, so it
 * can keep the app on the device and open it when the server can't be reached:
 * every file but the page itself, source maps and the worker, and a version
 * that changes when any of them does. Runs before `precompress`, which
 * compresses the worker as written here.
 */
function keepApp(): Plugin {
  const HOLE = 'const SHELL = null'
  let outDir = 'dist'
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
  return {
    name: 'murmur:keep-app',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle: {
      order: 'pre',
      sequential: true,
      handler() {
        const worker = join(outDir, 'sw.js')
        const source = readFileSync(worker, 'utf8')
        if (!source.includes(HOLE)) throw new Error('public/sw.js has no place for the build’s files')
        const hash = createHash('sha256')
        const files = walk(outDir)
          .map((file) => ({ file, path: '/' + relative(outDir, file).split(sep).join('/') }))
          .filter(({ path }) => !['/index.html', '/sw.js'].includes(path) && !/\.(map|br|gz)$/.test(path))
          .sort((a, b) => a.path.localeCompare(b.path))
        for (const { file, path } of [...files, { file: join(outDir, 'index.html'), path: '/index.html' }]) {
          hash.update(path).update(readFileSync(file))
        }
        const shell = { version: hash.digest('hex').slice(0, 12), files: files.map((f) => f.path) }
        writeFileSync(worker, source.replace(HOLE, `const SHELL = ${JSON.stringify(shell)}`))
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), keepApp(), precompress()],
  define: { __MURMUR_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: [
      { find: '@', replacement: src() },
      { find: '@shared', replacement: shared },
      // @streamdown/code's `shiki` becomes Murmur's cut-down bundle: ~28 common
      // languages and the JavaScript regex engine, no WASM (src/features/chat/shiki.ts).
      { find: /^shiki$/, replacement: src('features/chat/shiki.ts') },
    ],
  },
  server: {
    host: true,
    proxy: {
      '/hermes': { target: server, ws: true },
      '/murmur': { target: server },
    },
  },
})
