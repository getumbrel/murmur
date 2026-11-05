// Signing in to a Hermes with single sign-on (server/sso.ts). Murmur's server
// opens the sign-in and keeps what comes of it; the browser only shows the
// sign-in, then either waits for it to come back to Murmur's server (on the
// computer Murmur runs on) or takes the address it ended on, pasted.
// What it ends with is an id that a connection call takes in place of a
// password (ConnectionRequest.signIn).

import { useEffect, useRef, useState } from 'react'
import { isDesktop } from '@/lib/desktop'
import { openSignInTab, showSignIn } from './apps'

type Started = { id: string; address: string; returns: 'here' | 'paste' }
type Status = { status: 'waiting' | 'ready' | 'failed'; error?: string }

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Can’t reach Murmur. Check your connection, then try again.')
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!data || (!res.ok && !('status' in data))) throw new Error(data?.error ?? `Murmur returned ${res.status}`)
  return data
}

async function status(id: string): Promise<Status> {
  const res = await fetch(`/murmur/sign-in/${encodeURIComponent(id)}`, { cache: 'no-store' })
  const data = (await res.json().catch(() => null)) as Status | null
  return data ?? { status: 'waiting' }
}

/** Whether pasted text holds the end of a sign-in (its code and state), so it can go without a tap. */
export function looksFinished(text: string) {
  const query = text.includes('?') ? text.slice(text.indexOf('?') + 1) : text
  const params = new URLSearchParams(query.trim().split('#')[0])
  return !!params.get('code') && !!params.get('state')
}

export type SsoPhase =
  /** `error`: why the last one ended, until the next starts. */
  | { step: 'idle'; error?: string }
  | { step: 'opening' }
  /** `returns`: whether the sign-in comes back by itself, or its address is pasted. `error`: that paste wasn't it. */
  | { step: 'waiting'; id: string; returns: 'here' | 'paste'; checking?: boolean; error?: string }

/**
 * One sign-in at a time, for a form. `start` opens it (call it straight from
 * the tap, so the browser lets the tab open); `finished` is called with the
 * id once it worked, for the form to connect with.
 */
export function useSsoSignIn(finished: (id: string) => void) {
  const [phase, setPhase] = useState<SsoPhase>({ step: 'idle' })
  const done = useRef(finished)
  done.current = finished
  const live = useRef(0)

  const cancel = () => {
    live.current++
    setPhase({ step: 'idle' })
  }

  const succeeded = (id: string) => {
    live.current++
    setPhase({ step: 'idle' })
    done.current(id)
  }
  // Final: the sign-in is over, and the next one starts from the top.
  const failed = (error?: string) => {
    live.current++
    setPhase({ step: 'idle', error: error ?? 'That sign-in didn’t go through. Try again.' })
  }

  /** `to`: Hermes's address, or one Murmur found, by id. When it can't open, the phase says why. */
  const start = async (to: { url: string } | { found: string }) => {
    const round = ++live.current
    // Opened from the tap itself, or a browser blocks it; it gets its address in a moment.
    const tab = isDesktop ? null : openSignInTab('Hermes')
    setPhase({ step: 'opening' })
    try {
      const opened = await post<Started>('/murmur/sign-in', to)
      if (round !== live.current) return void tab?.close()
      showSignIn(opened.address, tab)
      setPhase({ step: 'waiting', id: opened.id, returns: opened.returns })
    } catch (error) {
      tab?.close()
      if (round === live.current) setPhase({ step: 'idle', error: (error as Error).message })
    }
  }

  /** The address the sign-in ended on, pasted. */
  const paste = async (address: string) => {
    if (phase.step !== 'waiting') return
    const { id } = phase
    const round = live.current
    setPhase({ ...phase, checking: true, error: undefined })
    try {
      const answer = await post<Status>(`/murmur/sign-in/${encodeURIComponent(id)}`, { address })
      if (round !== live.current) return
      if (answer.status === 'ready') return succeeded(id)
      if (answer.status === 'failed') return failed(answer.error)
      setPhase((p) => (p.step === 'waiting' ? { ...p, checking: false, error: answer.error } : p))
    } catch (error) {
      if (round === live.current)
        setPhase((p) => (p.step === 'waiting' ? { ...p, checking: false, error: (error as Error).message } : p))
    }
  }

  // Coming back by itself: look until it has, and the moment Murmur is back in view.
  const waitingHere = phase.step === 'waiting' && phase.returns === 'here' ? phase.id : null
  useEffect(() => {
    if (!waitingHere) return
    const round = live.current
    let timer: ReturnType<typeof setTimeout>
    const look = async () => {
      clearTimeout(timer)
      const answer = await status(waitingHere).catch((): Status => ({ status: 'waiting' }))
      if (round !== live.current) return
      if (answer.status === 'ready') return succeeded(waitingHere)
      if (answer.status === 'failed') return failed(answer.error)
      timer = setTimeout(look, 1200)
    }
    const onVisible = () => document.visibilityState === 'visible' && void look()
    timer = setTimeout(look, 1200)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [waitingHere])

  /** Signed in, but what came next didn't work: say so where the sign-in starts again. */
  const report = (error?: string) => failed(error ?? 'That didn’t work. Try again.')

  return { phase, start, paste, cancel, report }
}
