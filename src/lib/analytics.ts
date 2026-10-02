import { addDays, addMinutes, differenceInMinutes, isBefore, max, startOfDay, subDays } from 'date-fns'
import { atWallTime, inZone, instant, zonedDayKey, zonedWeekday } from '@/domain/time'
import type { AppointmentView, Business, StaffMember } from '@/domain/types'

/** Pure metric functions — the same logic can later run server-side. Day boundaries use the business's time zone. */

const billable = (a: AppointmentView) => a.status === 'completed' || a.status === 'confirmed'

export function revenue(appts: AppointmentView[]) {
  return appts.filter(billable).reduce((s, a) => s + a.price, 0)
}

export function noShowRate(appts: AppointmentView[]) {
  const closed = appts.filter((a) => a.status === 'completed' || a.status === 'no_show')
  if (!closed.length) return 0
  return closed.filter((a) => a.status === 'no_show').length / closed.length
}

export function dailyBookings(appts: AppointmentView[], days: number, end: Date, zone: string) {
  const z = inZone(zone)
  const first = startOfDay(subDays(end, days - 1, z), z)
  // Group once by local day (not once per day × appointment).
  const byDay = new Map<number, AppointmentView[]>()
  for (const a of appts) {
    if (a.status === 'cancelled') continue
    const key = zonedDayKey(a.start, zone)
    const list = byDay.get(key)
    if (list) list.push(a)
    else byDay.set(key, [a])
  }
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(first, i, z)
    const items = byDay.get(zonedDayKey(day, zone)) ?? []
    return { date: instant(day), count: items.length, revenue: revenue(items) }
  })
}

export interface OpenSlot {
  staff: StaffMember
  start: Date
  end: Date
  minutes: number
}

/**
 * Finds bookable gaps (≥ minMinutes) in a given day. These are the "fill
 * opportunities" a future waitlist/marketing feature will target.
 */
export function findOpenSlots(
  day: Date,
  business: Business,
  staff: StaffMember[],
  appts: AppointmentView[],
  minMinutes = 45,
  now = new Date(),
  zone: string,
): OpenSlot[] {
  const hours = business.hours[zonedWeekday(day, zone)]
  if (!hours.open) return []
  const open = max([atWallTime(day, hours.start, zone), now])
  const close = atWallTime(day, hours.end, zone)
  const slots: OpenSlot[] = []
  const dayKey = zonedDayKey(day, zone)
  const thatDay = appts.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show' && zonedDayKey(a.start, zone) === dayKey)

  for (const s of staff) {
    const busy = thatDay
      .filter((a) => a.staffId === s.id)
      .map((a) => ({ start: new Date(a.start), end: addMinutes(new Date(a.end), a.service.bufferMin) }))
      .sort((x, y) => x.start.getTime() - y.start.getTime())
    let cursor = open
    for (const b of [...busy, { start: close, end: close }]) {
      if (isBefore(cursor, b.start)) {
        const minutes = differenceInMinutes(b.start, cursor)
        if (minutes >= minMinutes) slots.push({ staff: s, start: instant(cursor), end: instant(b.start), minutes })
      }
      if (isBefore(cursor, b.end)) cursor = b.end
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime())
}
