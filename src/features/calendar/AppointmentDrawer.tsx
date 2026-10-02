import { useEffect, useState } from 'react'
import { ArrowRightLeft, Bell, CalendarClock, Check, Clock, Globe, Hash, Mail, Phone, StickyNote, UserX, X } from 'lucide-react'
import type { DayAvailability } from '@/domain/availability'
import { fromLocalDateTime, toLocalDateString } from '@/domain/time'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field, Input, inputClass } from '@/components/ui/Input'
import { repo } from '@/data/repositories'
import { useQuery } from '@/hooks/useQuery'
import { useErrorText } from '@/features/appointments/useErrorText'
import type { AppointmentStatus, AppointmentView } from '@/domain/types'
import { Ltr } from '@/components/i18n/Ltr'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useI18n } from '@/i18n'
import { fullName, initials } from '@/lib/format'
import { staffColor } from '@/lib/staffColors'
import { cn } from '@/lib/cn'
import { AppointmentMessages } from './AppointmentMessages'

export function AppointmentDrawer({ appt, onClose, onStatus }: { appt: AppointmentView | null; onClose: () => void; onStatus: (id: string, s: AppointmentStatus) => Promise<void> }) {
  if (!appt) return null
  return <AppointmentDrawerBody key={appt.id} appt={appt} onClose={onClose} onStatus={onStatus} />
}

type Panel = 'details' | 'move' | 'cancel'

function AppointmentDrawerBody({ appt, onClose, onStatus }: { appt: AppointmentView; onClose: () => void; onStatus: (id: string, s: AppointmentStatus) => Promise<void> }) {
  const toast = useToast()
  const { t, f, fmt } = useI18n()
  const d = t.calendar.drawer
  const a = t.manage.appointment
  const errorText = useErrorText()
  const [panel, setPanel] = useState<Panel>('details')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notify, setNotify] = useState(true)
  const upcoming = new Date(appt.start) > new Date()
  const open = appt.status === 'confirmed' || appt.status === 'pending'

  const run = async (fn: () => Promise<unknown>, msg: string, close = true) => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
      toast(msg)
      if (close) onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const act = (s: AppointmentStatus, msg: string) => run(() => onStatus(appt.id, s), msg)

  if (panel === 'move') return <MoveAppointment appt={appt} onBack={() => setPanel('details')} onClose={onClose} />

  return (
    <Drawer
      open
      onClose={onClose}
      title={d.title}
      footer={
        open ? (
          <div className="space-y-3">
            {error && <p role="alert" className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
            {panel === 'cancel' ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-900">{a.cancelTitle}</p>
                <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-700">
                  <Checkbox checked={notify} onChange={() => setNotify(!notify)} label={a.notifyCancel} />
                  <span onClick={() => setNotify(!notify)}>{a.notifyCancel}</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => setPanel('details')}>{a.keep}</Button>
                  <Button variant="danger" disabled={busy} onClick={() => run(() => repo.cancelAppointment(appt.id, { notify }), t.toasts.appointmentCancelled)}>{a.cancelConfirm}</Button>
                </div>
              </div>
            ) : upcoming ? (
              <div className="grid grid-cols-2 gap-2">
                {appt.status === 'pending' && <Button className="col-span-2" disabled={busy} onClick={() => act('confirmed', t.toasts.appointmentConfirmed)}><Check className="size-4" /> {d.confirm}</Button>}
                <Button variant="secondary" disabled={busy} onClick={() => setPanel('move')}><ArrowRightLeft className="size-4" /> {a.move}</Button>
                <Button variant="secondary" disabled={busy} onClick={() => run(() => repo.sendReminder(appt.id), a.reminderSent, false)}><Bell className="size-4" /> {a.sendReminder}</Button>
                <Button variant="danger" className="col-span-2" disabled={busy} onClick={() => (setNotify(true), setPanel('cancel'))}><X className="size-4" /> {d.cancel}</Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button disabled={busy} onClick={() => act('completed', t.toasts.markedCompleted)}><Check className="size-4" /> {d.completed}</Button>
                <Button variant="danger" disabled={busy} onClick={() => act('no_show', t.toasts.markedNoShow)}><UserX className="size-4" /> {d.noShow}</Button>
              </div>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-slate-900">{appt.service.name}</p>
          <p className="mt-0.5 text-sm text-slate-500">{f.friendlyDate(appt.start)} · {f.timeRange(appt.start, appt.end)}</p>
        </div>
        <StatusBadge status={appt.status} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3">
        {[
          { icon: Clock, label: d.duration, value: f.duration(appt.service.durationMin) },
          { icon: CalendarClock, label: d.price, value: f.money(appt.price) },
          { icon: Globe, label: d.bookedVia, value: t.sources[appt.source] },
          { icon: Bell, label: d.reminder, value: appt.reminderSent ? d.reminderSent : d.reminderScheduled },
          ...(appt.reference ? [{ icon: Hash, label: a.reference, value: appt.reference }] : []),
        ].map((r) => (
          <div key={r.label} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
            <dt className="flex items-center gap-1.5 text-xs text-slate-500"><r.icon className="size-3.5" /> {r.label}</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900">{r.value}</dd>
          </div>
        ))}
      </dl>

      {(appt.cancellationReason || appt.previousStart) && (
        <div className="mt-4 space-y-1.5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-100">
          {appt.cancellationReason && (
            <p><span className="text-slate-500">{d.cancellationReason}:</span> {t.cancellationReasons[appt.cancellationReason]}</p>
          )}
          {appt.previousStart && (
            <p className="text-slate-600">{fmt(d.rescheduledFrom, { when: `${f.dateMedium(appt.previousStart)} · ${f.time(appt.previousStart)}` })}</p>
          )}
        </div>
      )}

      <h4 className="mt-7 text-xs font-semibold tracking-wide text-slate-500 uppercase">{d.client}</h4>
      <div className="mt-3 flex items-center gap-3">
        <Avatar label={initials(appt.customer)} seed={appt.customer.id} size="md" />
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{fullName(appt.customer)}</p>
          <p className="flex items-center gap-1.5 text-sm text-slate-500"><Phone className="size-3.5" /> <Ltr>{appt.customer.phone}</Ltr></p>
          <p className="flex items-center gap-1.5 truncate text-sm text-slate-500"><Mail className="size-3.5" /> <Ltr>{appt.customer.email}</Ltr></p>
        </div>
      </div>
      {appt.customer.notes && (
        <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200/60">
          <StickyNote className="mt-0.5 size-4 shrink-0" /> {appt.customer.notes}
        </div>
      )}

      <AppointmentNotes appt={appt} />

      <AppointmentMessages appointmentId={appt.id} />

      <h4 className="mt-7 text-xs font-semibold tracking-wide text-slate-500 uppercase">{d.teamMember}</h4>
      <div className="mt-3 flex items-center gap-3">
        <span className={cn('flex size-10 items-center justify-center rounded-full text-sm font-semibold', staffColor[appt.staff.color].soft)}>{appt.staff.avatarInitials}</span>
        <div>
          <p className="font-semibold text-slate-900">{appt.staff.name}</p>
          <p className="text-sm text-slate-500">{appt.staff.role}</p>
        </div>
      </div>
    </Drawer>
  )
}

/** Team-only notes on the appointment, saved on demand. */
function AppointmentNotes({ appt }: { appt: AppointmentView }) {
  const { t } = useI18n()
  const a = t.manage.appointment
  const toast = useToast()
  const [notes, setNotes] = useState(appt.notes ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = notes.trim() !== (appt.notes ?? '')
  return (
    <div className="mt-6">
      <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{a.notes}</h4>
      <textarea
        name="appointmentNotes"
        rows={2}
        dir="auto"
        value={notes}
        placeholder={a.notesPlaceholder}
        aria-label={a.notes}
        onChange={(e) => setNotes(e.target.value)}
        className={cn(inputClass, 'mt-2 h-auto py-2')}
      />
      {dirty && (
        <Button
          size="sm"
          className="mt-2"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            await repo.updateAppointmentNotes(appt.id, notes).finally(() => setSaving(false))
            toast(a.notesSaved)
          }}
        >
          {a.saveNotes}
        </Button>
      )}
    </div>
  )
}

/** Move to another day/time, optionally to another team member who performs the service. */
function MoveAppointment({ appt, onBack, onClose }: { appt: AppointmentView; onBack: () => void; onClose: () => void }) {
  const { t, f, zone } = useI18n()
  const a = t.manage.appointment
  const m = t.manage.form
  const toast = useToast()
  const errorText = useErrorText()
  const staff = useQuery(() => repo.listStaff(), [])
  const qualified = (staff.data ?? []).filter((s) => s.serviceIds.includes(appt.serviceId))
  const [staffId, setStaffId] = useState(appt.staffId)
  const [date, setDate] = useState(() => toLocalDateString(appt.start, zone))
  const [start, setStart] = useState<string>()
  const [notify, setNotify] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [day, setDay] = useState<DayAvailability>()

  useEffect(() => {
    let live = true
    setDay(undefined)
    setStart(undefined)
    repo.getStaffAvailability(appt.serviceId, fromLocalDateTime(date, '12:00', zone), 1, { staffId, ignoreAppointmentId: appt.id }).then((d) => live && setDay(d[0]), () => live && setDay({ date: new Date(), open: false, slots: [] }))
    return () => {
      live = false
    }
  }, [appt.serviceId, appt.id, staffId, date, zone])

  const save = async () => {
    if (!start) return
    setSaving(true)
    setError(undefined)
    try {
      await repo.moveAppointment(appt.id, { start, staffId, notify })
      toast(a.moved)
      onClose()
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={a.moveTitle}
      footer={
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onBack}>{t.manage.appointment.keep}</Button>
            <Button disabled={!start || saving} onClick={save}>{a.moveSave}</Button>
          </div>
        </div>
      }
    >
      <p className="text-sm text-slate-600">{appt.service.name} · {f.friendlyDate(appt.start)} · {f.timeRange(appt.start, appt.end)}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Field label={m.staff}>
          <select name="moveStaff" className={inputClass} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {qualified.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label={m.date}>
          <Input name="moveDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <p className="mt-5 mb-2 text-sm font-medium text-slate-700">{m.time}</p>
      {!day ? (
        <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
      ) : !day.open ? (
        <p className="text-sm text-slate-500">{m.closed}</p>
      ) : day.slots.some((s) => s.available) ? (
        <div className="grid grid-cols-4 gap-2" data-testid="move-slots">
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
      )}
      <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-100">
        <Checkbox checked={notify} onChange={() => setNotify(!notify)} label={a.notifyMove} />
        <span onClick={() => setNotify(!notify)}>{a.notifyMove}</span>
      </label>
    </Drawer>
  )
}
