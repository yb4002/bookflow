import { AlertTriangle, CalendarDays, Clock, Crown, History, RotateCcw, Scissors, ShieldCheck, UserCheck, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import type { MatchReason } from './matching'

const icons: Record<MatchReason['type'], LucideIcon> = {
  service: Scissors,
  category: Scissors,
  staff: UserCheck,
  timeOfDay: Clock,
  weekday: CalendarDays,
  due: History,
  reliable: ShieldCheck,
  vip: Crown,
  winBack: RotateCcw,
  noShows: AlertTriangle,
}

export function useReasonText() {
  const { t, f, fmt, plural } = useI18n()
  const r = t.smartFill.reasons
  return (reason: MatchReason): string => {
    switch (reason.type) {
      case 'service': return plural(r.service, reason.count, { service: reason.serviceName })
      case 'category': return fmt(r.category, { category: reason.category })
      case 'staff': return fmt(reason.strong ? r.staffStrong : r.staff, { staff: reason.staffName })
      case 'timeOfDay': return r[reason.period]
      case 'weekday': {
        return fmt(r.weekday, { weekday: f.weekdayName(reason.weekday) })
      }
      case 'due': return plural(r.due, reason.daysSince)
      case 'reliable': return r.reliable
      case 'vip': return r.vip
      case 'winBack': return r.winBack
      case 'noShows': return plural(r.noShows, reason.count)
    }
  }
}

export function ReasonChip({ reason }: { reason: MatchReason }) {
  const text = useReasonText()
  const Icon = icons[reason.type]
  const warning = reason.type === 'noShows'
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        warning ? 'bg-amber-50 text-amber-800 ring-amber-600/20' : 'bg-slate-50 text-slate-600 ring-slate-200',
      )}
    >
      <Icon className={cn('size-3 shrink-0', warning ? 'text-amber-600' : 'text-brand-500')} />
      <span className="truncate">{text(reason)}</span>
    </span>
  )
}
