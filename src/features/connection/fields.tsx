import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Eye, EyeOff } from 'lucide-react'
import { TextField } from '@/ui/field'
import { cn } from '@/lib/cn'

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }

const invalidRing = 'ring-danger/50! focus:ring-danger/70!'

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ invalid, className, ...props }, ref) {
  return <TextField ref={ref} aria-invalid={invalid || undefined} className={cn(invalid && invalidRing, className)} {...props} />
})

export const PasswordField = forwardRef<HTMLInputElement, FieldProps>(function PasswordField({ invalid, className, ...props }, ref) {
  const [reveal, setReveal] = useState(false)
  return (
    <div className="relative">
      <TextField
        ref={ref}
        type={reveal ? 'text' : 'password'}
        aria-invalid={invalid || undefined}
        className={cn('pr-12', invalid && invalidRing, className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setReveal((r) => !r)}
        aria-label={reveal ? 'Hide password' : 'Show password'}
        className="absolute top-0 right-0 grid size-12 place-items-center rounded-xl text-ink-3 transition-colors select-none hover:text-ink-2 focus-visible:-outline-offset-2 active:text-ink"
      >
        {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
})

/** A line under a field: guidance in grey, problems in red. Animates in and out. */
export function Note({ tone = 'quiet', children }: { tone?: 'quiet' | 'danger'; children?: ReactNode }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {children && (
        <motion.p
          key={String(tone) + String(typeof children === 'string' ? children : '')}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className={cn('mt-2 px-4 text-footnote text-pretty', tone === 'danger' ? 'text-danger' : 'text-ink-2')}
          aria-live="polite"
        >
          {children}
        </motion.p>
      )}
    </AnimatePresence>
  )
}

export function StatusDot({ tone }: { tone: 'success' | 'danger' | 'warning' | 'quiet' }) {
  return (
    <span className="relative flex size-2.5 flex-none" aria-hidden>
      {tone === 'success' && <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-30 [animation-duration:2.4s] [animation-iteration-count:3] motion-reduce:hidden" />}
      <span
        className={cn(
          'relative size-2.5 rounded-full',
          tone === 'success' && 'bg-success',
          tone === 'danger' && 'bg-danger',
          tone === 'warning' && 'bg-warning',
          tone === 'quiet' && 'bg-ink-3',
        )}
      />
    </span>
  )
}
