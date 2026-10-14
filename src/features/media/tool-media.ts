// Images a tool produced, e.g. image_generate → {"success": true, "image": "/opt/data/…png"}.
// Mirrors Hermes Desktop: generated images come from `host_image` / `image`;
// other tools may name one in `image_url`, `image_path`, `path` or `url`.

const IMAGE_PATH = /^(?:~\/|\/|file:)[^\n]*\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i
const IMAGE_URL = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif)(?:[?#]\S*)?$/i

const KEYS = ['host_image', 'image', 'images', 'image_path', 'image_url', 'path', 'file_path', 'url', 'output_path']

function parse(result: unknown): Record<string, unknown> | null {
  if (result && typeof result === 'object') return result as Record<string, unknown>
  if (typeof result !== 'string' || !result.trim().startsWith('{')) return null
  try {
    const value = JSON.parse(result)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

export function toolMedia(name: string, result: unknown): string[] {
  // Tools that only look at an image (vision) don't produce one.
  if (/vision|analy[sz]e|browser_|read_file|search/i.test(name)) return []
  const r = parse(result)
  if (!r || r.success === false || r.error) return []
  const found: string[] = []
  for (const k of KEYS) {
    const values = Array.isArray(r[k]) ? (r[k] as unknown[]) : [r[k]]
    for (const v of values) {
      if (typeof v !== 'string') continue
      const s = v.trim()
      if ((IMAGE_PATH.test(s) || IMAGE_URL.test(s)) && !found.includes(s)) found.push(s)
    }
    // host_image is the canonical copy; the rest repeat it.
    if (k === 'host_image' && found.length) break
  }
  return found.slice(0, 4)
}
