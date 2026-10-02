import { Link } from 'react-router-dom'
import { CalendarPlus, Check, Settings2 } from 'lucide-react'
import type { AppointmentView } from '@/domain/types'
import { buttonClass, Button } from '@/components/ui/Button'
import { useI18n } from '@/i18n'
import { BookingSummary } from './BookingSummary'
import { buildIcs, downloadIcs } from './ics'
import { managePath } from './paths'

export function ConfirmationView({ booking, slug, businessName, address, onBookAnother }: { booking: AppointmentView; slug: string; businessName: string; address: string; onBookAnother: () => void }) {
  const { t, fmt } = useI18n()
  const c = t.booking.confirmed
  const start = new Date(booking.start)
  const end = new Date(booking.end)

  const addToCalendar = () =>
    downloadIcs(
      `${businessName.replace(/\W+/g, '-').toLowerCase()}-${booking.reference}.ics`,
      buildIcs({
        uid: booking.reference!,
        start,
        end,
        title: fmt(t.booking.calendarEvent, { service: booking.service.name, business: businessName }).replace(/[⁨⁩]/g, ''),
        location: address,
        description: `${t.booking.confirmed.reference}: ${booking.reference}`,
      }),
    )

  return (
    <div className="mx-auto max-w-md text-center">
      <div className="mx-auto flex size-16 animate-fade-in items-center justify-center rounded-full bg-emerald-100 ring-8 ring-emerald-50">
        <Check className="size-8 text-emerald-600" strokeWidth={3} />
      </div>
      <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">{c.title}</h2>
      <p className="mt-2 text-sm text-slate-600">
        {fmt(booking.status === 'pending' ? c.pendingBody : c.body, { name: booking.customer.firstName })}
      </p>

      <div className="mt-6 rounded-2xl bg-slate-900 px-5 py-4 text-white">
        <p className="text-xs text-slate-300">{c.reference}</p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-[0.3em]" dir="ltr">{booking.reference}</p>
      </div>

      <div className="mt-4 text-start">
        <BookingSummary service={booking.service} start={start} end={end} staffName={booking.staff.name.split(' ')[0]} />
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" size="lg" onClick={addToCalendar}><CalendarPlus className="size-4" /> {c.addToCalendar}</Button>
        <Link to={managePath(slug, booking.manageToken!)} className={buttonClass('secondary', 'lg')}><Settings2 className="size-4" /> {c.manage}</Link>
      </div>
      <p className="mt-4 text-xs text-slate-500">{fmt(c.messageNote, { phone: booking.customer.phone })} {c.keepNote}</p>
      <button type="button" onClick={onBookAnother} className="mt-6 text-sm font-semibold text-brand-600 hover:text-brand-700">{c.bookAnother}</button>
    </div>
  )
}
