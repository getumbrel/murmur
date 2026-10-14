import { useEffect, useRef, useState } from 'react'
import type { OrbState } from '@/ui/orb'
import type { ChatStatus } from '@/features/chat/types'

/**
 * The header orb mirrors the chat: a little "done" bounce when a reply lands,
 * eyes on the composer while you type, and a soft pulse while it reads aloud.
 */
export function useOrbState(
  status: ChatStatus | 'offline',
  { typing = false, speaking = false }: { typing?: boolean; speaking?: boolean } = {},
): OrbState {
  const [done, setDone] = useState(false)
  const prev = useRef(status)
  useEffect(() => {
    const wasBusy = prev.current === 'thinking' || prev.current === 'working'
    prev.current = status
    if (!wasBusy || status !== 'idle') return setDone(false)
    setDone(true)
    const t = setTimeout(() => setDone(false), 1600)
    return () => clearTimeout(t)
  }, [status])
  if (status === 'thinking' || status === 'working' || status === 'waiting' || status === 'error' || status === 'offline')
    return status
  if (done) return 'done'
  if (speaking) return 'speaking'
  if (typing) return 'listening'
  return 'idle'
}
