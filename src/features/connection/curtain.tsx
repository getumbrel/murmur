import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { MurmurMark } from '@/ui/brand'
import { liftCurtain, useSwitchCurtain } from '@/state/connection'
import { useReadiness } from '@/state/readiness'
import { useAgents } from '@/state/agents'

// The seam when switching Hermes. The old Hermes blurs away behind frosted
// glass, the mark breathes with "Switching to VPS…" under it, the app reloads
// beneath, and the glass clears onto the new Hermes. The mark sits exactly
// where the splash puts its own, so if the splash is still up when the glass
// clears, the one hands straight to the other.

const ease = [0.16, 1, 0.3, 1] as const

export function SwitchCurtain() {
  const curtain = useSwitchCurtain((s) => s.curtain)
  const reduce = useReducedMotion()
  // Arriving (after the reload) it's already up: no entrance.
  const enter = curtain?.arriving ? false : undefined
  // On <body>, not in #root: #root is its own stacking context, and the curtain
  // has to cover sheets (portalled to <body>) too.
  return createPortal(
    <AnimatePresence>
      {curtain && (
        <motion.div
          key="curtain"
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="fixed inset-0 z-[1000] grid place-items-center bg-bg/72 pb-[6vh] backdrop-blur-2xl backdrop-saturate-150"
          initial={enter ?? { opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: reduce ? 0.15 : 0.24, ease } }}
          exit={{ opacity: 0, transition: { duration: reduce ? 0.15 : 0.4, ease } }}
        >
          <div className="relative">
            <motion.div
              initial={enter ?? (reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 6 })}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: reduce ? 0.15 : 0.42, ease }}
            >
              <MurmurMark size={48} breathe label="" />
            </motion.div>
            {/* Hangs under the mark, so the mark keeps the splash's spot. */}
            <div className="absolute top-full left-1/2 mt-5 w-max max-w-[calc(100vw-40px)] -translate-x-1/2">
              <motion.p
                className="truncate text-center text-subhead text-ink-2"
                initial={enter ?? (reduce ? { opacity: 0 } : { opacity: 0, y: 6 })}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ delay: reduce ? 0 : 0.06, duration: reduce ? 0.15 : 0.36, ease }}
              >
                {curtain.name ? (
                  <>
                    Switching to <span className="font-semibold text-ink">{curtain.name}</span>…
                  </>
                ) : (
                  'Switching servers…'
                )}
              </motion.p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

const HOLD_MAX_MS = 8000

/**
 * Inside the app (and its QueryClient): lifts the curtain carried over a
 * switch once the new Hermes has answered, the same moment the splash would
 * hand over. Renders nothing.
 */
export function CurtainLift() {
  const arriving = useSwitchCurtain((s) => !!s.curtain?.arriving)
  return arriving ? <LiftWhenDrawn /> : null
}

function LiftWhenDrawn() {
  const readiness = useReadiness()
  const agents = useAgents()
  const drawn = readiness !== 'loading' && (!(readiness === 'ready' || readiness === 'needs-welcome') || !agents.isPending)
  useEffect(() => {
    // A beat for the app to paint under the glass first; never hold forever.
    const t = setTimeout(liftCurtain, drawn ? 160 : HOLD_MAX_MS)
    return () => clearTimeout(t)
  }, [drawn])
  return null
}
