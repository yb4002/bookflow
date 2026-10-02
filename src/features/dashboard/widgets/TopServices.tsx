import { Card, CardHeader } from '@/components/ui/Card'
import { useI18n } from '@/i18n'

export interface ServiceRevenue {
  name: string
  revenue: number
  count: number
}

/** Ranked horizontal bars, single hue; values are labelled in text ink, not the bar color. */
export function TopServices({ rows }: { rows: ServiceRevenue[] }) {
  const { t, f, fmt, plural } = useI18n()
  const s = t.dashboard.topServices
  const max = Math.max(1, ...rows.map((r) => r.revenue))
  return (
    <Card>
      <CardHeader title={s.title} description={s.subtitle} />
      <ul className="space-y-4 p-5">
        {rows.map((r) => (
          <li key={r.name} title={fmt(s.tooltip, { name: r.name, amount: f.money(r.revenue), visits: plural(t.common.visits, r.count) })}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium text-slate-700">{r.name}</span>
              <span className="shrink-0 font-semibold text-slate-900 tabular-nums">{f.money(r.revenue)}</span>
            </div>
            {/* Block bars grow from the inline-start edge, so they mirror automatically in RTL. */}
            <div className="mt-1.5 h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-brand-600" style={{ width: `${(r.revenue / max) * 100}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{plural(t.common.visits, r.count)}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
