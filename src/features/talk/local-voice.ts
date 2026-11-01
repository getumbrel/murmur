// Local voices: models that run on the agent's own machine, through the Hermes image's murmur-voice
// plugin. Each language has one pair, the same on every box (English and Chinese; Piper and Whisper
// for the rest), downloaded on demand. Until a download finishes the agent talks with Hermes's own
// Piper and Whisper, and it moves over by itself once it's done. docs/hermes/voice.md has the routes.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, HermesError } from '@/hermes/rest'

export type LocalKind = 'speak' | 'listen'

export type LocalDownload = {
  state: 'downloading' | 'unpacking' | 'installing' | 'done' | 'failed'
  received: number
  total: number
  /** Seconds left, once there's a speed to go by. */
  eta: number | null
  error: { kind: 'space' | 'network' | 'checksum' | 'unsupported' | 'unknown'; detail: string } | null
}

export type LocalVoice = {
  language: string
  /** What this language speaks and listens with once it's downloaded. */
  pair: Record<LocalKind, { id: string; name: string; builtin: boolean }>
  /** Bytes still to download for it. */
  size: number
  /** Whether the agent hears and speaks through these (its stt and tts provider). */
  on: Record<LocalKind, boolean>
  /** What runs now: the pair once it's downloaded, Piper and Whisper until then. */
  active: Record<LocalKind, string>
  download: LocalDownload | null
}

const q = (profile: string) => `profile=${encodeURIComponent(profile)}`
export const localKey = (profile: string, language?: string) => ['local-voice', profile, language ?? '']

/** The plugin's picture of this machine, or null for a Hermes without it. */
export async function readLocal(profile: string, language?: string): Promise<LocalVoice | null> {
  try {
    return await api.get<LocalVoice>(`/api/plugins/murmur-voice/local?${q(profile)}${language ? `&language=${language}` : ''}`)
  } catch (e) {
    if (e instanceof HermesError && (e.status === 404 || e.status === 405)) return null
    throw e
  }
}

/** Fetch this language's pair (the agent's own language when it's left out). */
export function installLocal(profile: string, language?: string) {
  return api.post<LocalVoice>(`/api/plugins/murmur-voice/local/install?${q(profile)}`, { language })
}

export const downloading = (d?: LocalDownload | null) =>
  !!d && (d.state === 'downloading' || d.state === 'unpacking' || d.state === 'installing')

/** Kept fresh while something downloads, so progress moves. */
export function useLocalVoice(profile?: string, language?: string) {
  return useQuery({
    queryKey: localKey(profile ?? '', language),
    enabled: !!profile,
    staleTime: 30_000,
    queryFn: () => readLocal(profile!, language),
    refetchInterval: (query) => (downloading(query.state.data?.download) ? 1000 : false),
  })
}

export function useLocalRefresh() {
  const qc = useQueryClient()
  return (profile: string) => qc.invalidateQueries({ queryKey: ['local-voice', profile] })
}

/** "1.2 GB", "480 MB". */
function size(bytes: number) {
  if (bytes >= 950_000_000) return `${(bytes / 1e9).toFixed(1).replace(/\.0$/, '')} GB`
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

/** What the local row says while its models are on their way, or after they've stopped coming. */
export function downloadLine(local?: LocalVoice | null) {
  const d = local?.download
  if (!local?.size || !d) return undefined
  if (d.state === 'failed') return d.error?.kind === 'space' ? `Needs ${size(local.size)} free, tap to retry` : 'Download stopped, tap to retry'
  if (!downloading(d)) return undefined
  // (Each package unpacks as it lands, so only the last step counts as finishing.)
  return d.total && d.received >= d.total ? 'Finishing up…' : `Downloading… ${d.total ? Math.floor((d.received / d.total) * 100) : 0}%`
}
