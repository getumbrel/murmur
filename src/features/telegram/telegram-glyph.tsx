import { useId } from 'react'
import { cn } from '@/lib/cn'

/** Telegram's paper plane in its blue circle, for rows and badges. */
export function TelegramGlyph({ size = 28, className, ring }: { size?: number; className?: string; ring?: boolean }) {
  // Each glyph its own gradient: a shared id breaks every copy once the first is hidden.
  const fill = `tg${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className={cn('block flex-none rounded-full', ring && 'ring-[3px] ring-elevated', className)}
    >
      <defs>
        <linearGradient id={fill} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#37aee2" />
          <stop offset="1" stopColor="#1d93d2" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill={`url(#${fill})`} />
      <path
        fill="#fff"
        d="M5.43 11.87c3.5-1.52 5.83-2.53 7-3.02 3.33-1.39 4.02-1.63 4.47-1.64.1 0 .32.02.47.14.12.1.15.23.17.33.02.1.04.31.02.48-.18 1.9-.96 6.5-1.36 8.63-.17.9-.5 1.2-.82 1.23-.7.06-1.22-.46-1.9-.9-1.05-.7-1.65-1.13-2.67-1.8-1.18-.78-.42-1.2.26-1.9.18-.18 3.24-2.97 3.3-3.22 0-.03.01-.15-.06-.21s-.17-.04-.25-.02c-.1.02-1.79 1.14-5.06 3.35-.48.33-.91.49-1.3.48-.43-.01-1.25-.24-1.86-.44-.75-.24-1.35-.37-1.3-.79.03-.21.33-.43.89-.66z"
      />
    </svg>
  )
}
