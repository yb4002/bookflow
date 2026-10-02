import { AlertTriangle, CalendarX2, CircleCheck, RotateCcw } from 'lucide-react'
import type { AppointmentView, CancellationReason } from '@/domain/types'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import type { useManagedBooking } from './useManagedBooking'

type Managed = ReturnType<typeof useManagedBooking>
const REASONS: CancellationReason[] = ['schedule_conflict', 'unwell', 'found_alternative', 'other']

/** Explains the consequences, collects an optional reason, then confirms. */
export function CancelFlow({ booking, m }: { booking: AppointmentView; m: Managed }) {
  const { t, f, fmt } = useI18n()
  const s = t.booking.manage.cancelFlow
  const when = `${f.dateMedium(booking.start)} · ${f.time(booking.start)}`

  return (
    <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-rose-200" role="alertdialog" aria-labelledby="cancel-title" aria-describedby="cancel-what">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-rose-50"><CalendarX2 className="size-5 text-rose-600" /></span>
        <h2 id="cancel-title" className="text-lg font-semibold text-slate-900">{s.title}</h2>
      </div>

      <p className="mt-4 text-xs font-semibold tracking-wide text-slate-500 uppercase">{s.willHappen}</p>
      <ul id="cancel-what" className="mt-2 space-y-2 text-sm text-slate-700">
        <li className="flex gap-2"><RotateCcw className="mt-0.5 size-4 shrink-0 text-slate-400" /> {fmt(s.release, { time: when, staff: booking.staff.name.split(' ')[0] })}</li>
        <li className="flex gap-2"><CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {fmt(s.free, { hours: m.policyHours })}</li>
        <li className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" /> {s.undo}</li>
      </ul>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-slate-700">{s.reasonLabel}</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
          {REASONS.map((r) => {
            const on = m.cancel.reason === r
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => m.cancel.setReason(on ? undefined : r)}
                className={cn('rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition', on ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}
              >
                {t.cancellationReasons[r]}
              </button>
            )
          })}
        </div>
      </fieldset>

      {m.error && m.error !== 'window_closed' && (
        <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">{t.booking.errors.generic}</p>
      )}

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" size="lg" onClick={m.back} disabled={m.submitting}>{s.keep}</Button>
        <Button size="lg" className="bg-rose-600 hover:bg-rose-700 active:bg-rose-800" onClick={m.cancel.confirm} disabled={m.submitting}>
          {m.submitting ? s.cancelling : s.yesCancel}
        </Button>
      </div>
    </div>
  )
}
