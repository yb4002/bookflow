import { ArrowDown, ArrowLeft, CalendarClock } from 'lucide-react'
import type { AppointmentView } from '@/domain/types'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/i18n'
import { TimeStep } from '../TimeStep'
import type { useManagedBooking } from './useManagedBooking'

type Managed = ReturnType<typeof useManagedBooking>

/** Pick a new time for the same service and staff member, then confirm "from → to". */
export function RescheduleFlow({ booking, m }: { booking: AppointmentView; m: Managed }) {
  const { t, f, fmt } = useI18n()
  const s = t.booking.manage.rescheduleFlow
  const r = m.reschedule
  const staff = booking.staff.name.split(' ')[0]
  const errorText = m.error === 'slot_taken' ? t.booking.errors.slotTaken : m.error === 'window_closed' ? undefined : m.error ? t.booking.errors.generic : undefined

  return (
    <div>
      <button type="button" onClick={m.back} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t.booking.manage.backToBooking2}
      </button>

      <div className="mb-5 flex gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200/70">
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-brand-600" />
        <div className="min-w-0">
          <p dir="auto" className="font-semibold text-slate-900 rtl:text-right">{booking.service.name}</p>
          <p className="text-xs text-slate-500">{f.duration(booking.service.durationMin)} · {f.money(booking.price)}</p>
          <p className="mt-1 text-xs text-slate-600">{fmt(s.keeps, { staff })}</p>
        </div>
      </div>

      <TimeStep
        title={s.title}
        days={r.days}
        selectedDate={r.date}
        selectedStart={r.slot?.start}
        currentStart={new Date(booking.start)}
        currentLabel={s.current}
        error={errorText}
        onSelectDate={r.setDate}
        onSelectSlot={r.setSlot}
      />

      {/* From → To confirmation */}
      <div className="mt-6 rounded-xl bg-white p-4 ring-1 ring-slate-200/70">
        <div className="grid gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-slate-500">{s.from}</span>
            <span className="text-end text-slate-500 line-through decoration-slate-300">{f.dateMedium(booking.start)} · {f.time(booking.start)}</span>
          </div>
          <ArrowDown className="mx-auto size-4 text-slate-300" />
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-slate-500">{s.to}</span>
            <span className="text-end font-semibold text-slate-900">
              {r.slot ? `${f.dateMedium(r.slot.start)} · ${f.time(r.slot.start)}` : '—'}
            </span>
          </div>
        </div>
        <Button size="lg" className="mt-4 w-full" disabled={!r.slot || m.submitting} onClick={r.confirm}>
          {m.submitting ? s.confirming : s.confirm}
        </Button>
        {!r.slot && <p className="mt-2 text-center text-xs text-slate-400">{s.pick}</p>}
      </div>
    </div>
  )
}
