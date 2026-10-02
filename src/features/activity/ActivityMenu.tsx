import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRightLeft, Bell, CalendarPlus, X } from 'lucide-react'
import { api } from '@/data/api/client'
import { repo } from '@/data/repositories'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'

interface ActivityItem {
  id: string
  type: 'booked' | 'cancelled' | 'rescheduled' | 'message_failed'
  at: string
  appointmentId?: string
  customerName: string
  serviceName?: string
  start?: string
}

const SEEN_KEY = 'bookflow.activity.seen'
const icons = { booked: CalendarPlus, cancelled: X, rescheduled: ArrowRightLeft, message_failed: AlertTriangle }
const tones = { booked: 'bg-emerald-50 text-emerald-600', cancelled: 'bg-rose-50 text-rose-600', rescheduled: 'bg-brand-50 text-brand-600', message_failed: 'bg-amber-50 text-amber-600' }

/** Top-bar bell: what clients did recently (online bookings, cancellations, moves) and failed messages. */
export function ActivityMenu() {
  const { t, f, fmt, plural } = useI18n()
  const a = t.activity
  const [items, setItems] = useState<ActivityItem[]>([])
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(() => api<ActivityItem[]>('GET', '/app/activity').then(setItems, () => undefined), [])
  useEffect(() => {
    void load()
    return repo.onChange((topics) => (topics.includes('appointments') || topics.includes('notifications')) && void load())
  }, [load])
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

  const unread = items.filter((i) => i.at > seen).length
  const toggle = () => {
    setOpen((o) => !o)
    const latest = items[0]?.at
    if (latest && latest > seen) {
      setSeen(latest)
      try {
        localStorage.setItem(SEEN_KEY, latest)
      } catch {
        /* ignore */
      }
    }
  }
  const text = (i: ActivityItem) => fmt(a.kinds[i.type], { name: i.customerName, service: i.serviceName ?? '', when: i.start ? `${f.dateMedium(i.start)} · ${f.time(i.start)}` : '' })

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={toggle} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={unread ? plural(a.unread, unread) : a.title} aria-expanded={open} aria-haspopup="dialog">
        <Bell className="size-5" />
        {unread > 0 && <span data-testid="activity-unread" className="absolute end-1.5 top-1.5 size-2 rounded-full bg-rose-500 ring-2 ring-white" />}
      </button>
      {open && (
        <div role="dialog" aria-label={a.title} className="absolute end-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-fade-in rounded-xl bg-white shadow-pop ring-1 ring-slate-200">
          <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">{a.title}</p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">{a.empty}</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {items.map((i) => {
                const Icon = icons[i.type]
                return (
                  <li key={i.id}>
                    <Link to="/app/calendar" onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 hover:bg-slate-50">
                      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', tones[i.type])}><Icon className="size-4" /></span>
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-800">{text(i)}</span>
                        <span className="block text-xs text-slate-500">{f.relative(i.at)}</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
