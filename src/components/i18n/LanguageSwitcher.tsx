import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Languages } from 'lucide-react'
import { LOCALE_CODES, LOCALES, useI18n } from '@/i18n'
import { cn } from '@/lib/cn'

/**
 * Language menu. Lists every registered locale, so adding a language needs no
 * changes here. `compact` shows the short code only (for tight toolbars).
 */
export function LanguageSwitcher({ compact, className, align = 'end' }: { compact?: boolean; className?: string; align?: 'start' | 'end' }) {
  const { locale, config, setLocale, t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t.common.language}: ${config.nativeName}`}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <Languages className="size-4" />
        <span>{compact ? config.short : config.nativeName}</span>
        <ChevronDown className={cn('size-3.5 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t.common.language}
          className={cn(
            'absolute top-full z-50 mt-1.5 min-w-40 animate-fade-in rounded-xl bg-white p-1 shadow-pop ring-1 ring-slate-200',
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          {LOCALE_CODES.map((code) => {
            const l = LOCALES[code]
            const active = code === locale
            return (
              <li key={code} role="option" aria-selected={active}>
                <button
                  type="button"
                  lang={code}
                  dir={l.dir}
                  onClick={() => {
                    setLocale(code)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-sm',
                    active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700 hover:bg-slate-50',
                  )}
                >
                  {l.nativeName}
                  {active && <Check className="size-4" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
