import { Link } from 'react-router-dom'
import { CalendarDays, Zap } from 'lucide-react'
import { useAppointmentForm } from '@/features/appointments/AppointmentForm'
import type { OpenSlot } from '@/lib/analytics'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button, buttonClass } from '@/components/ui/Button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { staffColor } from '@/lib/staffColors'

/** Surfaces empty time that could be sold, with a one-tap booking for each gap. */
export function OpenSlots({ slots, avgTicketPerHour }: { slots: OpenSlot[]; avgTicketPerHour: number }) {
  const { t, f, fmt, plural } = useI18n()
  const s = t.dashboard.openSlots
  const openBooking = useAppointmentForm()
  const totalMin = slots.reduce((sum, x) => sum + x.minutes, 0)
  const potential = Math.round((totalMin / 60) * avgTicketPerHour)
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-1.5"><Zap className="size-4 text-amber-500" /> {s.title}</span>}
        description={s.subtitle}
      />
      <div className="mx-5 mt-4 rounded-lg bg-gradient-to-r from-brand-50 to-violet-50 p-3.5 ring-1 ring-brand-100">
        <p className="text-xs text-slate-600">{s.potential}</p>
        <p className="text-xl font-bold text-slate-900 tabular-nums">{f.money(potential)}</p>
        <p className="text-xs text-slate-500">
          {plural(s.unbooked, slots.length, { duration: f.duration(totalMin) })}
          {slots.length > 3 ? s.topShown : ''}
        </p>
      </div>
      <ul className="mt-2 space-y-1 px-2">
        {slots.slice(0, 3).map((slot) => (
          <li key={slot.staff.id + slot.start.toISOString()} className="flex items-center gap-3 rounded-lg px-3 py-2">
            <span className={cn('size-2 shrink-0 rounded-full', staffColor[slot.staff.color].dot)} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">
                {f.friendlyDate(slot.start)} · {f.timeRange(slot.start, slot.end)}
              </p>
              <p className="text-xs text-slate-500">{fmt(s.free, { staff: slot.staff.name.split(' ')[0], duration: f.duration(slot.minutes) })}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => openBooking({ staffId: slot.staff.id, start: slot.start })}>{s.book}</Button>
          </li>
        ))}
      </ul>
      <div className="p-5 pt-3">
        <Link to="/app/calendar" className={buttonClass('secondary', 'md', 'w-full')}>
          <CalendarDays className="size-4 text-brand-600" /> {s.viewCalendar}
        </Link>
      </div>
    </Card>
  )
}
