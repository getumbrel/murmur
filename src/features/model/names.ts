// Model ids are for machines ("gpt-6.1-sol", "anthropic/claude-opus-5").
// People see "GPT‑6.1 Sol" and "Claude Opus 5".

const WORDS: Record<string, string> = {
  gpt: 'GPT',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  glm: 'GLM',
  xai: 'xAI',
  qwen: 'Qwen',
  minimax: 'MiniMax',
  oss: 'OSS',
  vl: 'VL',
  ai: 'AI',
}

/** "gpt-6.1-sol" → "GPT‑6.1 Sol", "anthropic/claude-opus-5" → "Claude Opus 5", "llama3.2:3b" → "Llama3.2 3B". */
export function prettyModel(id?: string) {
  if (!id) return 'Model'
  const parts = (id.split('/').pop() ?? id)
    .replace(/:latest$/i, '')
    .split(/[-_:\s]+/)
    .filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const lower = part.toLowerCase()
    if (lower === 'gpt' && /^\d/.test(parts[i + 1] ?? '')) {
      // A non-breaking hyphen keeps "GPT‑6.1" on one line.
      out.push(`GPT‑${parts[++i]}`)
    } else if (/^\d+(\.\d+)?[kmb]$/i.test(part) || /^[vr]\d/i.test(part)) {
      out.push(part.toUpperCase())
    } else if (/^o\d/.test(lower)) {
      out.push(lower)
    } else if (WORDS[lower]) {
      out.push(WORDS[lower])
    } else {
      out.push(part[0].toUpperCase() + part.slice(1))
    }
  }
  return out.join(' ')
}

const SERVICES: Record<string, string> = {
  'openai-codex': 'ChatGPT',
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  nous: 'Nous Portal',
  gemini: 'Google',
  xai: 'xAI',
  'xai-oauth': 'xAI',
}

export function serviceName(slug: string, name?: string) {
  return SERVICES[slug] ?? (name || slug).replace(/\s*\(.*\)$/, '')
}

// ── Thinking ────────────────────────────────────────────────────────────────

export type Thinking = 'auto' | 'quick' | 'deep' | 'max'

export const THINKING_OPTIONS: { value: Thinking; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'quick', label: 'Quick' },
  { value: 'deep', label: 'Deep' },
  { value: 'max', label: 'Max' },
]

/** The Hermes effort each choice sends. Auto sends nothing: the agent's own default. */
export const EFFORT: Record<Exclude<Thinking, 'auto'>, string> = { quick: 'low', deep: 'high', max: 'max' }

/** Read a Hermes effort back as a choice. Matching the agent's default is Auto. */
export function thinkingOf(effort: string | undefined, agentDefault: string | undefined): Thinking {
  if (!effort || effort === (agentDefault ?? 'medium')) return 'auto'
  if (effort === 'low' || effort === 'minimal' || effort === 'none') return 'quick'
  if (effort === 'high') return 'deep'
  if (effort === 'xhigh' || effort === 'max' || effort === 'ultra') return 'max'
  return 'auto'
}

export const thinkingLabel = (t: Thinking) => THINKING_OPTIONS.find((o) => o.value === t)!.label
