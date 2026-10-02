import { AlertTriangle, Check, CheckCheck, Clock, Mail, MessageCircle, MessageSquare, X, type LucideIcon } from 'lucide-react'
import type { MessageChannel, NotificationRecord } from '@/domain/types'
import { Ltr } from '@/components/i18n/Ltr'
import { Skeleton } from '@/components/ui/Skeleton'
import { repo } from '@/data/repositories'
import { useQuery } from '@/hooks/useQuery'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'

const channelIcon: Record<MessageChannel, LucideIcon> = { sms: MessageSquare, whatsapp: MessageCircle, email: Mail }
type DisplayStatus = NotificationRecord['status'] | 'delivered'
const statusStyle: Record<DisplayStatus, { icon: LucideIcon; className: string }> = {
  pending: { icon: Clock, className: 'bg-slate-100 text-slate-600' },
  sent: { icon: Check, className: 'bg-sky-50 text-sky-700' },
  delivered: { icon: CheckCheck, className: 'bg-emerald-50 text-emerald-700' },
  failed: { icon: AlertTriangle, className: 'bg-rose-50 text-rose-700' },
  cancelled: { icon: X, className: 'bg-slate-50 text-slate-400' },
}

/** What BookFlow sent (or will send) to the client about this appointment. Live-updating. */
export function AppointmentMessages({ appointmentId }: { appointmentId: string }) {
  const { t, f } = useI18n()
  const d = t.calendar.drawer
  const { data } = useQuery(() => repo.listNotifications(appointmentId), [appointmentId], { refreshOn: ['notifications', 'appointments'] })

  return (
    <>
      <h4 className="mt-7 text-xs font-semibold tracking-wide text-slate-500 uppercase">{d.messages}</h4>
      {!data ? (
        <Skeleton className="mt-3 h-12" />
      ) : data.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{d.noMessages}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-100">
          {data.map((n) => {
            const status: DisplayStatus = n.status === 'sent' && n.deliveredAt ? 'delivered' : n.status
            const Channel = channelIcon[n.channel]
            const Status = statusStyle[status].icon
            const at = n.sentAt ?? n.scheduledFor
            return (
              <li key={n.id} className="flex items-center gap-3 px-3 py-2.5" title={n.lastError}>
                <Channel className="size-4 shrink-0 text-slate-400" aria-label={t.smartFill.drawer.channels[n.channel]} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{d.messageKinds[n.kind]}</p>
                  <p className="truncate text-xs text-slate-500">
                    {f.dateMedium(at)} · {f.time(at)} · <Ltr>{n.recipient}</Ltr>
                  </p>
                </div>
                <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold', statusStyle[status].className)}>
                  <Status className="size-3" /> {d.messageStatus[status]}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
