import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Accessible custom checkbox (visual only — pair with a clickable row or label). */
export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange?: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange?.()
      }}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md ring-1 transition-colors ring-inset',
        checked ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-transparent ring-slate-300 hover:ring-brand-400',
        className,
      )}
    >
      <Check className="size-3.5" strokeWidth={3} />
    </button>
  )
}
