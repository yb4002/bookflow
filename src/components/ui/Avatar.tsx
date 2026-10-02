import { cn } from '@/lib/cn'

const palette = [
  'bg-indigo-100 text-indigo-700',
  'bg-teal-100 text-teal-700',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
]

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const sizes = { xs: 'size-6 text-[10px]', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' }

export function Avatar({ label, seed, size = 'sm', className }: { label: string; seed?: string; size?: keyof typeof sizes; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', palette[hash(seed ?? label) % palette.length], sizes[size], className)}>
      {label}
    </span>
  )
}
