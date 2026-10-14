import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, Mic, MicOff, X } from 'lucide-react'
import { api } from '@/hermes/rest'
import { cn } from '@/lib/cn'
import { Spinner } from '@/ui/spinner'

// Talk instead of type. Tap the mic, speak, tap ✓: Hermes turns the recording
// into text (with the agent's own speech-to-text settings) and it lands in the
// composer to read over before sending. Nothing is sent on its own.
//
// Browsers only lend the microphone to secure pages (https or localhost), so
// over plain http (http://umbrel.local) there's no mic at all.

/** Long enough for a thought; short enough that a forgotten recording stops itself. */
const MAX_MS = 2 * 60_000
const BARS = 128

export const canDictate = () =>
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  typeof MediaRecorder !== 'undefined'

export type Dictation = ReturnType<typeof useDictation>

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing'

type Recording = {
  recorder: MediaRecorder
  stream: MediaStream
  audio?: AudioContext
  chunks: Blob[]
  started: number
  timers: number[]
  frame?: number
}

/** Records from the mic and hands back the words. `profile` is whose speech-to-text settings to use. */
export function useDictation({ profile, onText }: { profile?: string; onText: (text: string) => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string>()
  const [elapsed, setElapsed] = useState(0)
  /** The live input level history, newest last (0–1), for the meter to draw. */
  const levels = useRef<number[]>(Array(BARS).fill(0))
  const listeners = useRef(new Set<() => void>())
  const rec = useRef<Recording | null>(null)
  const run = useRef(0)
  const deliver = useRef(onText)
  deliver.current = onText

  const release = useCallback(() => {
    const r = rec.current
    if (!r) return
    rec.current = null
    r.timers.forEach((t) => window.clearInterval(t))
    if (r.frame) cancelAnimationFrame(r.frame)
    r.stream.getTracks().forEach((t) => t.stop())
    void r.audio?.close().catch(() => {})
  }, [])

  const cancel = useCallback(() => {
    run.current++
    const r = rec.current
    if (r && r.recorder.state !== 'inactive') {
      r.recorder.ondataavailable = null
      r.recorder.onstop = null
      r.recorder.stop()
    }
    release()
    setPhase('idle')
  }, [release])

  const start = useCallback(async () => {
    if (!canDictate() || rec.current) return
    const mine = ++run.current
    setError(undefined)
    setElapsed(0)
    levels.current = Array(BARS).fill(0)
    setPhase('starting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (e) {
      if (run.current !== mine) return
      setPhase('idle')
      setError(micError(e))
      return
    }
    if (run.current !== mine) return void stream.getTracks().forEach((t) => t.stop())

    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) =>
      MediaRecorder.isTypeSupported?.(t),
    )
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const r: Recording = { recorder, stream, chunks: [], started: Date.now(), timers: [] }
    rec.current = r
    recorder.ondataavailable = (e) => e.data.size && r.chunks.push(e.data)
    recorder.start(250)
    setPhase('recording')

    // The meter: how loud, a few times a second, scrolling right to left.
    try {
      const audio = new AudioContext()
      r.audio = audio
      const analyser = audio.createAnalyser()
      analyser.fftSize = 1024
      audio.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      let last = 0
      const tick = (now: number) => {
        r.frame = requestAnimationFrame(tick)
        if (now - last < 70) return
        last = now
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (const v of data) sum += ((v - 128) / 128) ** 2
        // Speech sits around 0.02–0.2 RMS; lift it so a normal voice fills the bar.
        const level = Math.min(1, Math.sqrt(sum / data.length) * 5.5)
        levels.current = [...levels.current.slice(1), level]
        listeners.current.forEach((fn) => fn())
      }
      r.frame = requestAnimationFrame(tick)
    } catch {
      // No meter, still a recording.
    }
    r.timers.push(
      window.setInterval(() => {
        const ms = Date.now() - r.started
        setElapsed(ms)
        if (ms >= MAX_MS) void stopRef.current()
      }, 250),
    )
  }, [])

  const stop = useCallback(async () => {
    const r = rec.current
    if (!r) return
    const mine = run.current
    setPhase('transcribing')
    const blob = await new Promise<Blob>((resolve) => {
      r.recorder.onstop = () => resolve(new Blob(r.chunks, { type: r.recorder.mimeType || 'audio/webm' }))
      if (r.recorder.state === 'inactive') resolve(new Blob(r.chunks, { type: r.recorder.mimeType || 'audio/webm' }))
      else r.recorder.stop()
    })
    release()
    if (run.current !== mine) return
    if (!blob.size) {
      setPhase('idle')
      setError(EMPTY)
      return
    }
    try {
      const mime = (blob.type || 'audio/webm').split(';')[0]
      const res = await api.post<{ transcript?: string }>(
        `/api/audio/transcribe${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`,
        { data_url: await dataUrl(blob), mime_type: mime },
      )
      if (run.current !== mine) return
      const text = res.transcript?.trim()
      setPhase('idle')
      if (text) deliver.current(text)
      else setError(EMPTY)
    } catch (e) {
      if (run.current !== mine) return
      setPhase('idle')
      setError(transcribeError(e instanceof Error ? e.message : ''))
    }
  }, [profile, release])
  const stopRef = useRef(stop)
  stopRef.current = stop

  // Leaving the chat lets go of the mic.
  useEffect(
    () => () => {
      run.current++
      release()
    },
    [release],
  )

  const subscribe = useCallback((fn: () => void) => {
    listeners.current.add(fn)
    return () => void listeners.current.delete(fn)
  }, [])

  return {
    phase,
    active: phase !== 'idle',
    elapsed,
    error,
    clearError: useCallback(() => setError(undefined), []),
    start,
    stop,
    cancel,
    levels,
    subscribe,
  }
}

const EMPTY = 'Didn’t catch anything. Try again, a little closer to the mic.'

function micError(e: unknown) {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Murmur can’t use the microphone. Allow it for this site in your browser’s settings, then try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No microphone found. Plug one in, then try again.'
  if (name === 'NotReadableError') return 'Another app is using the microphone. Close it, then try again.'
  return 'Couldn’t start the microphone. Try again.'
}

function transcribeError(raw: string) {
  if (/disabled|not installed|no installed|no .*(stt|speech)|not configured|no provider|api key/i.test(raw))
    return 'Voice typing isn’t set up on this Hermes yet. You can still type.'
  if (/too large/i.test(raw)) return 'That recording was too long. Try a shorter one.'
  return 'Couldn’t turn that into text. Try again in a moment.'
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ── Pieces ──────────────────────────────────────────────────────────────────

const round =
  'pressable relative flex size-9 flex-none items-center justify-center rounded-full after:absolute after:-inset-1'

/** Sits where Send will be, while there's nothing to send. */
export function MicButton({ dictation, disabled }: { dictation: Dictation; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => void dictation.start()}
      disabled={disabled || dictation.active}
      aria-label="Dictate"
      title="Dictate"
      className={cn(round, 'text-ink-2 hover:bg-fill-2 hover:text-ink disabled:opacity-40')}
    >
      <Mic size={19} strokeWidth={1.85} />
    </button>
  )
}

/**
 * Covers the composer while recording: cancel on the left, the live level and
 * the time in the middle, ✓ where the mic was. Put it inside the composer's
 * capsule (it fills the nearest positioned box). `roomy` composers (with a
 * toolbar under the text) draw the level across the text area instead.
 */
export function DictationPanel({ dictation, roomy }: { dictation: Dictation; roomy?: boolean }) {
  const { phase, elapsed, cancel, stop } = dictation
  const busy = phase === 'transcribing'
  const ref = useRef<HTMLDivElement>(null)

  // Esc backs out; Enter (or Space on the ✓) keeps it.
  useEffect(() => {
    if (!dictation.active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancel()
      } else if (e.key === 'Enter' && phase === 'recording') {
        e.preventDefault()
        void stop()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dictation.active, phase, cancel, stop])
  // Keyboard focus moves to ✓, so Space/Enter finish and Tab reaches cancel.
  useEffect(() => {
    if (phase === 'recording') ref.current?.querySelector<HTMLElement>('[data-done]')?.focus({ preventScroll: true })
  }, [phase])

  const meter = <Meter dictation={dictation} className={cn('min-w-0 flex-1', roomy ? 'h-8' : 'h-6')} />
  const status = (
    <span className="flex flex-none items-center gap-1.5 text-footnote text-ink-2 tabular-nums" aria-live="polite">
      {busy ? (
        <span className="text-shimmer">Turning it into text…</span>
      ) : (
        <>
          <span aria-hidden className="dictation-dot size-2 rounded-full bg-danger" />
          <span aria-label={`Recording, ${clock(elapsed)}`}>{clock(elapsed)}</span>
        </>
      )}
    </span>
  )

  return (
    <AnimatePresence>
      {dictation.active && (
        <motion.div
          ref={ref}
          role="group"
          aria-label="Dictation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="dictation absolute inset-0 z-10 flex flex-col justify-end rounded-[inherit]"
        >
          {roomy && (
            <div className={cn('flex min-h-0 flex-1 items-center px-4.5 pt-2', busy && 'opacity-40')}>{meter}</div>
          )}
          <div className={cn('flex items-center gap-2', roomy ? 'px-2 pt-1 pb-2' : 'p-2')}>
            <button
              type="button"
              onClick={cancel}
              aria-label="Cancel dictation"
              title="Cancel"
              className={cn(round, 'text-ink-2 hover:bg-fill-2 hover:text-ink')}
            >
              <X size={19} strokeWidth={2} />
            </button>
            {roomy ? (
              <>
                {status}
                <div className="flex-1" />
              </>
            ) : (
              <>
                {status}
                <div className={cn('flex min-w-0 flex-1', busy && 'opacity-40')}>{meter}</div>
              </>
            )}
            <button
              type="button"
              data-done
              onClick={() => void stop()}
              disabled={phase !== 'recording'}
              aria-label="Done, turn it into text"
              title="Done"
              className={cn(round, 'bg-accent text-accent-ink disabled:bg-fill-3 disabled:text-ink-3')}
            >
              {phase === 'recording' ? <Check size={19} strokeWidth={2.4} /> : <Spinner size={16} />}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The live level: a row of soft bars in the agent's colour, newest on the right. */
function Meter({ dictation, className }: { dictation: Dictation; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { levels, subscribe } = dictation
  useEffect(() => {
    const draw = () => {
      const bars = box.current?.children
      if (!bars) return
      const vals = levels.current
      const offset = vals.length - bars.length
      for (let i = 0; i < bars.length; i++) {
        const v = vals[offset + i] ?? 0
        ;(bars[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.12, v).toFixed(3)})`
      }
    }
    draw()
    return subscribe(draw)
  }, [levels, subscribe])
  // Fewer bars on narrow meters, so each stays a readable 3px.
  const [count, setCount] = useState(BARS)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setCount(Math.max(8, Math.min(BARS, Math.floor(el.clientWidth / 6)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} aria-hidden className={cn('flex items-center justify-between gap-[3px] overflow-hidden', className)}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-full w-[3px] flex-none origin-center rounded-full bg-accent',
            !reduce && 'transition-transform duration-75 ease-out',
          )}
          style={{ transform: 'scaleY(0.12)' }}
        />
      ))}
    </div>
  )
}

/** A gentle line inside the composer when dictation couldn't happen. */
export function DictationNote({ dictation }: { dictation: Dictation }) {
  const { error, clearError } = dictation
  // It steps aside by itself after a while.
  useEffect(() => {
    if (!error) return
    const t = window.setTimeout(clearError, 9000)
    return () => window.clearTimeout(t)
  }, [error, clearError])
  return (
    <AnimatePresence initial={false}>
      {error && (
        <motion.div
          key="note"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: 'spring', duration: 0.32, bounce: 0 }}
          className="overflow-hidden"
        >
          <div role="status" className="flex items-start gap-2 px-4 pt-3 text-footnote text-ink-2">
            <MicOff size={15} strokeWidth={2} aria-hidden className="mt-[2px] flex-none text-ink-3" />
            <p className="min-w-0 flex-1 text-pretty">{error}</p>
            <button
              type="button"
              onClick={clearError}
              aria-label="Dismiss"
              className="pressable relative -mt-0.5 -mr-1 flex size-5 flex-none items-center justify-center rounded-full text-ink-3 hover:bg-fill-2 hover:text-ink after:absolute after:-inset-2.5"
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
