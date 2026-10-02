import { Link } from 'react-router-dom'
import { CalendarX } from 'lucide-react'
import { isAfter, isBefore } from 'date-fns'
import type { AppointmentView } from '@/domain/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { fullName } from '@/lib/format'
import { staffColor } from '@/lib/staffColors'

export function TodaySchedule({ appointments }: { appointments: AppointmentView[] }) {
  const { t, f, plural } = useI18n()
  const s = t.dashboard.schedule
  const now = new Date()
  const list = appointments.filter((a) => a.status !== 'cancelled')
  return (
    <Card className="flex flex-col">
      <CardHeader
        title={s.title}
        description={plural(t.common.appointments, list.length)}
        action={<Link to="/app/calendar" className="text-xs font-semibold text-brand-600 hover:text-brand-700">{s.openCalendar}</Link>}
      />
      {list.length === 0 ? (
        <EmptyState icon={CalendarX} title={s.emptyTitle} description={s.emptyBody} />
      ) : (
        <ul className="mt-3 max-h-[420px] divide-y divide-slate-100 overflow-y-auto px-2 pb-2">
          {list.map((a) => {
            const inProgress = isBefore(new Date(a.start), now) && isAfter(new Date(a.end), now)
            return (
              <li key={a.id} className={cn('flex items-center gap-3 rounded-lg px-3 py-3', inProgress && 'bg-brand-50/60')}>
                <div className="w-[4.75rem] shrink-0">
                  <p className="text-sm font-semibold whitespace-nowrap text-slate-900 tabular-nums">{f.time(a.start)}</p>
                  <p className="text-[11px] text-slate-400">{f.duration(a.service.durationMin)}</p>
                </div>
                <span className={cn('h-9 w-1 shrink-0 rounded-full', staffColor[a.staff.color].dot)} />
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate text-sm font-medium text-slate-900 rtl:text-right">{fullName(a.customer)}</p>
                  <p dir="auto" className="truncate text-xs text-slate-500 rtl:text-right">{a.service.name} · {a.staff.name.split(' ')[0]}</p>
                </div>
                {inProgress ? (
                  <span className="rounded-md bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">{s.inProgress}</span>
                ) : (
                  <StatusBadge status={a.status} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
