import { useEffect, useMemo, useRef, useState } from 'react'
import { isSameZonedDay } from '@/domain/time'
import { AlertTriangle, CalendarX } from 'lucide-react'
import type { DayAvailability, TimeSlot } from '@/domain/availability'
import { Skeleton } from '@/components/ui/Skeleton'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { dayPeriod } from '@/features/smartFill/matching'

interface Props {
  days: DayAvailability[] | undefined
  selectedDate?: Date
  selectedStart?: Date
  /** When rescheduling: the booking's current time, shown as "Current" and not selectable. */
  currentStart?: Date
  /** Override the section heading. */
  title?: string
  error?: string
  onSelectDate: (d: Date) => void
  onSelectSlot: (slot: TimeSlot) => void
  /** Label for the current-time chip (e.g. "Current"). */
  currentLabel?: string
}

export function TimeStep({ days, selectedDate, selectedStart, currentStart, currentLabel, title, error, onSelectDate, onSelectSlot }: Props) {
  const { t, f, fmt, zone } = useI18n()
  const s = t.booking.time
  const stripRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)

  const day = days?.find((d) => selectedDate && isSameZonedDay(d.date, selectedDate, zone))
  const groups = useMemo(() => {
    const g: Record<'morning' | 'afternoon' | 'evening', TimeSlot[]> = { morning: [], afternoon: [], evening: [] }
    for (const slot of day?.slots ?? []) g[dayPeriod(slot.start, zone)].push(slot)
    return g
  }, [day])
  const anyAvailable = day?.slots.some((x) => x.available)

  // Keep the selected date chip visible in the strip (first render only).
  useEffect(() => {
    if (scrolled || !days || !selectedDate) return
    stripRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
    setScrolled(true)
  }, [days, selectedDate, scrolled])

  return (
    <section aria-labelledby="step-time">
      <h2 id="step-time" className="text-lg font-semibold text-slate-900">{title ?? s.title}</h2>

      {error && (
        <div role="alert" className="mt-3 flex gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      {!days ? (
        <div className="mt-4 space-y-3" aria-busy="true" aria-label={s.loading}>
          <Skeleton className="h-20" />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm font-semibold text-slate-700">{selectedDate ? f.monthYear(selectedDate) : f.monthYear(days[0].date)}</p>
          <div ref={stripRef} className="scrollbar-none -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {days.map((d) => {
              const free = d.slots.filter((x) => x.available).length
              const disabled = !d.open || free === 0
              const active = !!selectedDate && isSameZonedDay(d.date, selectedDate, zone)
              return (
                <button
                  key={d.date.toISOString()}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => onSelectDate(d.date)}
                  className={cn(
                    'flex w-16 shrink-0 flex-col items-center rounded-xl py-2.5 ring-1 transition',
                    active ? 'bg-brand-600 text-white ring-brand-600 shadow-sm' : disabled ? 'bg-slate-50 text-slate-300 ring-slate-100' : 'bg-white text-slate-700 ring-slate-200 hover:ring-brand-300',
                  )}
                >
                  <span className="text-[11px] font-medium opacity-80">{f.weekdayShort(d.date)}</span>
                  <span className="text-lg leading-tight font-bold tabular-nums">{f.day(d.date)}</span>
                  <span className={cn('mt-0.5 text-[10px] font-medium', active ? 'text-brand-100' : disabled ? 'text-slate-300' : 'text-emerald-600')}>
                    {!d.open ? s.closed : free === 0 ? s.full : f.number(free)}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-6">
            {!anyAvailable ? (
              <div className="flex flex-col items-center rounded-xl bg-white px-6 py-10 text-center ring-1 ring-slate-200/70">
                <CalendarX className="size-6 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">{s.noSlots}</p>
              </div>
            ) : (
              <div className="space-y-5">
                {(['morning', 'afternoon', 'evening'] as const).filter((p) => groups[p].length).map((p) => (
                  <div key={p}>
                    <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{s[p]}</h3>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                      {groups[p].map((slot) => {
                        const label = f.time(slot.start)
                        const active = !!selectedStart && slot.start.getTime() === selectedStart.getTime()
                        const isCurrent = !!currentStart && slot.start.getTime() === currentStart.getTime()
                        if (isCurrent) {
                          return (
                            <span key={slot.start.toISOString()} className="flex h-11 flex-col items-center justify-center rounded-lg bg-amber-50 text-amber-800 ring-1 ring-amber-300" aria-current="true">
                              <span className="text-sm leading-none font-semibold tabular-nums">{label}</span>
                              <span className="mt-0.5 text-[9px] leading-none font-semibold uppercase">{currentLabel}</span>
                            </span>
                          )
                        }
                        return (
                          <button
                            key={slot.start.toISOString()}
                            type="button"
                            data-start={slot.start.toISOString()}
                            disabled={!slot.available}
                            aria-pressed={active}
                            aria-label={slot.available ? label : fmt(s.unavailableAria, { time: label })}
                            onClick={() => onSelectSlot(slot)}
                            className={cn(
                              'h-11 rounded-lg text-sm font-semibold tabular-nums ring-1 transition',
                              active
                                ? 'bg-brand-600 text-white ring-brand-600'
                                : slot.available
                                  ? 'bg-white text-slate-800 ring-slate-200 hover:bg-brand-50 hover:ring-brand-300'
                                  : 'cursor-not-allowed bg-slate-50 text-slate-300 line-through ring-slate-100',
                            )}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-slate-400">{s.bookedHint}</p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
