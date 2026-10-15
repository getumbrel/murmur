import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

// You were sweet to the agent (thanks, <3, good bot): Hermes notices, and a
// few small hearts float up out of its face. Rare, so it gets a little moment;
// never more than that.

// They rise only a little and drift out sideways: the face sits near the top
// of the screen, and a heart that floats off it is a heart nobody sees.
const HEARTS = [
  { x: 24, y: -16, s: 0.95, r: 14, d: 0 },
  { x: -22, y: -12, s: 0.7, r: -16, d: 0.06 },
  { x: 10, y: -26, s: 0.8, r: 6, d: 0.12 },
  { x: 36, y: -4, s: 0.6, r: 22, d: 0.2 },
  { x: -8, y: -24, s: 0.55, r: -8, d: 0.28 },
]

const LIFE_MS = 1700

export function Hearts({ count }: { count?: number }) {
  const [bursts, setBursts] = useState<number[]>([])
  const seen = useRef(count)
  useEffect(() => {
    if (!count || count === seen.current) return
    seen.current = count
    setBursts((b) => [...b, count])
    window.setTimeout(() => setBursts((b) => b.filter((x) => x !== count)), LIFE_MS)
  }, [count])
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10">
      {bursts.map((id) => (
        <Burst key={id} />
      ))}
    </span>
  )
}

function Burst() {
  const reduce = useReducedMotion()
  const hearts = reduce ? HEARTS.slice(1, 2) : HEARTS
  return hearts.map((h, i) => (
    <motion.svg
      key={i}
      viewBox="0 0 16 16"
      className="absolute top-1/2 left-1/2 -mt-2 -ml-2 size-4"
      initial={{ opacity: 0, x: 0, y: reduce ? -20 : 0, scale: reduce ? 1 : 0.3, rotate: 0 }}
      animate={
        reduce
          ? { opacity: [0, 1, 0], transition: { duration: 1, times: [0, 0.3, 1] } }
          : {
              opacity: [0, 1, 1, 0],
              x: h.x,
              y: h.y,
              scale: [0.3, h.s * 1.15, h.s, h.s * 0.9],
              rotate: h.r,
              transition: { duration: 1.25, delay: h.d, ease: [0.16, 1, 0.3, 1], times: [0, 0.25, 0.7, 1] },
            }
      }
    >
      <path
        d="M8 14.2S1.6 10.4 1.6 5.9A3.3 3.3 0 0 1 8 4.3a3.3 3.3 0 0 1 6.4 1.6C14.4 10.4 8 14.2 8 14.2z"
        fill={i % 2 ? 'oklch(0.72 0.17 0)' : 'oklch(0.66 0.21 12)'}
      />
    </motion.svg>
  ))
}

/** A beat after each burst, so the face can do its happy hop too. */
export function useLoved(count?: number) {
  const [loved, setLoved] = useState(false)
  const seen = useRef(count)
  useEffect(() => {
    if (!count || count === seen.current) return
    seen.current = count
    setLoved(true)
    const t = window.setTimeout(() => setLoved(false), 1200)
    return () => window.clearTimeout(t)
  }, [count])
  return loved
}
