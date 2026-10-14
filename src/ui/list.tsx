import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

// Grouped inset lists, the way Settings does it. Separators are inset to
// where the text starts (past the icon, when a row has one), so the left
// edge reads as one clean column and icons sit in their own gutter. Titles and
// footers sit 16px in, on the rows' text column; field Labels match.

export function ListGroup({
  title,
  footer,
  children,
  className,
}: {
  title?: string
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-2', className)}>
      {title && <h3 className="px-4 text-footnote font-medium text-ink-2">{title}</h3>}
      <div className="list-group overflow-hidden rounded-xl bg-fill-1">{children}</div>
      {footer && <p className="px-4 text-footnote text-ink-3">{footer}</p>}
    </section>
  )
}

type RowProps = {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  detail?: ReactNode
  onClick?: () => void
  chevron?: boolean
  destructive?: boolean
  trailing?: ReactNode
}

export function ListRow({ icon, title, subtitle, detail, onClick, chevron, destructive, trailing }: RowProps) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={typeof title === 'string' ? title : undefined}
      data-has-icon={icon ? '' : undefined}
      className={cn(
        'flex min-h-13 w-full items-center gap-3 px-4 py-2.5 text-left',
        // The group clips its corners, so the focus ring sits inside the row.
        onClick && 'transition-colors select-none hover:bg-fill-1 focus-visible:-outline-offset-2 active:bg-fill-2',
      )}
    >
      {icon && <span className="flex size-7 flex-none items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-body', destructive && 'text-danger')}>{title}</span>
        {subtitle && <span className="block truncate text-footnote text-ink-2">{subtitle}</span>}
      </span>
      {detail && <span className="flex-none text-subhead text-ink-2">{detail}</span>}
      {trailing}
      {/* The glyph sits inside its box; nudge it so its stroke, not its box, meets the edge. */}
      {chevron && <ChevronRight size={18} className="-mr-1.5 flex-none text-ink-3" />}
    </Comp>
  )
}
