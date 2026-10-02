import { Link } from 'react-router-dom'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { useI18n } from '@/i18n'

export interface AttentionItem {
  icon: LucideIcon
  tone: 'amber' | 'red' | 'brand'
  title: string
  body: string
  to: string
}

const toneClass = { amber: 'bg-amber-50 text-amber-600', red: 'bg-rose-50 text-rose-600', brand: 'bg-brand-50 text-brand-600' }

export function Attention({ items }: { items: AttentionItem[] }) {
  const { t } = useI18n()
  return (
    <Card>
      <CardHeader title={t.dashboard.attention.title} description={t.dashboard.attention.subtitle} />
      <ul className="mt-2 px-2 pb-2">
        {items.map((it) => (
          <li key={it.title}>
            <Link to={it.to} className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-slate-50">
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${toneClass[it.tone]}`}><it.icon className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{it.title}</p>
                <p className="text-xs text-slate-500">{it.body}</p>
              </div>
              <ChevronRight className="size-4 text-slate-300 rtl:rotate-180" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
