import { Copy } from 'lucide-react'
import type { WeeklyHours, Weekday } from '@/domain/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Switch } from '@/components/ui/Switch'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'

/** Weekly open/close editor (business opening hours, or one person's working hours). Controlled. */
export function HoursEditor({ value, onChange, idPrefix = '' }: { value: WeeklyHours; onChange: (v: WeeklyHours) => void; idPrefix?: string }) {
  const { t, f, fmt, config } = useI18n()
  const s = t.services.hours
  const update = (d: Weekday, patch: Partial<WeeklyHours[Weekday]>) => onChange({ ...value, [d]: { ...value[d], ...patch } })
  // Week order follows the locale (Monday-first in English, Sunday-first in Hebrew).
  const days = Array.from({ length: 7 }, (_, i) => ((config.weekStartsOn + i) % 7) as Weekday)
  const dayName = (d: Weekday) => f.weekdayName(d)

  return (
    <ul className="divide-y divide-slate-100">
      {days.map((d) => {
        const label = dayName(d)
        return (
          <li key={d} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3" data-weekday={d}>
            <div className="flex w-36 items-center gap-3">
              <Switch checked={value[d].open} onChange={(v) => update(d, { open: v })} label={`${idPrefix}${fmt(s.openAria, { day: label })}`} />
              <span className={cn('text-sm font-medium', value[d].open ? 'text-slate-900' : 'text-slate-400')}>{label}</span>
            </div>
            {value[d].open ? (
              <div className="flex items-center gap-2">
                <Input type="time" value={value[d].start} onChange={(e) => update(d, { start: e.target.value })} className="h-9 w-32" aria-label={`${idPrefix}${fmt(s.opensAria, { day: label })}`} />
                <span className="text-sm text-slate-400">{s.to}</span>
                <Input type="time" value={value[d].end} onChange={(e) => update(d, { end: e.target.value })} className="h-9 w-32" aria-label={`${idPrefix}${fmt(s.closesAria, { day: label })}`} />
              </div>
            ) : (
              <span className="text-sm text-slate-400">{s.closed}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** "Apply Monday's hours to all open days" helper, shown next to the editor. */
export function ApplyMondayButton({ value, onChange }: { value: WeeklyHours; onChange: (v: WeeklyHours) => void }) {
  const { t, f, fmt } = useI18n()
  const mon = value[1]
  const apply = () => onChange(Object.fromEntries(([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((d) => [d, value[d].open ? { ...value[d], start: mon.start, end: mon.end } : value[d]])) as WeeklyHours)
  return (
    <Button size="sm" variant="ghost" onClick={apply}>
      <Copy className="size-3.5" /> {fmt(t.services.hours.applyToOpen, { day: f.weekdayName(1) })}
    </Button>
  )
}
