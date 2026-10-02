import { Link, useParams } from 'react-router-dom'
import { CalendarClock, CalendarX2, CheckCircle2, Info, SearchX, X } from 'lucide-react'
import { Button, buttonClass } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useDocumentTitle, useI18n } from '@/i18n'
import { interpolate } from '@/i18n/plural'
import { BookingSummary } from './BookingSummary'
import { CancelFlow } from './manage/CancelFlow'
import { RescheduleFlow } from './manage/RescheduleFlow'
import { useManagedBooking } from './manage/useManagedBooking'
import { bookingPath } from './paths'
import { PublicLayout } from './PublicLayout'
import { LoadError } from '@/features/system/LoadError'

export default function ManageBookingPage() {
  const { slug = '', token = '' } = useParams()
  const { t, f, fmt } = useI18n()
  const s = t.booking.manage
  const m = useManagedBooking(slug, token)
  const { profile, booking } = m

  useDocumentTitle(profile ? interpolate(t.booking.docTitle, { business: profile.business.name }) : null)

  if (m.loading) {
    return <PublicLayout><Skeleton className="mx-auto h-72 max-w-md" /></PublicLayout>
  }
  if (m.loadError) {
    return <PublicLayout><LoadError onRetry={m.retry} /></PublicLayout>
  }
  if (!profile || !booking) {
    return (
      <PublicLayout business={profile?.business} demo={profile?.demo} compact>
        <EmptyState
          icon={SearchX}
          title={s.notFoundTitle}
          description={s.notFoundBody}
          action={profile && <Link to={bookingPath(slug)} className={buttonClass('secondary')}>{s.backToBooking}</Link>}
        />
      </PublicLayout>
    )
  }

  const start = new Date(booking.start)
  const end = new Date(booking.end)
  const cancelled = booking.status === 'cancelled'
  const staffName = booking.staff.name.split(' ')[0]
  const windowNote = fmt(s.windowClosed, { hours: m.policyHours, phone: profile.business.phone })

  return (
    <PublicLayout business={profile.business} demo={profile.demo} compact>
      <div className="mx-auto max-w-md">
        {m.mode === 'reschedule' && <RescheduleFlow booking={booking} m={m} />}

        {m.mode === 'cancel' && <CancelFlow booking={booking} m={m} />}

        {m.mode === 'view' && (
          <>
            {cancelled ? (
              <div className="mb-5 text-center" role="status">
                <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-slate-100">
                  <CalendarX2 className="size-7 text-slate-500" />
                </div>
                <h2 className="mt-4 text-xl font-bold text-slate-900">{s.cancelledTitle}</h2>
                <p className="mt-1 text-sm text-slate-500">{s.cancelledBody}</p>
              </div>
            ) : (
              <div className="mb-5 flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-slate-900">{s.title}</h2>
                <StatusBadge status={booking.status} />
              </div>
            )}

            {m.justRescheduled && !cancelled && (
              <p role="status" className="mb-4 flex gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                {fmt(s.rescheduledBanner, { when: `${f.dateLong(start)} · ${f.time(start)}` })}
              </p>
            )}

            <div className="mb-3 flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200/70">
              <span className="text-slate-500">{t.booking.confirmed.reference}</span>
              <span className="font-mono font-bold tracking-widest text-slate-900" dir="ltr">{booking.reference}</span>
            </div>
            <BookingSummary
              businessName={profile.business.name}
              service={booking.service}
              price={booking.price}
              start={start}
              end={end}
              staffName={staffName}
              dateNote={booking.previousStart && !cancelled ? fmt(s.previously, { when: `${f.dateMedium(booking.previousStart)} · ${f.time(booking.previousStart)}` }) : undefined}
            />

            <div className="mt-5 space-y-3">
              {m.isActive && m.isPast && (
                <p className="flex gap-2 rounded-lg bg-slate-100 p-3 text-sm text-slate-600"><Info className="mt-0.5 size-4 shrink-0" /> {s.pastNote}</p>
              )}
              {m.isActive && !m.isPast && (m.insideWindow || m.error === 'window_closed') && (
                <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                  <Info className="mt-0.5 size-4 shrink-0 text-amber-600" /> {windowNote}
                </p>
              )}

              {m.canChange && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button size="lg" onClick={m.startReschedule}><CalendarClock className="size-4" /> {s.reschedule}</Button>
                  <Button variant="danger" size="lg" onClick={m.startCancel}><X className="size-4" /> {s.cancel}</Button>
                </div>
              )}

              <Link to={bookingPath(slug)} className={buttonClass(cancelled ? 'primary' : 'ghost', 'lg', 'w-full')}>
                {cancelled ? s.bookAgain : s.backToBooking}
              </Link>
            </div>
          </>
        )}
      </div>
    </PublicLayout>
  )
}
