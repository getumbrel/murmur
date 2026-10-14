import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Segmented } from '@/ui/segmented'
import { cn } from '@/lib/cn'
import { EVERY_DAY, WEEKDAYS, dayPreset, firstDayOfWeek, weekdayName, type Days } from './schedule'

/** Seven round chips, in this region's week order. */
export function DayChips({
  days,
  onChange,
  single,
  className,
}: {
  days: Days
  onChange: (days: Days) => void
  /** Pick exactly one day. */
  single?: boolean
  className?: string
}) {
  const order = useMemo(() => {
    const first = firstDayOfWeek()
    return Array.from({ length: 7 }, (_, i) => (first + i) % 7)
  }, [])
  const toggle = (d: number) => {
    if (single) return onChange([d])
    const on = days.includes(d)
    // Never leave a routine with no days at all.
    if (on && days.length === 1) return
    onChange(on ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b))
  }
  return (
    <div className={cn('flex justify-between gap-1', className)} role="group" aria-label="Days">
      {order.map((d) => {
        const on = days.includes(d)
        return (
          <button
            key={d}
            type="button"
            role={single ? 'radio' : 'checkbox'}
            aria-checked={on}
            aria-label={weekdayName(d, 'long')}
            onClick={() => toggle(d)}
            className={cn(
              'pressable touch-target relative flex size-10 items-center justify-center rounded-full text-footnote font-semibold transition-colors duration-200',
              on ? 'bg-accent text-accent-ink' : 'bg-fill-2 text-ink-2 hover:bg-fill-3',
            )}
          >
            {weekdayName(d, 'narrow')}
          </button>
        )
      })}
    </div>
  )
}

type Mode = 'everyday' | 'weekdays' | 'custom'

/** Every day / Weekdays / Custom days, with the chips appearing for Custom. */
export function RepeatPicker({ days, onChange }: { days: Days; onChange: (days: Days) => void }) {
  const reduce = useReducedMotion()
  const preset = dayPreset(days)
  const [custom, setCustom] = useState(preset !== 'everyday' && preset !== 'weekdays')
  const mode: Mode = custom ? 'custom' : preset === 'weekdays' ? 'weekdays' : 'everyday'

  return (
    <div>
      <Segmented<Mode>
        label="Repeat"
        value={mode}
        onChange={(m) => {
          setCustom(m === 'custom')
          if (m === 'everyday') onChange(EVERY_DAY)
          else if (m === 'weekdays') onChange(WEEKDAYS)
        }}
        options={[
          { value: 'everyday', label: 'Every day' },
          { value: 'weekdays', label: 'Weekdays' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      <AnimatePresence initial={false}>
        {custom && (
          <motion.div
            key="chips"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              reduce
                ? { duration: 0.12 }
                : { height: { type: 'spring', duration: 0.35, bounce: 0 }, opacity: { duration: 0.2 } }
            }
            className="overflow-hidden"
          >
            <DayChips days={days} onChange={onChange} className="px-1 pt-3" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
