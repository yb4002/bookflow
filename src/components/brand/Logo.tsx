import { cn } from '@/lib/cn'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#4f46e5" />
      <path d="M9 11.5h14M9 16h9M9 20.5h6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="22" cy="21" r="3.2" fill="#a5b4fc" />
    </svg>
  )
}

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className={cn('text-lg font-bold tracking-tight', light ? 'text-white' : 'text-slate-900')}>BookFlow</span>
    </span>
  )
}
