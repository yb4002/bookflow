import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDays, endOfWeek, isSameDay, startOfDay, startOfWeek } from 'date-fns'
import { atWallTime, inZone, instant, zonedDayKey, zonedWeekday } from '@/domain/time'
import { useAppointmentForm } from '@/features/appointments/AppointmentForm'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { AppointmentStatus, AppointmentView } from '@/domain/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/Skeleton'
import { repo } from '@/data/repositories'
import { useQuery } from '@/hooks/useQuery'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { staffColor } from '@/lib/staffColors'
import { AppointmentDrawer } from './AppointmentDrawer'
import { TimeGrid, type GridColumn } from './TimeGrid'
import { LoadError } from '@/features/system/LoadError'

type View = 'day' | 'week'

function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

export default function CalendarPage() {
  const isMobile = useIsMobile()
  const { t, f, fmt, plural, config, zone } = useI18n()
  const c = t.calendar
  // Calendar days are the business's days (its time zone), whatever the viewer's zone is.
  const z = inZone(zone)
  const weekOpts = { weekStartsOn: config.weekStartsOn, ...z }
  const [view, setView] = useState<View>(() => (window.matchMedia('(max-width: 767px)').matches ? 'day' : 'week'))
  const [anchor, setCursor] = useState(() => new Date())
  const cursor = instant(startOfDay(anchor, z))
  const isToday = (d: Date) => isSameDay(d, new Date(), z)
  const openBooking = useAppointmentForm()
  const [hiddenStaff, setHiddenStaff] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<AppointmentView | null>(null)

  const weekStart = instant(startOfWeek(cursor, weekOpts))
  const range = view === 'week' ? { from: weekStart, to: instant(addDays(weekStart, 7, z)) } : { from: cursor, to: instant(addDays(cursor, 1, z)) }

  const meta = useQuery(() => Promise.all([repo.getBusiness(), repo.listStaff()]), [], { refreshOn: ['business', 'staff'] })
  const appts = useQuery(() => repo.listAppointments(range), [range.from.getTime(), range.to.getTime()], { refreshOn: ['appointments', 'customers'] })
  const [business, staff] = meta.data ?? []

  const visible = useMemo(() => (appts.data ?? []).filter((a) => !hiddenStaff.has(a.staffId)), [appts.data, hiddenStaff])

  const columns: GridColumn[] = useMemo(() => {
    if (!business || !staff) return []
    if (view === 'week') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = instant(addDays(weekStart, i, z))
        return {
          key: d.toISOString(),
          date: d,
          title: f.day(d),
          subtitle: f.weekdayShort(d),
          highlight: isToday(d),
          closed: !business.hours[zonedWeekday(d, zone)].open,
          events: visible.filter((a) => zonedDayKey(a.start, zone) === zonedDayKey(d, zone)),
        }
      })
    }
    return staff
      .filter((s) => !hiddenStaff.has(s.id))
      .map((s) => ({
        key: s.id,
        date: cursor,
        title: s.name.split(' ')[0],
        subtitle: s.role.split('·').pop()!.trim(),
        closed: !business.hours[zonedWeekday(cursor, zone)].open,
        events: visible.filter((a) => a.staffId === s.id),
      }))
  }, [business, staff, view, visible, cursor.getTime(), hiddenStaff, weekStart.getTime(), f, zone])

  const step = (dir: 1 | -1) => setCursor(instant(addDays(cursor, (view === 'week' ? 7 : 1) * dir, z)))
  const label = view === 'week' ? f.dateRange(weekStart, endOfWeek(cursor, weekOpts)) : f.dateLong(cursor)

  const booked = visible.filter((a) => a.status !== 'cancelled')
  const updateStatus = useCallback(async (id: string, s: AppointmentStatus) => {
    await repo.updateAppointmentStatus(id, s)
    appts.refetch()
  }, [appts.refetch])

  const toggleStaff = (id: string) =>
    setHiddenStaff((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (staff && next.size < staff.length - 1) next.add(id)
      return next
    })

  return (
    <>
      <PageHeader
        title={c.title}
        description={fmt(view === 'week' ? c.summaryWeek : c.summaryDay, {
          appointments: plural(t.common.appointments, booked.length),
          amount: f.money(booked.reduce((s, a) => s + a.price, 0)),
        })}
        actions={<Button onClick={() => openBooking({ start: isToday(cursor) ? undefined : atWallTime(cursor, '09:00', zone) })}><Plus className="size-4" /> {c.newAppointment}</Button>}
      />

      <Card className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-slate-200 p-3 sm:p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCursor(new Date())}>{c.today}</Button>
            <div className="flex">
              <button className="rounded-s-lg p-1.5 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50" onClick={() => step(-1)} aria-label={t.common.previous}><ChevronLeft className="size-4 rtl:rotate-180" /></button>
              <button className="-ms-px rounded-e-lg p-1.5 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50" onClick={() => step(1)} aria-label={t.common.next}><ChevronRight className="size-4 rtl:rotate-180" /></button>
            </div>
            <h2 className="ms-1 text-sm font-semibold text-slate-900 sm:text-base">{label}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {staff?.map((s) => {
              const on = !hiddenStaff.has(s.id)
              return (
                <button
                  key={s.id}
                  onClick={() => toggleStaff(s.id)}
                  aria-pressed={on}
                  className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition', on ? 'bg-white text-slate-700 ring-slate-200' : 'bg-slate-50 text-slate-400 ring-slate-100')}
                >
                  <span className={cn('size-2 rounded-full', on ? staffColor[s.color].dot : 'bg-slate-300')} />
                  {s.name.split(' ')[0]}
                </button>
              )
            })}
            <Segmented value={view} onChange={setView} options={[{ value: 'day', label: c.day }, { value: 'week', label: c.week }]} className="ms-auto md:ms-2" />
          </div>
        </div>

        {/* Mobile day strip */}
        {view === 'day' && isMobile && (
          <div className="scrollbar-none flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2">
            {Array.from({ length: 7 }, (_, i) => instant(addDays(weekStart, i, z))).map((d) => (
              <button
                key={d.toISOString()}
                onClick={() => setCursor(d)}
                className={cn('flex min-w-11 flex-1 flex-col items-center rounded-lg py-1.5', isSameDay(d, cursor, z) ? 'bg-brand-600 text-white' : isToday(d) ? 'text-brand-600' : 'text-slate-600')}
              >
                <span className="text-[10px] font-medium uppercase opacity-80">{f.weekdayNarrow(d)}</span>
                <span className="text-sm font-semibold">{f.day(d)}</span>
              </button>
            ))}
          </div>
        )}

        {(meta.error && !meta.data) || (appts.error && !appts.data) ? (
          <div className="p-4"><LoadError onRetry={() => (meta.refetch(), appts.refetch())} /></div>
        ) : !business || (appts.loading && !appts.data) ? (
          <div className="space-y-3 p-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <div className={cn(appts.loading && 'opacity-60 transition-opacity')}>
            <TimeGrid columns={columns} onSelect={setSelected} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded-sm bg-slate-500" /> {c.legend.confirmed}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded-sm border-s-[3px] border-dashed border-slate-500" /> {c.legend.pending}</span>
          <span className="inline-flex items-center gap-1.5"><span className="line-through">{c.legend.sample}</span> {c.legend.cancelled}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-rose-500" /> {c.legend.now}</span>
        </div>
      </Card>

      <AppointmentDrawer appt={selected} onClose={() => setSelected(null)} onStatus={updateStatus} />
    </>
  )
}
