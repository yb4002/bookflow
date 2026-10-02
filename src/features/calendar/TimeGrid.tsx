import { useEffect, useRef, useState } from 'react'
import { differenceInMinutes } from 'date-fns'
import { atWallTime, isSameZonedDay, minutesIntoZonedDay } from '@/domain/time'
import type { AppointmentView } from '@/domain/types'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { fullName } from '@/lib/format'
import { staffColor } from '@/lib/staffColors'
import { layoutEvents } from './layout'

export interface GridColumn {
  key: string
  date: Date
  title: string
  subtitle?: string
  highlight?: boolean
  closed?: boolean
  events: AppointmentView[]
}

const START_HOUR = 8
const END_HOUR = 21
const HOUR_PX = 64
const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

export function TimeGrid({ columns, onSelect }: { columns: GridColumn[]; onSelect: (a: AppointmentView) => void }) {
  const { f, zone } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Scroll so "now" (or 9am) is visible on first render.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const h = Math.max(START_HOUR, Math.min(END_HOUR - 3, Math.floor(minutesIntoZonedDay(new Date(), zone) / 60) - 1))
    el.scrollTop = (h - START_HOUR) * HOUR_PX
  }, [])

  const minWidth = columns.length * 120 + 56
  // Positions are wall-clock minutes in the business's time zone.
  const topFor = (d: Date | string) => ((minutesIntoZonedDay(d, zone) - START_HOUR * 60) / 60) * HOUR_PX
  const nowTop = topFor(now)
  const nowMinutes = minutesIntoZonedDay(now, zone)
  const showNow = nowMinutes >= START_HOUR * 60 && nowMinutes < END_HOUR * 60

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>
        {/* Column headers */}
        <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-white">
          <div className="w-14 shrink-0" />
          {columns.map((c) => (
            <div key={c.key} className="flex-1 border-s border-slate-100 px-2 py-2.5 text-center">
              <p className={cn('text-xs font-medium', c.highlight ? 'text-brand-600' : 'text-slate-500')}>{c.subtitle}</p>
              <p className={cn('mt-0.5 text-sm font-semibold', c.highlight ? 'text-brand-700' : 'text-slate-900')}>
                {c.highlight && c.title.length <= 2 ? (
                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-brand-600 text-white">{c.title}</span>
                ) : c.title}
              </p>
            </div>
          ))}
        </div>

        <div ref={scrollRef} className="relative max-h-[calc(100dvh-300px)] min-h-[420px] overflow-y-auto">
          <div className="relative flex" style={{ height: hours.length * HOUR_PX }}>
            {/* Hour labels */}
            <div className="w-14 shrink-0">
              {hours.map((h) => (
                <div key={h} className="relative" style={{ height: HOUR_PX }}>
                  <span className="absolute end-2 -top-2 text-[10px] font-medium whitespace-nowrap text-slate-400 tabular-nums">
                    {h === START_HOUR ? '' : f.shortTime(atWallTime(now, `${String(h).padStart(2, '0')}:00`, zone))}
                  </span>
                </div>
              ))}
            </div>

            {columns.map((c) => (
              <div key={c.key} className={cn('relative flex-1 border-s border-slate-100', c.closed && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(241_245_249)_6px,rgb(241_245_249)_7px)]')}>
                {hours.map((h) => (
                  <div key={h} className="border-t border-slate-100" style={{ height: HOUR_PX }}>
                    <div className="h-1/2 border-b border-dashed border-slate-100/70" />
                  </div>
                ))}
                {layoutEvents(c.events).map(({ appt, lane, lanes }) => {
                  const s = new Date(appt.start)
                  const top = topFor(s)
                  const height = Math.max(22, (differenceInMinutes(new Date(appt.end), s) / 60) * HOUR_PX - 2)
                  const muted = appt.status === 'cancelled' || appt.status === 'no_show'
                  const compact = height < 40
                  const narrow = lanes >= 3
                  return (
                    <button
                      key={appt.id}
                      onClick={() => onSelect(appt)}
                      className={cn(
                        'absolute overflow-hidden rounded-md border-s-[3px] py-1', narrow ? 'px-1' : 'px-1.5', 'text-start transition-colors',
                        staffColor[appt.staff.color].event,
                        muted && 'opacity-50 line-through decoration-slate-400',
                        appt.status === 'pending' && 'border-dashed',
                      )}
                      style={{ top: top + 1, height, insetInlineStart: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                      title={`${fullName(appt.customer)} · ${appt.service.name}`}
                    >
                      <p dir="auto" className="truncate text-[11px] leading-tight font-semibold rtl:text-right">{narrow ? appt.customer.firstName : compact ? `${f.shortTime(appt.start)} ${appt.customer.firstName}` : fullName(appt.customer)}</p>
                      {!compact && !narrow && <p dir="auto" className="truncate text-[10px] leading-tight opacity-75 rtl:text-right">{f.shortTime(appt.start)} · {appt.service.name}</p>}
                    </button>
                  )
                })}
                {showNow && isSameZonedDay(c.date, now, zone) && (
                  <div className="pointer-events-none absolute inset-x-0 z-[5]" style={{ top: nowTop }}>
                    <div className="relative h-0.5 bg-rose-500"><span className="absolute -start-1 -top-1 size-2.5 rounded-full bg-rose-500" /></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
