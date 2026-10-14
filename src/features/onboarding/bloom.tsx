import { motion } from 'motion/react'

// A one-time celebration around an orb: two soft rings ripple outward over a
// brief glow, in the surrounding accent. Place inside a `relative` box the
// orb's size. Under reduced motion it simply isn't there.

const ease = [0.16, 1, 0.3, 1] as const

export function Bloom({ delay = 0 }: { delay?: number }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
      <motion.span
        className="absolute -inset-[30%] rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: [0, 1, 0], scale: [0.7, 1.15, 1.3] }}
        transition={{ duration: 1.5, ease, delay, times: [0, 0.3, 1] }}
      />
      {[0, 1].map((n) => (
        <motion.span
          key={n}
          className="absolute inset-0 rounded-full ring-2 ring-accent"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: [0.95, 1.8], opacity: [0.6, 0] }}
          transition={{ duration: 1.2, ease, delay: delay + n * 0.24 }}
        />
      ))}
    </span>
  )
}
