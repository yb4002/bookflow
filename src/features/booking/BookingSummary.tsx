import { CalendarDays, Clock, Scissors, Store, User } from 'lucide-react'
import type { Service } from '@/domain/types'
import { useI18n } from '@/i18n'

interface Props {
  service?: Service
  start?: Date
  end?: Date
  staffName?: string
  /** Shown as a first row on the manage page. */
  businessName?: string
  /** Overrides the total (a booked appointment keeps its booked price even if the service price changes). */
  price?: number
  /** Extra line under the date, e.g. "Previously Mon 5 · 3:30 PM". */
  dateNote?: string
  onChangeService?: () => void
  onChangeTime?: () => void
}

/** Running summary of the appointment being booked. */
export function BookingSummary({ service, start, end, staffName, businessName, price, dateNote, onChangeService, onChangeTime }: Props) {
  const { t, f, fmt } = useI18n()
  const s = t.booking.summary
  const ChangeLink = ({ onClick }: { onClick?: () => void }) =>
    onClick ? <button type="button" onClick={onClick} className="text-xs font-semibold text-brand-600 hover:text-brand-700">{t.booking.change}</button> : null

  return (
    <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200/70">
      <h2 className="text-sm font-semibold text-slate-900">{s.title}</h2>
      {!service ? (
        <p className="mt-3 text-sm text-slate-500">{s.empty}</p>
      ) : (
        <dl className="mt-4 space-y-3 text-sm">
          {businessName && (
            <div className="flex items-center gap-3">
              <Store className="size-4 shrink-0 text-slate-400" />
              <dt className="sr-only">{t.booking.manage.business}</dt>
              <dd dir="auto" className="font-medium text-slate-900 rtl:text-right">{businessName}</dd>
            </div>
          )}
          <div className="flex items-start gap-3">
            <Scissors className="mt-0.5 size-4 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <dd dir="auto" className="font-medium text-slate-900 rtl:text-right">{service.name}</dd>
              <dd className="text-xs text-slate-500">{f.duration(service.durationMin)}</dd>
            </div>
            <ChangeLink onClick={onChangeService} />
          </div>
          {start && end && (
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <dd className="font-medium text-slate-900">{f.dateLong(start)}</dd>
                <dd className="flex items-center gap-1 text-xs text-slate-500"><Clock className="size-3" /> {f.timeRange(start, end)}</dd>
                {dateNote && <dd className="mt-0.5 text-[11px] text-slate-400 line-through decoration-slate-300">{dateNote}</dd>}
              </div>
              <ChangeLink onClick={onChangeTime} />
            </div>
          )}
          {staffName && (
            <div className="flex items-center gap-3">
              <User className="size-4 shrink-0 text-slate-400" />
              <dd className="text-slate-700">{fmt(s.withStaff, { staff: staffName })}</dd>
            </div>
          )}
          <div className="flex items-end justify-between border-t border-slate-100 pt-3">
            <div>
              <dt className="text-xs text-slate-500">{s.total}</dt>
              <dd className="text-[11px] text-slate-400">{s.payAtVenue}</dd>
            </div>
            <dd className="text-lg font-bold text-slate-900 tabular-nums">{f.money(price ?? service.price)}</dd>
          </div>
        </dl>
      )}
    </div>
  )
}
