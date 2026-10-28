// Model servers: anything that speaks the OpenAI API, from Ollama on this
// Umbrel to a hosted service like Groq. What an address the person typed
// means (which scheme, whether it's private), and what to call the server.

export type ServerModel = { id: string; size: number | null; parameters: string | null }

export type ModelServer = {
  name: string
  baseUrl: string
  models: ServerModel[]
  /** The key it was found with, held only until it's saved in Hermes. */
  apiKey?: string
}

/** Why a server can't be used yet, and which field can fix it. */
export type ServerProblemKind = 'address' | 'unreachable' | 'not-a-server' | 'no-models' | 'needs-key' | 'bad-key'

export class ServerProblem extends Error {
  constructor(
    message: string,
    readonly kind: ServerProblemKind,
  ) {
    super(message)
  }
  get field(): 'address' | 'key' {
    return this.kind === 'needs-key' || this.kind === 'bad-key' ? 'key' : 'address'
  }
}

/**
 * Whether a host is on the person's own network: this machine, a container
 * beside Hermes (a bare name), the LAN, or their tailnet. Anything else is
 * online, and chats sent there leave home.
 */
export function isPrivateHost(hostname: string) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true
  if (!h.includes('.') && !h.includes(':')) return true
  if (/\.(local|lan|home|internal|home\.arpa|ts\.net)$/.test(h)) return true
  const ip = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/)
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])]
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254)
    )
  }
  return /^(f[cd]|fe80)/.test(h)
}

export const isPrivateUrl = (url: string) => {
  try {
    return isPrivateHost(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * The addresses to try for what someone typed, best first. Without a scheme,
 * a server at home is plain http and one online is https; an http address
 * online also gets https, since such hosts mostly just redirect.
 */
export function addressesFor(input: string): { urls: string[]; host: string } {
  const typed = input.trim()
  const scheme = typed.match(/^(https?):\/\//i)?.[1]?.toLowerCase()
  let url: URL
  try {
    url = new URL(scheme ? typed : `http://${typed}`)
    if (!url.hostname || /\s/.test(typed)) throw new Error()
  } catch {
    throw new ServerProblem('That doesn’t look like an address. Try something like 192.168.1.20:11434.', 'address')
  }
  const at = (s: string) => `${s}://${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`
  const home = isPrivateHost(url.hostname)
  const urls =
    scheme === 'https' || (scheme === 'http' && home)
      ? [at(scheme)]
      : home
        ? [at('http')]
        : scheme
          ? [at('http'), at('https')]
          : [at('https'), at('http')]
  return { urls, host: url.host }
}

// Hosted services by domain, so they read as their names ("Groq", not "api.groq.com").
const KNOWN: Record<string, string> = {
  'openrouter.ai': 'OpenRouter',
  'groq.com': 'Groq',
  'together.xyz': 'Together',
  'together.ai': 'Together',
  'deepseek.com': 'DeepSeek',
  'mistral.ai': 'Mistral',
  'fireworks.ai': 'Fireworks',
  'cerebras.ai': 'Cerebras',
  'perplexity.ai': 'Perplexity',
  'openai.com': 'OpenAI',
  'anthropic.com': 'Anthropic',
  'x.ai': 'xAI',
  'generativelanguage.googleapis.com': 'Gemini',
  'deepinfra.com': 'DeepInfra',
  'huggingface.co': 'Hugging Face',
  'nvidia.com': 'NVIDIA',
  'sambanova.ai': 'SambaNova',
  'moonshot.ai': 'Moonshot',
  'nousresearch.com': 'Nous',
  'venice.ai': 'Venice',
}

// The usual ports of servers people run at home.
const PORTS: Record<string, string> = { '11434': 'Ollama', '1234': 'LM Studio' }

/** "Groq", "Ollama", "LM Studio", else the address itself ("192.168.1.20:8000", "llm.example.com"). */
export function serverName(url: string) {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  const host = u.hostname.toLowerCase()
  const known = Object.keys(KNOWN).find((d) => host === d || host.endsWith(`.${d}`))
  if (known) return KNOWN[known]
  if (isPrivateHost(host) && PORTS[u.port]) return PORTS[u.port]
  return u.host
}

/** Where a server is, for a subtitle: "api.groq.com", "192.168.1.20:11434". */
export const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
