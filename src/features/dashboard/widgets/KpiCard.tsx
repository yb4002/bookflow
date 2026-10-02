import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'

export interface KpiCardProps {
  label: string
  value: string
  icon: LucideIcon
  hint?: string
  /** Relative change vs the previous period, e.g. 0.12 = +12%. */
  delta?: number
  /** For metrics like no-show rate, going down is good. */
  lowerIsBetter?: boolean
}

export function KpiCard({ label, value, icon: Icon, hint, delta, lowerIsBetter }: KpiCardProps) {
  const { t, f } = useI18n()
  const good = delta === undefined ? undefined : lowerIsBetter ? delta <= 0 : delta >= 0
  const Arrow = delta !== undefined && delta < 0 ? ArrowDownRight : ArrowUpRight
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500 sm:text-sm">{label}</p>
        <Icon className="size-4 text-slate-400" />
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-3xl">{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {delta !== undefined && (
          <span className={cn('inline-flex items-center gap-0.5 font-semibold', good ? 'text-emerald-600' : 'text-rose-600')}>
            <Arrow className="size-3.5 rtl:-scale-x-100" />
            {f.percent(Math.abs(delta))}
            <span className="sr-only">{good ? t.dashboard.kpi.improved : t.dashboard.kpi.worse}</span>
          </span>
        )}
        {hint && <span className="text-slate-500">{hint}</span>}
      </div>
    </Card>
  )
}
