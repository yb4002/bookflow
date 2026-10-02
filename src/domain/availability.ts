import { addMinutes, isBefore } from 'date-fns'
import { addZonedDays, atWallTime, businessZone, startOfZonedDay, zonedWeekday } from './time'
import type { Appointment, Business, ID, Service, StaffMember } from './types'

/**
 * Bookable-time rules, shared by the booking page (to display slots) and the
 * booking write path (to re-validate before saving). Pure and deterministic,
 * so the same code can run on a server. All wall-clock rules (hours, days, "today")
 * are evaluated in the business's time zone, whatever zone the code runs in.
 */

export interface TimeSlot {
  start: Date
  end: Date
  /** False when every qualified staff member is busy (or the time is too soon). */
  available: boolean
  /** Staff members free for this slot, least busy first. */
  freeStaffIds: ID[]
}

export interface DayAvailability {
  /** Midnight of the day in the business's time zone. */
  date: Date
  /** Business open on this weekday. */
  open: boolean
  slots: TimeSlot[]
}

export interface AvailabilityContext {
  business: Business
  service: Service
  staff: StaffMember[]
  appointments: Appointment[]
  /** Needed to apply each existing appointment's clean-up buffer. */
  servicesById: Map<ID, Service>
  now: Date
  /** Slot grid in minutes. */
  stepMin?: number
  /** Only these staff members may take the slot (e.g. keep the same stylist when rescheduling). */
  staffIds?: ID[]
  /** Treat this appointment as free time (the booking being rescheduled must not block itself). */
  ignoreAppointmentId?: ID
}

const BLOCKING = new Set(['confirmed', 'pending', 'completed'])

/** Busy intervals per staff member for one day (appointment + its service buffer). */
function busyByStaff(ctx: AvailabilityContext, day: Date, zone: string) {
  const dayStart = startOfZonedDay(day, zone).getTime()
  const dayEnd = addZonedDays(day, 1, zone).getTime()
  const map = new Map<ID, { start: number; end: number }[]>()
  for (const a of ctx.appointments) {
    if (!BLOCKING.has(a.status) || a.id === ctx.ignoreAppointmentId) continue
    const s = new Date(a.start).getTime()
    if (s < dayStart || s >= dayEnd) continue
    const buffer = ctx.servicesById.get(a.serviceId)?.bufferMin ?? 0
    const list = map.get(a.staffId) ?? []
    list.push({ start: s, end: new Date(a.end).getTime() + buffer * 60_000 })
    map.set(a.staffId, list)
  }
  return map
}

/** All slots for one day, available or not. */
export function getDayAvailability(ctx: AvailabilityContext, day: Date): DayAvailability {
  const zone = businessZone(ctx.business)
  const date = startOfZonedDay(day, zone)
  const weekday = zonedWeekday(date, zone)
  const atTime = (d: Date, hhmm: string) => atWallTime(d, hhmm, zone)
  const hours = ctx.business.hours[weekday]
  const lastBookableDay = addZonedDays(ctx.now, ctx.business.policies.maxAdvanceDays, zone)
  if (!hours.open || date > lastBookableDay) return { date, open: hours.open, slots: [] }

  const step = ctx.stepMin ?? 30
  const open = atTime(date, hours.start)
  const close = atTime(date, hours.end)
  const earliest = addMinutes(ctx.now, ctx.business.policies.minNoticeHours * 60)
  const qualified = ctx.staff.filter((s) => s.serviceIds.includes(ctx.service.id) && (!ctx.staffIds || ctx.staffIds.includes(s.id)))
  /** A staff member's own hours that day (null = not working). Defaults to the business's hours. */
  const shift = new Map(
    qualified.map((s) => {
      const h = s.availability?.[weekday]
      if (!s.availability) return [s.id, { start: open, end: close }] as const
      return [s.id, h?.open ? { start: atTime(date, h.start), end: atTime(date, h.end) } : null] as const
    }),
  )
  const busy = busyByStaff(ctx, date, zone)
  const load = (id: ID) => busy.get(id)?.length ?? 0
  const slots: TimeSlot[] = []

  for (let start = open; !isBefore(close, addMinutes(start, ctx.service.durationMin)); start = addMinutes(start, step)) {
    const end = addMinutes(start, ctx.service.durationMin)
    const s = start.getTime()
    const blockedUntil = end.getTime() + ctx.service.bufferMin * 60_000
    const freeStaffIds = isBefore(start, earliest)
      ? []
      : qualified
          .filter((st) => {
            const own = shift.get(st.id)
            if (!own || start < own.start || end > own.end) return false // outside their working hours
            return !(busy.get(st.id) ?? []).some((b) => b.start < blockedUntil && b.end > s)
          })
          .sort((a, b) => load(a.id) - load(b.id))
          .map((st) => st.id)
    slots.push({ start, end, available: freeStaffIds.length > 0, freeStaffIds })
  }
  return { date, open: true, slots }
}

/** Availability for `days` consecutive days starting at `from`. */
export function getAvailability(ctx: AvailabilityContext, from: Date, days: number): DayAvailability[] {
  const zone = businessZone(ctx.business)
  return Array.from({ length: days }, (_, i) => getDayAvailability(ctx, addZonedDays(from, i, zone)))
}

/**
 * Would `staffId` be double-booked from `start` for `service` (its buffer included)?
 * Used for appointments the business enters by hand, which may fall outside the online grid.
 */
export function hasConflict(ctx: Pick<AvailabilityContext, 'appointments' | 'servicesById' | 'service' | 'ignoreAppointmentId'>, staffId: ID, start: Date): boolean {
  const s = start.getTime()
  const blockedUntil = s + (ctx.service.durationMin + ctx.service.bufferMin) * 60_000
  return ctx.appointments.some((a) => {
    if (a.staffId !== staffId || !BLOCKING.has(a.status) || a.id === ctx.ignoreAppointmentId) return false
    const aStart = new Date(a.start).getTime()
    const aEnd = new Date(a.end).getTime() + (ctx.servicesById.get(a.serviceId)?.bufferMin ?? 0) * 60_000
    return aStart < blockedUntil && aEnd > s
  })
}

/** Re-checks a single requested start time; returns the staff member to assign, or null if taken. */
export function pickStaffForSlot(ctx: AvailabilityContext, start: Date): ID | null {
  const slot = getDayAvailability(ctx, start).slots.find((s) => s.start.getTime() === start.getTime())
  return slot?.available ? slot.freeStaffIds[0] : null
}
