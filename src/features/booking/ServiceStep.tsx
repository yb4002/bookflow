import { ChevronRight, Clock } from 'lucide-react'
import type { Service } from '@/domain/types'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'

export function ServiceStep({ services, selectedId, onSelect }: { services: Service[]; selectedId?: string; onSelect: (s: Service) => void }) {
  const { t, f } = useI18n()
  const categories = [...new Set(services.map((s) => s.category))]
  return (
    <section aria-labelledby="step-service">
      <h2 id="step-service" className="text-lg font-semibold text-slate-900">{t.booking.service.title}</h2>
      <div className="mt-4 space-y-6">
        {categories.map((cat) => (
          <div key={cat}>
            <h3 dir="auto" className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{cat}</h3>
            <ul className="space-y-2">
              {services.filter((s) => s.category === cat).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(s)}
                    aria-pressed={selectedId === s.id}
                    className={cn(
                      'group flex w-full items-center gap-4 rounded-xl bg-white p-4 text-start shadow-card ring-1 transition',
                      selectedId === s.id ? 'ring-2 ring-brand-500' : 'ring-slate-200/70 hover:ring-brand-300',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p dir="auto" className="font-semibold text-slate-900 rtl:text-right">{s.name}</p>
                      <p dir="auto" className="mt-0.5 line-clamp-2 text-sm text-slate-500 rtl:text-right">{s.description}</p>
                      <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                        <Clock className="size-3.5" /> {f.duration(s.durationMin)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-base font-bold text-slate-900 tabular-nums">{f.money(s.price)}</span>
                      <ChevronRight className="size-5 text-slate-300 transition group-hover:text-brand-500 rtl:rotate-180" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
