import { useId } from 'react'
import { cn } from '@/lib/cn'

/** WhatsApp's phone-in-a-bubble in its green circle, for rows, tiles and badges. */
export function WhatsAppGlyph({ size = 28, className, ring }: { size?: number; className?: string; ring?: boolean }) {
  // Each glyph its own gradient: a shared id breaks every copy once the first is hidden.
  const fill = `wa${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
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
          <stop offset="0" stopColor="#5fe07d" />
          <stop offset="1" stopColor="#25c152" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill={`url(#${fill})`} />
      <path
        fill="#fff"
        transform="translate(5.1 5.1) scale(0.575)"
        d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.03-.52-.07-.15-.67-1.62-.91-2.21-.25-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.42.25-.7.25-1.29.18-1.41-.08-.13-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.89 9.89-9.89a9.83 9.83 0 0 1 9.88 9.9c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.42"
      />
    </svg>
  )
}
