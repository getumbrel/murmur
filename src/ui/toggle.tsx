import { cn } from '@/lib/cn'

// The iOS switch: 51×31 with a 27px knob that stretches toward its travel
// while pressed and settles with a spring when let go.
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'group relative h-[31px] w-[51px] flex-none rounded-full p-[2px] transition-colors duration-250 ease-out',
        checked ? 'bg-success' : 'bg-fill-3',
      )}
    >
      <span
        className={cn(
          'block h-[27px] w-[27px] rounded-full bg-white',
          'shadow-[0_3px_8px_rgb(0_0_0/0.15),0_1px_1px_rgb(0_0_0/0.06),0_0_0_0.5px_rgb(0_0_0/0.04)]',
          'transition-[width,translate] duration-500 ease-spring-soft group-active:w-[33px] group-active:duration-200',
          checked && 'translate-x-5 group-active:translate-x-[14px]',
        )}
      />
    </button>
  )
}
