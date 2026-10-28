import { forwardRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { CODE_LENGTH, CODE_SHAPES, codeChars, codeGroups, type KnownProvider } from './email-form'

// An app password field drawn the way the provider shows the password:
// sixteen characters in four boxes, so the shape itself says what goes here.
// One real text field lies over the boxes (paste, typing, autofill and screen
// readers all go to it); the boxes only show what's in it, with a caret in
// the box the next character lands in. Something that doesn't fit the shape
// (a long password pasted by mistake) shows whole, in one box.

type Props = {
  provider: KnownProvider
  value: string
  onChange: (value: string) => void
  label: string
  invalid?: boolean
  disabled?: boolean
  describedBy?: string
  autoFocus?: boolean
}

export const CodeField = forwardRef<HTMLInputElement, Props>(function CodeField(
  { provider, value, onChange, label, invalid, disabled, describedBy, autoFocus },
  ref,
) {
  const [focused, setFocused] = useState(false)
  const chars = codeChars(value)
  const groups = codeGroups(value)
  const overflow = chars.length > CODE_LENGTH
  // The box the next character goes in (none once all sixteen are there).
  const at = chars.length < CODE_LENGTH ? Math.floor(chars.length / 4) : -1
  const join = CODE_SHAPES[provider].join

  // The caret always sits at the end: the boxes can't show one anywhere else.
  const toEnd = (el: HTMLInputElement) => {
    const end = el.value.length
    if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end)
  }

  return (
    <div className={cn('relative', disabled && 'opacity-60')}>
      <div aria-hidden className="flex items-center">
        {overflow ? (
          <Box state={invalid ? 'invalid' : focused ? 'active' : 'full'} wide>
            <span className="min-w-0 truncate px-4">{chars}</span>
          </Box>
        ) : (
          groups.map((group, i) => (
            <span key={i} className="contents">
              {i > 0 && <Gap join={join} />}
              <Box state={invalid ? 'invalid' : focused && i === at ? 'active' : group.length === 4 ? 'full' : 'empty'}>
                <span>{group}</span>
                {focused && i === at && <Caret />}
                <span className="text-ink-3">{'·'.repeat(4 - group.length)}</span>
              </Box>
            </span>
          ))
        )}
      </div>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          setFocused(true)
          toEnd(e.currentTarget)
        }}
        onBlur={() => setFocused(false)}
        onSelect={(e) => toEnd(e.currentTarget)}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        data-1p-ignore
        data-lpignore="true"
        // Invisible but real: 16px so iOS doesn't zoom in on it.
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-body text-transparent caret-transparent opacity-0 outline-none"
      />
    </div>
  )
})

function Box({ state, wide, children }: { state: 'empty' | 'active' | 'full' | 'invalid'; wide?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'flex h-12 min-w-0 flex-1 items-center justify-center rounded-xl font-mono text-body tracking-[0.06em] text-ink',
        'ring-inset transition-[background-color,box-shadow] duration-200',
        state === 'full' && 'bg-fill-1',
        state === 'empty' && 'bg-fill-1 ring-1 ring-line-strong',
        state === 'active' && 'bg-fill-2 ring-1 ring-line-strong',
        state === 'invalid' && 'bg-fill-1 ring-1 ring-danger',
        wide && 'justify-start',
      )}
    >
      {children}
    </span>
  )
}

/** What goes between the groups: a space, or Apple's dash. */
const Gap = ({ join }: { join: ' ' | '-' }) => (
  <span className="flex w-2 flex-none justify-center">
    {join === '-' && <span className="h-[1.5px] w-1.5 rounded-full bg-ink-3" />}
  </span>
)

/** Where the next character lands, blinking (steady under reduced motion). */
const Caret = () => (
  <span className="relative inline-block h-5 w-0 align-middle">
    <span className="code-caret absolute top-0 -left-px h-5 w-[2px] rounded-full bg-accent" />
  </span>
)
