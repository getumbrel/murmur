import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ClipboardPaste } from 'lucide-react'
import { Label } from '@/ui/field'
import { isDesktop } from '@/lib/desktop'
import { cn } from '@/lib/cn'
import type { SsoPhase } from '@/state/sign-in'
import { Field, Note } from './fields'

// While a single sign-on is open, under the address. On the computer Murmur
// runs on it comes back by itself, so this only says where to finish. Anywhere
// else it ends on a page that won't load (127.0.0.1, the browser's own
// computer), so this takes that page's address: the placeholder shows what it
// looks like, and a paste that looks right goes without a tap.

const RETURN_EXAMPLE = 'http://127.0.0.1/murmur/…'

export function SsoSteps({
  phase,
  pasted,
  onPaste,
  onCancel,
  flush,
}: {
  phase: Exclude<SsoPhase, { step: 'idle' }>
  pasted: string
  onPaste: (text: string) => void
  onCancel: () => void
  /** On a card with no field to line up with: the words sit on the card's own edges. */
  flush?: boolean
}) {
  const field = useRef<HTMLInputElement>(null)
  const paste = phase.step === 'waiting' && phase.returns === 'paste' ? phase : undefined
  // Back from the sign-in tab: ready to paste.
  useEffect(() => {
    if (paste) field.current?.focus({ preventScroll: true })
  }, [!!paste])

  const cancel = (
    <button
      type="button"
      onClick={onCancel}
      className="pressable -my-2 rounded-md px-1 py-2 text-footnote font-medium text-accent select-none hover:opacity-80"
    >
      Cancel
    </button>
  )
  // Coming back by itself, and not yet: a sign-in can stop on an error page Murmur never hears about.
  const [slow, setSlow] = useState<string>()
  const here = phase.step === 'waiting' && phase.returns === 'here' ? phase.id : undefined
  useEffect(() => {
    if (!here) return
    const timer = setTimeout(() => setSlow(here), 60_000)
    return () => clearTimeout(timer)
  }, [here])

  // The clipboard can only be read in a secure context (HTTPS or localhost).
  const canRead = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="mt-5"
    >
      {paste ? (
        <>
          <Label hint={cancel}>Where the sign-in ends</Label>
          <div className="relative">
            <Field
              ref={field}
              value={pasted}
              onChange={(e) => onPaste(e.target.value)}
              placeholder={RETURN_EXAMPLE}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              aria-label="Address the sign-in ended on"
              invalid={!!paste.error}
              className={canRead ? 'pr-24' : undefined}
              disabled={paste.checking}
            />
            {canRead && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    onPaste(await navigator.clipboard.readText())
                  } catch {
                    // Not allowed: the field still takes a paste the usual way.
                    field.current?.focus()
                  }
                }}
                disabled={paste.checking}
                className="pressable absolute top-1/2 right-2 inline-flex h-8 -translate-y-1/2 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-footnote font-semibold text-accent select-none hover:brightness-105 active:brightness-95"
              >
                <ClipboardPaste size={14} strokeWidth={2.25} aria-hidden />
                Paste
              </button>
            )}
          </div>
          <Note tone={paste.error ? 'danger' : 'quiet'}>
            {paste.error ??
              'Sign in with the tab that just opened. It ends on a page that can’t load. That’s expected: copy that page’s address and paste it here.'}
          </Note>
        </>
      ) : (
        <>
          {flush ? (
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="text-footnote font-medium text-ink-2">Signing in</span>
              <span className="-mr-1 text-caption">{cancel}</span>
            </div>
          ) : (
            <Label hint={cancel}>Signing in</Label>
          )}
          {/* The button below shows it's under way; this says where. */}
          <p className={cn('text-subhead text-pretty text-ink-2', !flush && 'px-4')} aria-live="polite">
            {phase.step === 'opening'
              ? 'Opening the sign-in…'
              : slow === here
                ? 'Still waiting. If the sign-in stopped on an error, cancel and start again.'
                : `Sign in with ${isDesktop ? 'your browser' : 'the tab that just opened'}. Murmur carries on by itself.`}
          </p>
        </>
      )}
    </motion.div>
  )
}
