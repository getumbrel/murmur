import { useId } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { formatCardNumber, type CardBrand } from '@/state/vault'

// A payment card as you'd hold it: its network's colours, a chip, the number
// and expiry. Being typed in, it fills as you go: the first digit turns it
// from the agent's colour into the network's, and the dots give way to the
// digits. Saved, only the last four are known.

type Props = {
  brand?: CardBrand
  /** Digits as they're typed, or nothing for a saved card. */
  digits?: string
  /** A saved card's last four. */
  last4?: string
  name?: string
  expiry?: string
  /** `row` is a 28px thumbnail for lists; `face` is the card itself. */
  size?: 'row' | 'face'
  className?: string
}

/** Each network's colour, deep enough under white type in either theme. */
const FACES: Record<CardBrand | 'none', string> = {
  visa: 'linear-gradient(135deg, #2b3bb0 0%, #1a1f71 58%, #11154f 100%)',
  mastercard: 'linear-gradient(135deg, #46464f 0%, #26262c 60%, #17171b 100%)',
  amex: 'linear-gradient(135deg, #3d9ae6 0%, #0b6fc4 58%, #08508f 100%)',
  discover: 'linear-gradient(135deg, #ff9445 0%, #f26b1d 58%, #c94d0b 100%)',
  diners: 'linear-gradient(135deg, #5b6c86 0%, #34415a 60%, #232d40 100%)',
  jcb: 'linear-gradient(135deg, #23a06b 0%, #0d7a4f 60%, #075637 100%)',
  unionpay: 'linear-gradient(135deg, #e5434b 0%, #b8202a 60%, #86141c 100%)',
  // No network yet: the agent's own colour.
  none: 'linear-gradient(135deg, oklch(0.6 0.15 var(--hue)) 0%, oklch(0.46 0.15 var(--hue)) 60%, oklch(0.36 0.12 var(--hue)) 100%)',
}

export function CardFace({ brand, digits, last4, name, expiry, size = 'face', className }: Props) {
  const face = FACES[brand ?? 'none']
  if (size === 'row')
    return (
      <span
        aria-hidden
        className={cn('relative block h-[19px] w-7 overflow-hidden rounded-[4px] shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.18)]', className)}
        style={{ background: face }}
      >
        <span className="absolute inset-0 bg-[linear-gradient(160deg,rgb(255_255_255/0.22),transparent_50%)]" />
        {brand === 'mastercard' ? (
          <Circles className="absolute right-[3px] bottom-[3px] h-[7px]" />
        ) : (
          <span className="absolute top-[5px] left-[4px] h-[5px] w-[7px] rounded-[1.5px] bg-[linear-gradient(135deg,#f3dc9a,#c9a04e)]" />
        )}
      </span>
    )

  return (
    <div
      aria-hidden
      className={cn(
        'relative aspect-[1.586] w-full overflow-hidden rounded-[14px] text-left text-white select-none [container-type:inline-size]',
        'shadow-[0_10px_30px_-8px_rgb(0_0_0/0.35),inset_0_0_0_0.5px_rgb(255_255_255/0.2)]',
        className,
      )}
    >
      {/* The colour crossfades as the network becomes known. */}
      <AnimatePresence initial={false}>
        <motion.span
          key={brand ?? 'none'}
          className="absolute inset-0"
          style={{ background: face }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
      </AnimatePresence>
      {/* Lit from the upper left, like everything else in Murmur. */}
      <span className="absolute inset-0 bg-[radial-gradient(120%_90%_at_10%_0%,rgb(255_255_255/0.26),transparent_55%)]" />
      <span className="absolute -right-1/4 -bottom-1/2 size-[90%] rounded-full bg-white/[0.06]" />

      <div className="absolute inset-0 flex flex-col justify-between p-[7%]">
        <div className="flex items-start justify-between">
          <Chip />
          <Network brand={brand} />
        </div>
        <div>
          <p className="text-[clamp(15px,5.6cqw,19px)] font-medium tracking-[0.08em] tabular-nums [text-shadow:0_1px_1px_rgb(0_0_0/0.2)]">
            {numberLine(brand, digits, last4)}
          </p>
          <div className="mt-[4%] flex items-baseline justify-between gap-3 text-[12px] font-medium tracking-[0.06em] text-white/80 uppercase">
            <span className="min-w-0 truncate">{name?.trim() || ' '}</span>
            <span className="flex-none tabular-nums">{expiry?.trim() || ''}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The number as far as it's known: typed digits, then dots for the rest; a saved card's last four. */
function numberLine(brand: CardBrand | undefined, digits?: string, last4?: string) {
  if (digits) {
    const amex = brand === 'amex'
    const length = amex ? 15 : Math.max(16, digits.length)
    const shown = formatCardNumber(digits.padEnd(length, '0'))
    // Every placeholder digit becomes a dot, keeping the groups' spacing.
    let i = 0
    return shown.replace(/\d/g, (d) => (i++ < digits.length ? d : '•'))
  }
  if (last4) return brand === 'amex' ? `•••• •••••• •${last4}` : `•••• •••• •••• ${last4}`
  return '•••• •••• •••• ••••'
}

function Chip() {
  return (
    <span className="relative block h-[22%] min-h-6 w-[13%] min-w-8 rounded-[5px] bg-[linear-gradient(135deg,#f6e3a8_0%,#d8b25f_50%,#b98e3b_100%)] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.18)]">
      <span className="absolute inset-x-[22%] inset-y-[30%] rounded-[2px] border border-black/15" />
    </span>
  )
}

/** Each network's name the way it's printed on its cards, set in type (or, for Mastercard, its circles). */
function Network({ brand }: { brand?: CardBrand }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {brand && (
        <motion.span
          key={brand}
          initial={{ opacity: 0, scale: 0.8, y: -2 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', duration: 0.4, bounce: 0.3 }}
          className="block origin-top-right"
        >
          {brand === 'mastercard' ? (
            <Circles className="h-7" />
          ) : brand === 'visa' ? (
            <span className="block text-[22px] leading-none font-extrabold tracking-[-0.03em] italic">VISA</span>
          ) : brand === 'amex' ? (
            <span className="block rounded-[3px] border border-white/80 px-1.5 py-0.5 text-[11px] leading-none font-extrabold tracking-[0.04em]">
              AMEX
            </span>
          ) : (
            <span className="block text-[13px] leading-none font-bold tracking-[0.02em]">
              {{ discover: 'DISCOVER', diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay' }[brand]}
            </span>
          )}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

/** Mastercard's two circles and the orange where they meet. */
function Circles({ className }: { className?: string }) {
  const id = `mc${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg viewBox="0 0 38 24" className={className} aria-hidden>
      <defs>
        <clipPath id={id}>
          <circle cx="12" cy="12" r="11" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="11" fill="#eb001b" />
      <circle cx="26" cy="12" r="11" fill="#f79e1b" />
      <circle cx="26" cy="12" r="11" fill="#ff5f00" clipPath={`url(#${id})`} />
    </svg>
  )
}
