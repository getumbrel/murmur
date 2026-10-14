import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'
type Size = 'sm' | 'md' | 'lg'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  loading?: boolean
}

// Hover only exists for fine pointers (Tailwind wraps it in (hover:hover));
// touch gets the press scale plus a fill change in :active. Disabled buttons
// turn an opaque grey with readable ink rather than fading: their labels
// often say what's missing ("Pick 2 more"), and they float over content.
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-bg hover:opacity-90 active:opacity-85',
  accent: 'bg-accent text-accent-ink hover:brightness-105 active:brightness-95',
  secondary: 'bg-fill-2 text-ink hover:bg-fill-3 active:bg-fill-3',
  ghost: 'text-ink hover:bg-fill-1 active:bg-fill-2',
  danger: 'bg-danger/10 text-danger hover:bg-danger/15 active:bg-danger/20',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-footnote gap-1.5',
  md: 'h-10 px-4.5 text-subhead gap-2',
  lg: 'h-13 px-6 text-body gap-2 w-full',
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      type="button"
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'pressable touch-target relative inline-flex items-center justify-center rounded-full font-medium tracking-[-0.01em] select-none',
        'disabled:pointer-events-none',
        disabled && !loading ? (variant === 'ghost' ? 'text-ink-3' : 'bg-fill-solid text-ink-3') : variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'inline-flex items-center gap-[inherit] transition-[opacity,scale] duration-200 ease-out',
          loading && 'scale-95 opacity-0',
        )}
      >
        {children}
      </span>
      {loading && <Spinner className="absolute animate-fade" />}
    </button>
  )
})

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'plain' | 'filled' | 'primary'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', variant = 'plain', className, children, ...props },
  ref,
) {
  return (
    <button
      type="button"
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        'pressable touch-target relative inline-flex flex-none items-center justify-center rounded-full select-none',
        'disabled:pointer-events-none',
        variant === 'plain' ? 'disabled:opacity-35' : 'disabled:bg-fill-solid disabled:text-ink-3',
        size === 'sm' && 'size-8',
        size === 'md' && 'size-10',
        size === 'lg' && 'size-11',
        variant === 'plain' && 'text-ink-2 hover:bg-fill-1 hover:text-ink active:bg-fill-2 active:text-ink',
        variant === 'filled' && 'bg-fill-2 text-ink hover:bg-fill-3 active:bg-fill-3',
        variant === 'primary' && 'bg-ink text-bg hover:opacity-90 active:opacity-85',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})
