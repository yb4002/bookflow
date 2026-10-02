import { set } from 'date-fns'
import { Bell, Check, Sparkles, TrendingUp } from 'lucide-react'
import { useI18n } from '@/i18n'

/** Row styling for the illustrative schedule; text comes from the locale file. */
const rowStyles = [
  { hour: 9, minute: 0, color: 'border-indigo-500 bg-indigo-50', h: 'h-14' },
  { hour: 10, minute: 15, color: 'border-amber-500 bg-amber-50', h: 'h-10' },
  { hour: 11, minute: 0, color: 'border-dashed border-brand-300 bg-white', h: 'h-12', open: true },
  { hour: 12, minute: 0, color: 'border-teal-500 bg-teal-50', h: 'h-16' },
]

/** Illustrative product mock for the hero — pure markup, no screenshots. */
export function HeroVisual() {
  const { t, f, fmt } = useI18n()
  const v = t.landing.heroVisual
  const at = (hour: number, minute = 0) => set(new Date(), { hours: hour, minutes: minute })

  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-brand-200/60 via-violet-200/40 to-sky-100/40 blur-2xl" />
      <div className="rounded-2xl bg-white p-4 shadow-pop ring-1 ring-slate-200 sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">{v.today}</p>
            <p className="text-sm font-semibold text-slate-900">{v.dayTitle}</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/15">
            <TrendingUp className="size-3 rtl:-scale-x-100" /> {v.booked}
          </span>
        </div>
        <div className="mt-4 space-y-2">
          {rowStyles.map((r, i) => (
            <div key={i} className="flex gap-3">
              <span className="w-10 shrink-0 pt-1 text-end text-[11px] font-medium text-slate-400 tabular-nums">{f.clock(at(r.hour, r.minute))}</span>
              <div className={`flex-1 rounded-lg border-s-[3px] px-3 py-2 ${r.color} ${r.h} ${r.open ? 'border border-s-[3px]' : ''}`}>
                <p className={`text-xs font-semibold ${r.open ? 'text-brand-700' : 'text-slate-900'}`}>{v.rows[i].name}</p>
                <p className="text-[11px] text-slate-500">{v.rows[i].detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute -end-2 -top-12 hidden items-center gap-2.5 rounded-xl bg-white px-3.5 py-2.5 shadow-pop ring-1 ring-slate-200 sm:flex lg:-end-8">
        <span className="flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Check className="size-4" /></span>
        <div>
          <p className="text-xs font-semibold text-slate-900">{v.slotFilledTitle}</p>
          <p className="text-[11px] text-slate-500">{fmt(v.slotFilledBody, { time: f.time(at(11)) })}</p>
        </div>
      </div>

      <div className="absolute -start-2 -bottom-5 flex items-center gap-2.5 rounded-xl bg-white px-3.5 py-2.5 shadow-pop ring-1 ring-slate-200 lg:-start-10">
        <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-brand-600"><Bell className="size-4" /></span>
        <div>
          <p className="text-xs font-semibold text-slate-900">{v.reminderTitle}</p>
          <p className="text-[11px] text-slate-500">{fmt(v.reminderBody, { time: f.time(at(12)) })}</p>
        </div>
      </div>

      <div className="absolute -start-14 top-1/2 hidden -translate-y-1/2 flex-col items-center gap-1 rounded-xl bg-slate-900 px-3 py-3 text-white shadow-pop xl:flex">
        <Sparkles className="size-4 text-brand-300" />
        <span className="text-lg font-bold" dir="ltr">{f.percent(-0.38)}</span>
        <span className="text-[10px] text-slate-300">{v.noShowsLabel}</span>
      </div>
    </div>
  )
}
