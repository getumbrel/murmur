// Murmur server: serves the web app and gives it a same-origin path to Hermes.
//
//   /hermes/api/*        → Hermes dashboard API (REST + the /api/ws JSON-RPC
//                          socket), signed in server-side (proxy.ts, hermes.ts).
//                          Nothing else of Hermes: its pages carry its token.
//   /murmur/connections  → the Hermes this Murmur knows, and which one this
//                          browser uses (connection.ts). /murmur/connection
//                          is the older single-Hermes API, still answered.
//   /murmur/login …      → Murmur's own optional password (access.ts).
//   /murmur/setup        → where agents live, asked once: the Hermes built
//                          into Murmur, or one it found (setup.ts).
//   /murmur/telegram     → texting an agent from Telegram: setups Murmur's
//                          server sees through to the end (telegram.ts).
//   /murmur/local        → finds OpenAI-compatible model servers on this Umbrel
//                          (the browser can't reach other containers directly).
//   /murmur/site-icon    → a saved login's site icon, asked of the site itself,
//                          never a favicon service (site-icons.ts).
//   everything else      → the built web app, with SPA fallback.
//
// No dependencies: node:http for serving, raw sockets for WebSocket upgrades.
// This file starts it with settings from the environment; app.ts is the server.

import { accessRequired } from './access.ts'
import { startServer } from './app.ts'
import { builtinConfig, dataDir, decided } from './config.ts'
import { firstTarget } from './connection.ts'
import { setupSettled } from './setup.ts'

const { port } = await startServer()
// An update's first start may still be settling on the Hermes it used before.
await setupSettled()
const target = firstTarget()
const builtin = builtinConfig()
console.log(
  decided()
    ? `Murmur listening on :${port} → Hermes at ${target.url} (${target.source})`
    : `Murmur listening on :${port}; the app will ask where agents live${builtin ? ` (built-in Hermes at ${builtin.url})` : ''}`,
)
console.log(`Data in ${dataDir()}${accessRequired() ? '; sign-in required' : ''}`)
