import { useState } from 'react'
import { BellOff, CalendarPlus, Mail, MessageSquare, Pencil, Phone, StickyNote, Trash2 } from 'lucide-react'
import type { CustomerWithStats } from '@/domain/types'
import { Ltr } from '@/components/i18n/Ltr'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { inputClass } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusBadge, TagBadge } from '@/components/ui/StatusBadge'
import { Switch } from '@/components/ui/Switch'
import { useToast } from '@/components/ui/Toast'
import { repo } from '@/data/repositories'
import { useQuery } from '@/hooks/useQuery'
import { useAuth } from '@/auth/AuthProvider'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { fullName, initials } from '@/lib/format'
import { useAppointmentForm } from '@/features/appointments/AppointmentForm'
import { useErrorText } from '@/features/appointments/useErrorText'
import { CustomerForm } from './CustomerForm'
import { ChannelNotice } from '@/features/business/ChannelNotice'

type Panel = 'profile' | 'message' | 'erase'

export function CustomerDrawer({ customer, onClose }: { customer: CustomerWithStats | null; onClose: () => void }) {
  if (!customer) return null
  return <CustomerDrawerBody key={customer.id} customer={customer} onClose={onClose} />
}

function CustomerDrawerBody({ customer, onClose }: { customer: CustomerWithStats; onClose: () => void }) {
  const toast = useToast()
  const { t, f, fmt } = useI18n()
  const { me } = useAuth()
  const d = t.customers.drawer
  const c = t.manage.client
  const errorText = useErrorText()
  const openBooking = useAppointmentForm()
  const [panel, setPanel] = useState<Panel>('profile')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const history = useQuery(() => repo.listAppointments({ customerId: customer.id }), [customer.id], { refreshOn: ['appointments'] })
  const messages = useQuery(() => repo.listCustomerNotifications(customer.id), [customer.id], { refreshOn: ['notifications'] })
  const visits = [...(history.data ?? [])].reverse()
  const name = fullName(customer)

  const toggleOptOut = async () => {
    setBusy(true)
    setError(undefined)
    await repo.setCustomerOptOut(customer.id, !customer.messagingOptOut).catch((e) => setError(errorText(e)))
    setBusy(false)
  }
  const erase = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await repo.eraseCustomer(customer.id)
      toast(c.erased)
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  if (editing) return <CustomerForm customer={customer} onClose={() => setEditing(false)} />
  if (panel === 'message') return <MessageComposer customer={customer} onBack={() => setPanel('profile')} onClose={onClose} />

  return (
    <Drawer
      open
      onClose={onClose}
      title={d.title}
      footer={
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
          {panel === 'erase' ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">{fmt(c.eraseTitle, { name })}</p>
              <p className="text-xs text-slate-600">{c.eraseBody}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => setPanel('profile')}>{t.manage.appointment.keep}</Button>
                <Button variant="danger" disabled={busy} onClick={erase}>{c.eraseConfirm}</Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={customer.messagingOptOut} onClick={() => setPanel('message')}><MessageSquare className="size-4" /> {d.message}</Button>
              <Button onClick={() => (onClose(), openBooking({ customerId: customer.id }))}><CalendarPlus className="size-4" /> {d.book}</Button>
            </div>
          )}
        </div>
      }
    >
      <div className="flex items-center gap-4">
        <Avatar label={initials(customer)} seed={customer.id} size="lg" />
        <div className="min-w-0 flex-1">
          <p dir="auto" className="text-lg font-semibold text-slate-900 rtl:text-right">{name}</p>
          <p className="text-sm text-slate-500">{fmt(d.since, { date: f.monthYear(customer.createdAt) })}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {customer.tags.map((tag) => <TagBadge key={tag} tag={tag} />)}
            {customer.messagingOptOut && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"><BellOff className="size-3" /> {c.optedOut}</span>}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`${c.edit} ${name}`}><Pencil className="size-4" /> <span className="hidden sm:inline">{c.edit}</span></Button>
      </div>

      <div className="mt-5 space-y-1.5 text-sm text-slate-600">
        <p className="flex items-center gap-2"><Phone className="size-4 text-slate-400" /> <Ltr>{customer.phone}</Ltr></p>
        {customer.email && <p className="flex items-center gap-2"><Mail className="size-4 text-slate-400" /> <Ltr>{customer.email}</Ltr></p>}
      </div>

      <dl className="mt-6 grid grid-cols-3 divide-x divide-slate-100 rounded-lg bg-slate-50 py-3 text-center ring-1 ring-slate-100 rtl:divide-x-reverse">
        <div><dt className="text-[11px] text-slate-500">{d.visits}</dt><dd className="text-lg font-bold text-slate-900 tabular-nums">{f.number(customer.totalVisits)}</dd></div>
        <div><dt className="text-[11px] text-slate-500">{d.value}</dt><dd className="text-lg font-bold text-slate-900 tabular-nums">{f.money(customer.lifetimeValue)}</dd></div>
        <div><dt className="text-[11px] text-slate-500">{d.noShows}</dt><dd className={`text-lg font-bold tabular-nums ${customer.noShows ? 'text-rose-600' : 'text-slate-900'}`}>{f.number(customer.noShows)}</dd></div>
      </dl>

      {customer.notes && (
        <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200/60">
          <StickyNote className="mt-0.5 size-4 shrink-0" /> <span dir="auto" className="whitespace-pre-line">{customer.notes}</span>
        </div>
      )}

      <h4 className="mt-7 text-xs font-semibold tracking-wide text-slate-500 uppercase">{d.history}</h4>
      {history.loading && !history.data ? (
        <div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : visits.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{d.noHistory}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {visits.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p dir="auto" className="truncate text-sm font-medium text-slate-900 rtl:text-right">{a.service.name}</p>
                <p className="text-xs text-slate-500">{f.friendlyDate(a.start)} · {f.time(a.start)} · {a.staff.name.split(' ')[0]}</p>
              </div>
              <StatusBadge status={a.status} />
            </li>
          ))}
        </ul>
      )}

      <h4 className="mt-7 text-xs font-semibold tracking-wide text-slate-500 uppercase">{c.messages}</h4>
      {!messages.data?.length ? (
        <p className="mt-3 text-sm text-slate-500">{c.noMessages}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {messages.data.slice(0, 8).map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
              <span className="text-sm text-slate-700">{t.calendar.drawer.messageKinds[n.kind]}</span>
              <span className="text-xs text-slate-500">{t.calendar.drawer.messageStatus[n.deliveredAt ? 'delivered' : n.status]} · {f.relative(n.sentAt ?? n.scheduledFor)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-7 space-y-3 border-t border-slate-100 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900">{c.optOut}</p>
            <p className="text-xs text-slate-500">{c.optOutHint}</p>
          </div>
          <Switch checked={!!customer.messagingOptOut} onChange={toggleOptOut} label={c.optOut} />
        </div>
        {me?.role === 'owner' && (
          <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => setPanel('erase')}>
            <Trash2 className="size-3.5" /> {c.erase}
          </Button>
        )}
      </div>
    </Drawer>
  )
}

/** Free-text message to one client, sent on the business's channel. */
function MessageComposer({ customer, onBack, onClose }: { customer: CustomerWithStats; onBack: () => void; onClose: () => void }) {
  const { t, fmt } = useI18n()
  const m = t.manage.message
  const toast = useToast()
  const errorText = useErrorText()
  const business = useQuery(() => repo.getBusiness(), [])
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const channel = business.data?.policies.notificationChannel ?? 'sms'
  const viaEmail = channel === 'email' && !!customer.email
  const send = async () => {
    setSending(true)
    setError(undefined)
    try {
      await repo.sendCustomerMessage(customer.id, body)
      toast(m.sent)
      onClose()
    } catch (e) {
      setError(errorText(e))
      setSending(false)
    }
  }
  return (
    <Drawer
      open
      onClose={onClose}
      title={fmt(m.title, { name: customer.firstName })}
      footer={
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onBack}>{t.manage.appointment.keep}</Button>
            <Button disabled={!body.trim() || body.length > 640 || sending} onClick={send}>{sending ? m.sending : m.send}</Button>
          </div>
        </div>
      }
    >
      <textarea
        name="message"
        rows={6}
        dir="auto"
        autoFocus
        maxLength={640}
        value={body}
        placeholder={m.placeholder}
        aria-label={m.placeholder}
        onChange={(e) => setBody(e.target.value)}
        className={cn(inputClass, 'h-auto py-2')}
      />
      <div className="mt-2 flex justify-between gap-3 text-xs text-slate-500">
        <span>{fmt(m.hint, { channel: m.channels[viaEmail ? 'email' : channel === 'email' ? 'sms' : channel], to: viaEmail ? customer.email : customer.phone })}</span>
        <span className="tabular-nums">{body.length}/640</span>
      </div>
      <ChannelNotice channel={viaEmail ? 'email' : channel === 'email' ? 'sms' : channel} />
    </Drawer>
  )
}
