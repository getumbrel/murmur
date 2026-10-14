// Words for "Connect a model" that depend on where things are (connect.tsx).

import type { LocalServer } from './connect'

/** "Ollama has no models yet." The card above it offers one, so that's all it needs to say. */
export function emptyLine(server: Pick<LocalServer, 'name' | 'baseUrl'>, umbrel?: boolean) {
  let host = ''
  try {
    host = new URL(server.baseUrl).hostname
  } catch {
    // Not an address: named without a place.
  }
  const here = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(host)
  // On umbrelOS, a container name (no dots) is this Umbrel.
  if (umbrel && host && !host.includes('.') && !here)
    return `${server.name} has no models yet.`
  const place = here ? 'this computer' : host
  return place
    ? `${server.name} on ${place} has no models yet.`
    : `${server.name} has no models yet.`
}
