// Murmur server: serves the web app and gives it a same-origin path to Hermes.
//
//   /hermes/api/*        → Hermes dashboard API (REST + the /api/ws JSON-RPC
//                          socket), signed in server-side (proxy.ts, hermes.ts).
//                          Nothing else of Hermes: its pages carry its token.
//   /murmur/connections  → the Hermes this Murmur knows, and which one this
//                          browser uses (connection.ts). /murmur/connection
//                          is the older single-Hermes API, still answered.
//   /murmur/login …      → Murmur's own optional password (access.ts).
//   /murmur/local        → finds OpenAI-compatible model servers on this Umbrel
//                          (the browser can't reach other containers directly).
//   everything else      → the built web app, with SPA fallback.
//
// No dependencies: node:http for serving, raw sockets for WebSocket upgrades.
// This file starts it with settings from the environment; app.ts is the server.

import { accessRequired } from './access.ts'
import { startServer } from './app.ts'
import { dataDir } from './config.ts'
import { firstTarget } from './connection.ts'

const { port } = await startServer()
const target = firstTarget()
console.log(`Murmur listening on :${port} → Hermes at ${target.url} (${target.source})`)
console.log(`Data in ${dataDir()}${accessRequired() ? '; sign-in required' : ''}`)
