import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, PauseCircle, SearchX } from 'lucide-react'
import type { DayAvailability, TimeSlot } from '@/domain/availability'
import type { AppointmentView, Service } from '@/domain/types'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { BookingError, repo } from '@/data/repositories'
import { useQuery } from '@/hooks/useQuery'
import { useDocumentTitle, useI18n } from '@/i18n'
import { interpolate } from '@/i18n/plural'
import { cn } from '@/lib/cn'
import { businessZone, fromLocalDateTime } from '@/domain/time'
import { BookingSummary } from './BookingSummary'
import { LoadError } from '@/features/system/LoadError'
import { ConfirmationView } from './ConfirmationView'
import { DetailsStep, type CustomerDetails } from './DetailsStep'
import { PublicLayout } from './PublicLayout'
import { ServiceStep } from './ServiceStep'
import { StaffPicker } from './StaffPicker'
import { TimeStep } from './TimeStep'

type Step = 'service' | 'time' | 'details' | 'done'
const STEPS: Exclude<Step, 'done'>[] = ['service', 'time', 'details']
/** How many days ahead the date strip offers (capped by the business's booking window). */
const DAYS_SHOWN = 14
const emptyDetails: CustomerDetails = { name: '', phone: '', notes: '', remindersOptIn: true }

export default function BookingPage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const { t, f, locale } = useI18n()
  const b = t.booking
  const profileQ = useQuery(() => repo.getPublicProfile(slug), [slug])
  const profile = profileQ.data

  const [step, setStep] = useState<Step>('service')
  const [service, setService] = useState<Service>()
  /** Preferred staff member; undefined = any available. */
  const [staffId, setStaffId] = useState<string>()
  const [days, setDays] = useState<DayAvailability[]>()
  const [date, setDate] = useState<Date>()
  const [slot, setSlot] = useState<TimeSlot>()
  const [details, setDetails] = useState<CustomerDetails>(emptyDetails)
  const [refresh, setRefresh] = useState(0)
  const [timeError, setTimeError] = useState<string>()
  const [submitError, setSubmitError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [booking, setBooking] = useState<AppointmentView>()
  const topRef = useRef<HTMLDivElement>(null)

  useDocumentTitle(profile ? interpolate(b.docTitle, { business: profile.business.name }) : null)

  // Deep link: /book/<slug>?service=svc_1[&staff=stf_1][&date=YYYY-MM-DD] opens straight on the
  // date step — with that team member and day preselected (Smart Fill offers link here).
  useEffect(() => {
    const preset = profile?.services.find((s) => s.id === params.get('service'))
    if (preset && !service) {
      setService(preset)
      const staff = params.get('staff')
      if (staff && profile!.staff.some((m) => m.id === staff && m.serviceIds.includes(preset.id))) setStaffId(staff)
      const date = params.get('date')
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setDate(fromLocalDateTime(date, '00:00', businessZone(profile!.business)))
      setStep('time')
    }
  }, [profile, params, service])

  // Load availability for the chosen service. A refresh (e.g. after a slot was taken) keeps the
  // customer's day; choosing a different service clears the date, so it starts on the first free day.
  useEffect(() => {
    if (!service) return
    let cancelled = false
    setDays(undefined)
    repo.getAvailability(slug, service.id, new Date(), DAYS_SHOWN, staffId).then((result) => {
      if (cancelled) return
      setDays(result)
      setDate((current) => {
        // Keep the customer's chosen day even if it just filled up (it then shows as full) — never jump silently.
        if (current && result.some((d) => d.date.getTime() === current.getTime())) return current
        return result.find((d) => d.slots.some((s) => s.available))?.date
      })
    })
    return () => {
      cancelled = true
    }
  }, [slug, service, staffId, refresh])

  const go = useCallback((next: Step) => {
    setStep(next)
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  const staffName = slot && profile?.staff.find((s) => s.id === slot.freeStaffIds[0])?.name.split(' ')[0]

  const confirm = async () => {
    if (!service || !slot) return
    setSubmitting(true)
    setSubmitError(undefined)
    try {
      const result = await repo.createBooking(slug, {
        serviceId: service.id,
        start: slot.start.toISOString(),
        staffId,
        name: details.name,
        phone: details.phone,
        notes: details.notes,
        remindersOptIn: details.remindersOptIn,
        // Confirmations and reminders are sent in the language the client booked in.
        locale,
      })
      setBooking(result)
      go('done')
    } catch (e) {
      if (e instanceof BookingError && e.code === 'slot_unavailable') {
        // Someone else took it: refresh availability and send the customer back to pick again.
        setSlot(undefined)
        setTimeError(b.errors.slotTaken)
        setRefresh((n) => n + 1)
        go('time')
      } else {
        setSubmitError(e instanceof BookingError && e.code === 'not_published' ? b.errors.notPublished : e instanceof BookingError && e.code === 'booking_paused' ? b.paused.body : b.errors.generic)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setService(undefined)
    setSlot(undefined)
    setDetails((d) => ({ ...emptyDetails, name: d.name, phone: d.phone }))
    setBooking(undefined)
    setTimeError(undefined)
    setRefresh((n) => n + 1)
    go('service')
  }

  if (profileQ.loading && !profile) {
    return (
      <PublicLayout>
        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      </PublicLayout>
    )
  }
  if (!profile && profileQ.error) {
    return (
      <PublicLayout>
        <LoadError onRetry={profileQ.refetch} />
      </PublicLayout>
    )
  }
  if (!profile) {
    return (
      <PublicLayout>
        <EmptyState icon={SearchX} title={b.notFound.title} description={b.notFound.body} />
      </PublicLayout>
    )
  }

  if (profile.bookingPaused) {
    return (
      <PublicLayout business={profile.business} demo={profile.demo}>
        <EmptyState icon={PauseCircle} title={b.paused.title} description={b.paused.body} />
      </PublicLayout>
    )
  }

  const stepIndex = STEPS.indexOf(step as Exclude<Step, 'done'>)

  return (
    <PublicLayout business={profile.business} demo={profile.demo} compact={step === 'done'}>
      <div ref={topRef} className="scroll-mt-4" />
      {step === 'done' && booking ? (
        <ConfirmationView booking={booking} slug={slug} businessName={profile.business.name} address={profile.business.address} onBookAnother={reset} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {/* Progress */}
            <div className="mb-5">
              <div className="flex items-center justify-between gap-3">
                {stepIndex > 0 ? (
                  <button type="button" onClick={() => go(STEPS[stepIndex - 1])} className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
                    <ArrowLeft className="size-4 rtl:-scale-x-100" /> {b.back}
                  </button>
                ) : <span />}
                <p className="text-xs font-medium text-slate-500">
                  {interpolate(b.stepOf, { current: f.number(stepIndex + 1), total: f.number(STEPS.length) })} · {b.steps[STEPS[stepIndex]]}
                </p>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden>
                {STEPS.map((s, i) => <div key={s} className={cn('h-1 rounded-full', i <= stepIndex ? 'bg-brand-600' : 'bg-slate-200')} />)}
              </div>
            </div>

            {step === 'service' && (
              <ServiceStep
                services={profile.services}
                selectedId={service?.id}
                onSelect={(s) => {
                  if (s.id !== service?.id) {
                    setService(s)
                    setSlot(undefined)
                    setDate(undefined)
                    setStaffId(undefined)
                  }
                  setTimeError(undefined)
                  go('time')
                }}
              />
            )}

            {step === 'time' && service && (
              <>
                {/* Compact context on mobile (desktop has the sidebar). */}
                <div className="mb-5 flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200/70 lg:hidden">
                  <div className="min-w-0">
                    <p dir="auto" className="truncate text-sm font-semibold text-slate-900 rtl:text-right">{service.name}</p>
                    <p className="text-xs text-slate-500">{f.duration(service.durationMin)} · {f.money(service.price)}</p>
                  </div>
                  <button type="button" onClick={() => go('service')} className="shrink-0 text-xs font-semibold text-brand-600">{b.change}</button>
                </div>
                <StaffPicker
                  staff={profile.staff.filter((m) => m.serviceIds.includes(service.id))}
                  value={staffId}
                  onChange={(id) => {
                    setStaffId(id)
                    setSlot(undefined)
                    // A different stylist has different free days: start on their first free day.
                    setDate(undefined)
                  }}
                />
                <TimeStep
                  days={days}
                  selectedDate={date}
                  selectedStart={slot?.start}
                  error={timeError}
                  onSelectDate={(d) => {
                    setDate(d)
                    setSlot(undefined)
                  }}
                  onSelectSlot={(s) => {
                    setSlot(s)
                    setTimeError(undefined)
                    go('details')
                  }}
                />
              </>
            )}

            {step === 'details' && service && slot && (
              <>
                <div className="mb-5 lg:hidden">
                  <BookingSummary service={service} start={slot.start} end={slot.end} staffName={staffName} onChangeService={() => go('service')} onChangeTime={() => go('time')} />
                </div>
                <DetailsStep
                  value={details}
                  onChange={setDetails}
                  cancellationHours={profile.business.policies.cancellationWindowHours}
                  submitting={submitting}
                  error={submitError}
                  onSubmit={confirm}
                />
              </>
            )}
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-6">
              <BookingSummary
                service={service}
                start={slot?.start}
                end={slot?.end}
                staffName={staffName}
                onChangeService={service && step !== 'service' ? () => go('service') : undefined}
                onChangeTime={slot && step === 'details' ? () => go('time') : undefined}
              />
            </div>
          </aside>
        </div>
      )}
    </PublicLayout>
  )
}
