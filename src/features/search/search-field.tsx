import { forwardRef, type InputHTMLAttributes } from 'react'
import { Search, X } from 'lucide-react'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/cn'

// The rounded search well: a magnifier, the text, and a clear button (or a
// small spinner while results are on their way).

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> & {
  value: string
  onValueChange: (value: string) => void
  /** Results are on their way. */
  busy?: boolean
  size?: 'md' | 'sm'
}

export const SearchField = forwardRef<HTMLInputElement, Props>(function SearchField(
  { value, onValueChange, busy, size = 'md', className, placeholder = 'Search chats', ...props },
  ref,
) {
  const sm = size === 'sm'
  return (
    <label className={cn('relative flex min-w-0 flex-1 items-center', className)}>
      <Search
        size={sm ? 15 : 17}
        strokeWidth={2}
        aria-hidden
        // In the sidebar the magnifier's ink lands on the 24px content line.
        className={cn('pointer-events-none absolute text-ink-3', sm ? 'left-3.5' : 'left-3')}
      />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className={cn(
          'w-full rounded-xl bg-fill-2 text-ink outline-none placeholder:text-ink-3',
          'ring-1 ring-transparent ring-inset transition-[background-color,box-shadow] duration-200 focus:ring-line-strong',
          '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
          // 16px keeps iOS from zooming; the sidebar's mouse-first field can be smaller.
          sm ? 'h-9 pr-8 pl-9 text-body pointer-fine:text-subhead' : 'h-10 pr-9 pl-9.5 text-body',
        )}
        {...props}
      />
      <span className={cn('absolute grid place-items-center', sm ? 'right-1' : 'right-1.5')}>
        {busy ? (
          <span className="grid size-7 animate-fade place-items-center text-ink-3">
            <Spinner size={14} />
          </span>
        ) : value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onValueChange('')}
            // Keep focus in the field.
            onPointerDown={(e) => e.preventDefault()}
            // 28px to look at, 44px to hit.
            className="pressable relative grid size-7 animate-fade place-items-center rounded-full text-ink-3 before:absolute before:-inset-2 before:content-[''] hover:text-ink-2"
          >
            <span className="grid size-4.5 place-items-center rounded-full bg-ink-3 text-bg">
              <X size={11} strokeWidth={3} />
            </span>
          </button>
        ) : null}
      </span>
    </label>
  )
})
