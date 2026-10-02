import { Users } from 'lucide-react'
import type { PublicBusinessProfile } from '@/data/repositories'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { staffColor } from '@/lib/staffColors'

type PublicStaff = PublicBusinessProfile['staff'][number]

/** Optional stylist preference. Hidden when only one person offers the service. */
export function StaffPicker({ staff, value, onChange }: { staff: PublicStaff[]; value?: string; onChange: (id: string | undefined) => void }) {
  const { t } = useI18n()
  const s = t.booking.time
  if (staff.length < 2) return null

  const chip = (active: boolean) =>
    cn(
      'inline-flex shrink-0 items-center gap-2 rounded-full py-1.5 ps-1.5 pe-3 text-sm font-medium ring-1 transition',
      active ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200 hover:ring-brand-300',
    )

  return (
    <div className="mb-6">
      <p className="mb-2 text-sm font-semibold text-slate-700">{s.staffLabel}</p>
      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="radiogroup" aria-label={s.staffLabel}>
        <button type="button" role="radio" aria-checked={!value} onClick={() => onChange(undefined)} className={chip(!value)}>
          <span className={cn('flex size-7 items-center justify-center rounded-full', !value ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}><Users className="size-4" /></span>
          {s.staffAny}
        </button>
        {staff.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={value === m.id} onClick={() => onChange(m.id)} className={chip(value === m.id)}>
            <span className={cn('flex size-7 items-center justify-center rounded-full text-[11px] font-semibold', staffColor[m.color].soft)}>{m.avatarInitials}</span>
            <span dir="auto">{m.name.split(' ')[0]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
