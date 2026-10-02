import type { StaffColor } from '@/domain/types'

/** Literal class strings so Tailwind can see them at build time. */
export const staffColor: Record<StaffColor, { dot: string; event: string; soft: string }> = {
  indigo: { dot: 'bg-indigo-500', event: 'bg-indigo-50 border-indigo-500 text-indigo-900 hover:bg-indigo-100', soft: 'bg-indigo-100 text-indigo-700' },
  teal: { dot: 'bg-teal-500', event: 'bg-teal-50 border-teal-500 text-teal-900 hover:bg-teal-100', soft: 'bg-teal-100 text-teal-700' },
  amber: { dot: 'bg-amber-500', event: 'bg-amber-50 border-amber-500 text-amber-900 hover:bg-amber-100', soft: 'bg-amber-100 text-amber-800' },
  rose: { dot: 'bg-rose-500', event: 'bg-rose-50 border-rose-500 text-rose-900 hover:bg-rose-100', soft: 'bg-rose-100 text-rose-700' },
}
