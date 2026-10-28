import {
  forwardRef,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './button'

const base =
  'w-full rounded-xl bg-fill-1 px-4 text-body text-ink placeholder:text-ink-3 outline-none ring-1 ring-transparent ring-inset transition-[background-color,box-shadow] duration-200 focus:bg-fill-2 focus:ring-line-strong'

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextField(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(base, 'h-12', className)} {...props} />
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(base, 'min-h-28 resize-none py-3 leading-6', className)} {...props} />
})

/**
 * A password or key field you can peek at: easier to get right on a phone
 * keyboard. It's never this site's own password, so browsers and password
 * managers aren't invited to save it for Murmur.
 */
export const SecretField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function SecretField(
  { className, disabled, ...props },
  ref,
) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <TextField
        ref={ref}
        {...props}
        disabled={disabled}
        type={shown ? 'text' : 'password'}
        className={cn('pr-12', className)}
        autoComplete="new-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
      />
      <span className="absolute inset-y-0 right-1.5 flex items-center">
        <IconButton label={shown ? 'Hide' : 'Show'} size="sm" disabled={disabled} onClick={() => setShown((s) => !s)}>
          {shown ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
        </IconButton>
      </span>
    </div>
  )
})

const ENTRY = 'input:not([type=hidden],[type=checkbox],[type=radio],[type=button],[type=submit]), textarea, select'

/** The one text field a Label heads: the element right after it, or the only
    field inside that element. None, or several, and the Label stays a heading. */
function headedField(label: HTMLElement) {
  const next = label.nextElementSibling
  if (!next) return null
  if (next.matches(ENTRY)) return next as HTMLElement
  const inside = next.querySelectorAll<HTMLElement>(ENTRY)
  return inside.length === 1 ? inside[0] : null
}

/** A field's heading. Inset 16px like ListGroup's titles, so every section
    label sits on the text column of the box beneath it.

    It's a real <label>: pass `htmlFor`, or leave it out and it finds the
    field placed right after it (directly, or as the only field in the next
    element), so tapping the heading focuses the field and a screen reader
    names the field by the heading, not by its placeholder. A field that
    already has its own name (aria-label, aria-labelledby) keeps it. */
export function Label({ children, hint, htmlFor }: { children: React.ReactNode; hint?: React.ReactNode; htmlFor?: string }) {
  const ref = useRef<HTMLLabelElement>(null)
  const id = useId()
  const textId = `${id}-text`
  const fieldId = `${id}-field`

  // Every commit: the field beside it can change (a step swaps its contents).
  useLayoutEffect(() => {
    const label = ref.current
    if (!label || htmlFor) return
    const field = headedField(label)
    if (!field) return void label.removeAttribute('for')
    if (!field.id) field.id = fieldId
    label.htmlFor = field.id
    const named = field.hasAttribute('aria-label') || (field.getAttribute('aria-labelledby') ?? textId) !== textId
    if (!named) field.setAttribute('aria-labelledby', textId)
  })

  return (
    <label ref={ref} htmlFor={htmlFor} className="mb-2 flex items-baseline justify-between gap-3 px-4">
      <span id={textId} className="text-footnote font-medium text-ink-2">
        {children}
      </span>
      {hint && <span className="text-caption text-ink-3">{hint}</span>}
    </label>
  )
}
