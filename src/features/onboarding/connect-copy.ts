// Words for "Connect a model" that depend on where things are (connect.tsx).

import { isPrivateUrl, type ModelServer } from './servers'

/** The computer Hermes runs on: itself, or, from inside Docker, the computer around it. */
const HERE = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|host\.docker\.internal)$/

/** "Ollama has no models yet." The card above it offers one, so that's all it needs to say. */
export function emptyLine(server: Pick<ModelServer, 'name' | 'baseUrl'>, umbrel?: boolean) {
  let host = ''
  try {
    host = new URL(server.baseUrl).hostname
  } catch {
    // Not an address: named without a place.
  }
  const here = HERE.test(host)
  // On umbrelOS, a container name (no dots) is this Umbrel.
  if (umbrel && host && !host.includes('.') && !here)
    return `${server.name} has no models yet.`
  const place = here ? 'this computer' : host
  return place
    ? `${server.name} on ${place} has no models yet.`
    : `${server.name} has no models yet.`
}

/**
 * The promise under a list of servers, made only when every one is at home:
 * on this machine (or a container beside Hermes), else on the network.
 */
export function privacyLine(servers: Pick<ModelServer, 'baseUrl'>[], umbrel?: boolean) {
  if (!servers.length || !servers.every((s) => isPrivateUrl(s.baseUrl))) return null
  const here = servers.every((s) => {
    const host = new URL(s.baseUrl).hostname
    return HERE.test(host) || !/[.:]/.test(host)
  })
  const where = here ? (umbrel ? 'on your Umbrel' : 'on your own computer') : 'on your own network'
  return `Runs privately ${where}. Nothing leaves your home.`
}
