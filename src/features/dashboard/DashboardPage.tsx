import { useMemo } from 'react'
import { addDays, startOfDay, subDays } from 'date-fns'
import { inZone, zonedDayKey } from '@/domain/time'
import { AlertTriangle, CalendarCheck, CircleDollarSign, Clock, Plus, Star, UserPlus, UserX } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { useAppointmentForm } from '@/features/appointments/AppointmentForm'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { repo } from '@/data/repositories'
import { useQuery } from '@/hooks/useQuery'
import { useAuth } from '@/auth/AuthProvider'
import { SmartFillCard } from '@/features/smartFill/SmartFillCard'
import { ShareBookingLink } from '@/features/booking/ShareBookingLink'
import { useI18n, type Messages } from '@/i18n'
import { dailyBookings, findOpenSlots, noShowRate, revenue } from '@/lib/analytics'
import { Attention, type AttentionItem } from './widgets/Attention'
import { BookingsChart } from './widgets/BookingsChart'
import { KpiCard } from './widgets/KpiCard'
import { OpenSlots } from './widgets/OpenSlots'
import { TodaySchedule } from './widgets/TodaySchedule'
import { TopServices } from './widgets/TopServices'
import { LoadError } from '@/features/system/LoadError'

function greeting(d: Date, g: Messages['dashboard']['greeting']) {
  const h = d.getHours()
  return h < 12 ? g.morning : h < 18 ? g.afternoon : g.evening
}

const change = (cur: number, prev: number) => (prev === 0 ? 0 : (cur - prev) / prev)

export default function DashboardPage() {
  const { t, f, fmt, plural, zone } = useI18n()
  const { me } = useAuth()
  const openBooking = useAppointmentForm()
  const d = t.dashboard
  const { data, loading, error, refetch } = useQuery(async () => {
    // A day of margin on each side: the business's "today" may differ from the viewer's.
    const today = startOfDay(new Date())
    const [business, staff, services, customers, appointments] = await Promise.all([
      repo.getBusiness(),
      repo.listStaff(),
      repo.listServices(),
      repo.listCustomers(),
      repo.listAppointments({ from: subDays(today, 62), to: addDays(today, 3) }),
    ])
    return { business, staff, services, customers, appointments }
  }, [], { refreshOn: ['business', 'staff', 'services', 'customers', 'appointments'] })

  const m = useMemo(() => {
    if (!data) return null
    const now = new Date()
    const z = inZone(zone)
    const today = startOfDay(now, z)
    const subDays_ = (d: Date, n: number) => subDays(d, n, z)
    const addDays_ = (d: Date, n: number) => addDays(d, n, z)
    const { appointments: all, customers, business, staff, services } = data
    const inRange = (from: Date, to: Date) => all.filter((a) => new Date(a.start) >= from && new Date(a.start) < to)

    const todayKey = zonedDayKey(today, zone)
    const todays = all.filter((a) => zonedDayKey(a.start, zone) === todayKey)
    const upcomingToday = todays.filter((a) => new Date(a.start) > now && a.status !== 'cancelled')

    const week = inRange(subDays_(today, 6), addDays_(today, 1))
    const prevWeek = inRange(subDays_(today, 13), subDays_(today, 6))
    const last30 = inRange(subDays_(today, 30), addDays_(today, 1))
    const prev30 = inRange(subDays_(today, 60), subDays_(today, 30))

    const newClients = customers.filter((c) => new Date(c.createdAt) >= subDays_(today, 30)).length
    const newClientsPrev = customers.filter((c) => {
      const d = new Date(c.createdAt)
      return d >= subDays_(today, 60) && d < subDays_(today, 30)
    }).length

    const slots = [
      ...findOpenSlots(today, business, staff, all, 45, now, zone),
      ...findOpenSlots(addDays_(today, 1), business, staff, all, 45, now, zone),
    ]
    const active = services.filter((s) => s.active)
    // Average value of an hour of work across the menu (0 for a business with no services yet).
    const avgTicketPerHour = active.length ? active.reduce((s, x) => s + (x.price / x.durationMin) * 60, 0) / active.length : 0

    const byService = new Map<string, { name: string; revenue: number; count: number }>()
    for (const a of last30.filter((x) => x.status === 'completed')) {
      const row = byService.get(a.serviceId) ?? { name: a.service.name, revenue: 0, count: 0 }
      row.revenue += a.price
      row.count++
      byService.set(a.serviceId, row)
    }

    const pending = all.filter((a) => a.status === 'pending' && new Date(a.start) > now).length
    const atRisk = customers.filter((c) => c.tags.includes('At risk') || (c.lastVisit && new Date(c.lastVisit) < subDays_(today, 60) && !c.nextAppointment)).length
    const yesterdayDone = all.filter((a) => a.status === 'completed' && zonedDayKey(a.start, zone) === todayKey - 1).length
    const noShowsWeek = week.filter((a) => a.status === 'no_show').length

    const a = d.attention
    const attention: AttentionItem[] = [
      { icon: Clock, tone: 'amber', title: plural(a.pending, pending), body: a.pendingBody, to: '/app/calendar' },
      { icon: UserX, tone: 'red', title: plural(a.noShows, noShowsWeek), body: a.noShowsBody, to: '/app/services?tab=policies' },
      { icon: AlertTriangle, tone: 'amber', title: plural(a.atRisk, atRisk), body: a.atRiskBody, to: '/app/customers' },
      { icon: Star, tone: 'brand', title: plural(a.reviews, yesterdayDone), body: a.reviewsBody, to: '/app/customers' },
    ]

    return {
      todays,
      nextUp: upcomingToday[0],
      weekRevenue: revenue(week),
      weekRevenueDelta: change(revenue(week), revenue(prevWeek)),
      noShow: noShowRate(last30),
      noShowDelta: change(noShowRate(last30), noShowRate(prev30)),
      newClients,
      newClientsDelta: change(newClients, newClientsPrev),
      chart: dailyBookings(all, 14, today, zone),
      slots,
      avgTicketPerHour,
      topServices: [...byService.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      attention,
    }
  }, [data, d, plural, zone])

  const now = new Date()
  return (
    <>
      <PageHeader
        title={fmt(d.greetingLine, { greeting: greeting(now, d.greeting), name: me?.user.name.split(' ')[0] ?? '' })}
        description={fmt(d.subtitle, { date: f.dateLong(now), business: data?.business.name ?? me?.business.name ?? '' })}
        actions={
          <>
            {data && <ShareBookingLink slug={data.business.slug} />}
            <Button onClick={() => openBooking()}><Plus className="size-4" /> {d.newAppointment}</Button>
          </>
        }
      />

      {error && !data && <LoadError onRetry={refetch} />}
      {/* Smart Fill loads its own data, so it renders in parallel with the rest of the dashboard. */}
      {error && !data ? null : !m ? (
        <KpiSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <KpiCard label={d.kpi.todayAppointments} value={f.number(m.todays.filter((a) => a.status !== 'cancelled').length)} icon={CalendarCheck} hint={m.nextUp ? fmt(d.kpi.nextAt, { time: f.time(m.nextUp.start) }) : d.kpi.allDone} />
            <KpiCard label={d.kpi.revenue7d} value={f.money(m.weekRevenue)} icon={CircleDollarSign} delta={m.weekRevenueDelta} hint={d.kpi.vsLastWeek} />
            <KpiCard label={d.kpi.noShow30d} value={f.percent(m.noShow, 1)} icon={UserX} delta={m.noShowDelta} lowerIsBetter hint={d.kpi.vsPrior30} />
            <KpiCard label={d.kpi.newClients30d} value={f.number(m.newClients)} icon={UserPlus} delta={m.newClientsDelta} hint={d.kpi.vsPrior30} />
        </div>
      )}

      <div className="mt-4">
        <SmartFillCard />
      </div>

      {error && !data ? null : !m ? (
        <RestSkeleton />
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="flex flex-col justify-between gap-4 p-5 lg:col-span-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{d.chart.title}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{d.chart.subtitle}</p>
                </div>
                <p className="text-end">
                  <span className="block text-xl font-bold text-slate-900 tabular-nums">{f.number(m.chart.reduce((sum, day) => sum + day.count, 0))}</span>
                  <span className="text-xs text-slate-500">{d.chart.total}</span>
                </p>
              </div>
              <BookingsChart data={m.chart} />
            </Card>
            <OpenSlots slots={m.slots} avgTicketPerHour={m.avgTicketPerHour} />
          </div>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2"><TodaySchedule appointments={m.todays} /></div>
            <div className="min-w-0 space-y-4">
              <Attention items={m.attention} />
              <TopServices rows={m.topServices} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="p-5"><Skeleton className="h-4 w-24" /><Skeleton className="mt-3 h-8 w-20" /><Skeleton className="mt-3 h-3 w-28" /></Card>)}
    </div>
  )
}

function RestSkeleton() {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card className="h-72 p-5 lg:col-span-2"><Skeleton className="h-full w-full" /></Card>
      <Card className="h-72 p-5"><Skeleton className="h-full w-full" /></Card>
    </div>
  )
}
