import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Users } from 'lucide-react'
import type { DayAvailability } from '@/domain/availability'
import type { BookingSource, CustomerWithStats } from '@/domain/types'
import { fromLocalDateTime, toLocalDateString, toLocalTimeString } from '@/domain/time'
import { Ltr } from '@/components/i18n/Ltr'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Drawer } from '@/components/ui/Drawer'
import { Field, Input, inputClass, SearchInput } from '@/components/ui/Input'
import { Segmented } from '@/components/ui/Segmented'
import { useToast } from '@/components/ui/Toast'
import { repo } from '@/data/repositories'
import type { CustomerInput } from '@/data/repositories/types'
import { useQuery } from '@/hooks/useQuery'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { fullName, initials } from '@/lib/format'
import { useErrorText } from './useErrorText'

/** What a caller can preset when opening the form (a client, a team member, a time). */
export interface AppointmentPrefill {
  customerId?: string
  staffId?: string
  start?: Date
}

const Ctx = createContext<(prefill?: AppointmentPrefill) => void>(() => {})

/** `const openBooking = useAppointmentForm(); openBooking({ customerId })` */
export const useAppointmentForm = () => useContext(Ctx)

/** Mounts the business-side booking form once (inside the app shell). */
export function AppointmentFormProvider({ children }: { children: ReactNode }) {
  const [prefill, setPrefill] = useState<AppointmentPrefill | null>(null)
  const open = useCallback((p: AppointmentPrefill = {}) => setPrefill(p), [])
  return (
    <Ctx.Provider value={open}>
      {children}
      {prefill && <AppointmentForm prefill={prefill} onClose={() => setPrefill(null)} />}
    </Ctx.Provider>
  )
}

const SOURCES: BookingSource[] = ['phone', 'walk_in', 'instagram', 'online']
const blankClient: CustomerInput = { firstName: '', lastName: '', phone: '', email: '', marketingOptIn: false }

function AppointmentForm({ prefill, onClose }: { prefill: AppointmentPrefill; onClose: () => void }) {
  const { t, f, fmt, zone } = useI18n()
  const m = t.manage.form
  const toast = useToast()
  const errorText = useErrorText()
  const meta = useQuery(() => Promise.all([repo.listServices(), repo.listStaff(), repo.listCustomers()]), [])
  const [services, staff, customers] = meta.data ?? []

  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [query, setQuery] = useState('')
  const [customerId, setCustomerId] = useState(prefill.customerId)
  const [client, setClient] = useState<CustomerInput>(blankClient)
  const [serviceId, setServiceId] = useState<string>()
  const [staffId, setStaffId] = useState(prefill.staffId)
  const [date, setDate] = useState(() => toLocalDateString(prefill.start ?? new Date(), zone))
  const [start, setStart] = useState<string | undefined>(prefill.start?.toISOString())
  const [custom, setCustom] = useState(false)
  const [customTime, setCustomTime] = useState(() => (prefill.start ? toLocalTimeString(prefill.start, zone) : '09:00'))
  const [source, setSource] = useState<BookingSource>('phone')
  const [notes, setNotes] = useState('')
  const [notify, setNotify] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  // Defaults once the catalog is loaded: the first service this person performs (or the first service).
  useEffect(() => {
    if (!services || !staff || serviceId) return
    const member = staff.find((s) => s.id === prefill.staffId)
    setServiceId(services.find((s) => (member ? member.serviceIds.includes(s.id) : true))?.id)
  }, [services, staff, serviceId, prefill.staffId])

  const service = services?.find((s) => s.id === serviceId)
  const qualified = useMemo(() => (staff ?? []).filter((s) => serviceId && s.serviceIds.includes(serviceId)), [staff, serviceId])
  useEffect(() => {
    if (qualified.length && !qualified.some((s) => s.id === staffId)) setStaffId(qualified[0].id)
  }, [qualified, staffId])
  const member = qualified.find((s) => s.id === staffId)

  const [day, setDay] = useState<DayAvailability>()
  useEffect(() => {
    if (!serviceId || !staffId || !date) return
    let live = true
    setDay(undefined)
    repo.getStaffAvailability(serviceId, fromLocalDateTime(date, '12:00', zone), 1, { staffId }).then((d) => live && setDay(d[0]), () => live && setDay({ date: new Date(), open: false, slots: [] }))
    return () => {
      live = false
    }
  }, [serviceId, staffId, date, zone])

  const selectedCustomer = customers?.find((c) => c.id === customerId)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    if (!q || !customers) return []
    return customers.filter((c) => fullName(c).toLowerCase().includes(q) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))).slice(0, 6)
  }, [customers, query])

  const startIso = custom ? (date && /^\d{2}:\d{2}$/.test(customTime) ? fromLocalDateTime(date, customTime, zone).toISOString() : undefined) : start
  const clientReady = mode === 'existing' ? !!selectedCustomer : client.firstName.trim() && client.phone.trim()
  const ready = !!(clientReady && service && member && startIso)

  const submit = async () => {
    if (!ready) return
    setSaving(true)
    setError(undefined)
    try {
      await repo.createAppointment({
        ...(mode === 'existing' ? { customerId: selectedCustomer!.id } : { customer: client }),
        serviceId: service!.id,
        staffId: member!.id,
        start: startIso!,
        notes: notes.trim() || undefined,
        source,
        notify,
      })
      toast(m.booked)
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={m.newTitle}
      footer={
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
          <Button className="w-full" size="lg" disabled={!ready || saving} onClick={submit}>{saving ? m.saving : m.save}</Button>
        </div>
      }
    >
      <form className="space-y-6" onSubmit={(e) => (e.preventDefault(), submit())}>
        {/* Client */}
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-slate-900">{m.client}</legend>
          {selectedCustomer ? (
            <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200" data-testid="selected-client">
              <Avatar label={initials(selectedCustomer)} seed={selectedCustomer.id} size="sm" />
              <div className="min-w-0 flex-1">
                <p dir="auto" className="truncate text-sm font-semibold text-slate-900 rtl:text-right">{fullName(selectedCustomer)}</p>
                <p className="text-xs text-slate-500"><Ltr>{selectedCustomer.phone}</Ltr></p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => (setCustomerId(undefined), setQuery(''))}>{m.change}</Button>
            </div>
          ) : (
            <>
              <Segmented
                value={mode}
                onChange={(v) => setMode(v as 'existing' | 'new')}
                options={[{ value: 'existing', label: m.existing }, { value: 'new', label: m.newClient }]}
              />
              {mode === 'existing' ? (
                <div className="mt-3">
                  <SearchInput placeholder={m.searchClient} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={m.searchClient} autoFocus />
                  {query.trim() && (
                    <ul className="mt-2 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                      {matches.length === 0 ? (
                        <li className="flex items-center gap-2 p-3 text-sm text-slate-500"><Users className="size-4" /> {m.noClientMatch}</li>
                      ) : (
                        matches.map((c: CustomerWithStats) => (
                          <li key={c.id}>
                            <button type="button" onClick={() => setCustomerId(c.id)} className="flex w-full items-center gap-3 p-2.5 text-start hover:bg-slate-50">
                              <Avatar label={initials(c)} seed={c.id} size="sm" />
                              <span className="min-w-0 flex-1">
                                <span dir="auto" className="block truncate text-sm font-medium text-slate-900 rtl:text-right">{fullName(c)}</span>
                                <span className="block text-xs text-slate-500"><Ltr>{c.phone}</Ltr></span>
                              </span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label={t.manage.client.firstName}><Input name="firstName" dir="auto" value={client.firstName} onChange={(e) => setClient({ ...client, firstName: e.target.value })} /></Field>
                  <Field label={t.manage.client.lastName}><Input name="lastName" dir="auto" value={client.lastName} onChange={(e) => setClient({ ...client, lastName: e.target.value })} /></Field>
                  <div className="col-span-2"><Field label={t.manage.client.phone}><Input name="phone" type="tel" dir="ltr" className="text-start rtl:text-end" value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} /></Field></div>
                  <div className="col-span-2"><Field label={t.manage.client.email}><Input name="email" type="email" dir="ltr" className="text-start rtl:text-end" value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} /></Field></div>
                  <label className="col-span-2 flex cursor-pointer items-start gap-3 text-sm text-slate-700">
                    <Checkbox checked={client.marketingOptIn} onChange={() => setClient({ ...client, marketingOptIn: !client.marketingOptIn })} label={t.manage.client.marketing} className="mt-0.5" />
                    <span onClick={() => setClient({ ...client, marketingOptIn: !client.marketingOptIn })}>{t.manage.client.marketing}</span>
                  </label>
                </div>
              )}
            </>
          )}
        </fieldset>

        {/* Service & team member */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={m.service}>
            <select name="service" className={inputClass} value={serviceId ?? ''} onChange={(e) => (setServiceId(e.target.value), setStart(undefined))}>
              {(services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {f.duration(s.durationMin)}</option>)}
            </select>
          </Field>
          <Field label={m.staff}>
            <select name="staff" className={inputClass} value={staffId ?? ''} onChange={(e) => (setStaffId(e.target.value), setStart(undefined))}>
              {qualified.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>

        {/* Date & time */}
        <div>
          <Field label={m.date}>
            <Input name="date" type="date" value={date} onChange={(e) => (setDate(e.target.value), setStart(undefined))} />
          </Field>
          <p className="mt-4 mb-2 text-sm font-medium text-slate-700">{m.time}</p>
          {!custom && (
            !day ? (
              <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ) : !day.open ? (
              <p className="text-sm text-slate-500">{m.closed}</p>
            ) : day.slots.some((s) => s.available) ? (
              <div className="grid grid-cols-4 gap-2" data-testid="form-slots">
                {day.slots.filter((s) => s.available).map((s) => (
                  <button
                    key={s.start.toISOString()}
                    type="button"
                    aria-pressed={start === s.start.toISOString()}
                    onClick={() => setStart(s.start.toISOString())}
                    className={cn('h-9 rounded-lg text-sm font-medium tabular-nums ring-1 transition', start === s.start.toISOString() ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200 hover:ring-brand-300')}
                  >
                    {f.clock(s.start)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">{m.noTimes}</p>
            )
          )}
          <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-slate-700">
            <Checkbox checked={custom} onChange={() => setCustom(!custom)} label={m.otherTime} />
            <span onClick={() => setCustom(!custom)}>{m.otherTime}</span>
          </label>
          {custom && (
            <div className="mt-2">
              <Input name="customTime" type="time" step={300} value={customTime} onChange={(e) => setCustomTime(e.target.value)} className="w-36" aria-label={m.otherTime} />
              <p className="mt-1 text-xs text-slate-500">{fmt(m.otherTimeHint, { staff: member?.name.split(' ')[0] ?? '' })}</p>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={m.source}>
            <select name="source" className={inputClass} value={source} onChange={(e) => setSource(e.target.value as BookingSource)}>
              {SOURCES.map((s) => <option key={s} value={s}>{t.sources[s]}</option>)}
            </select>
          </Field>
        </div>
        <Field label={m.notes} hint={m.notesHint}>
          <textarea name="notes" rows={2} dir="auto" value={notes} onChange={(e) => setNotes(e.target.value)} className={cn(inputClass, 'h-auto py-2')} />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
          <Checkbox checked={notify} onChange={() => setNotify(!notify)} label={m.notify} className="mt-0.5" />
          <span onClick={() => setNotify(!notify)}>
            <span className="block text-sm font-medium text-slate-900">{m.notify}</span>
            <span className="block text-xs text-slate-500">{m.notifyHint}</span>
          </span>
        </label>
        <button type="submit" hidden />
      </form>
    </Drawer>
  )
}
