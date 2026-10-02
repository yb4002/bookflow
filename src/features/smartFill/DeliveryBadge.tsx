import { AlertTriangle, Check, CheckCheck, Loader2 } from 'lucide-react'
import type { DeliveryStatus } from '@/domain/types'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'

const style: Record<DeliveryStatus, string> = {
  queued: 'bg-slate-100 text-slate-600 ring-slate-500/10',
  sent: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  failed: 'bg-rose-50 text-rose-700 ring-rose-600/15',
}

export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  const { t } = useI18n()
  const Icon = status === 'queued' ? Loader2 : status === 'sent' ? Check : status === 'delivered' ? CheckCheck : AlertTriangle
  return (
    <span role="status" className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset', style[status])}>
      <Icon className={cn('size-3', status === 'queued' && 'animate-spin')} />
      {t.smartFill.status[status]}
    </span>
  )
}
