import { tz, TZDate } from '@date-fns/tz'

/**
 * Business time. Every wall-clock rule (opening hours, "today", weekdays, slot grids) is
 * evaluated in the business's IANA time zone — never the server's or the viewer's.
 * Instants are stored and exchanged as UTC ISO strings; only calendar math is zoned.
 */
export type TimeZone = string

/** Fallback when a record has no (valid) zone. */
export const DEFAULT_TIME_ZONE = 'UTC'

/** `{ in }` context for date-fns v4 functions: `startOfDay(d, inZone(zone))`. */
export const inZone = (zone: TimeZone) => ({ in: tz(zone) })

/** A date whose getters (getHours, getDay…) read wall-clock values in `zone`. */
export const zonedDate = (d: Date | string | number, zone: TimeZone) => new TZDate(typeof d === 'string' ? new Date(d).getTime() : +d, zone)

/** Drops the zone (back to a plain instant) — use before returning/serializing results. */
export const instant = (d: Date) => new Date(d.getTime())

/** The UTC instant of wall-clock `hh:mm` on the zoned calendar day of `day`. Handles DST. */
export function atWallTime(day: Date, hhmm: string, zone: TimeZone): Date {
  const z = zonedDate(day, zone)
  const [h, m] = hhmm.split(':').map(Number)
  return instant(new TZDate(z.getFullYear(), z.getMonth(), z.getDate(), h, m, 0, 0, zone))
}

/** Midnight (start of the calendar day) in `zone`, as an instant. */
export function startOfZonedDay(d: Date, zone: TimeZone): Date {
  const z = zonedDate(d, zone)
  return instant(new TZDate(z.getFullYear(), z.getMonth(), z.getDate(), 0, 0, 0, 0, zone))
}

/** Same wall-clock day `n` days later in `zone` (DST-safe), as midnight. */
export function addZonedDays(d: Date, n: number, zone: TimeZone): Date {
  const z = zonedDate(d, zone)
  return instant(new TZDate(z.getFullYear(), z.getMonth(), z.getDate() + n, 0, 0, 0, 0, zone))
}

/** Weekday (0 = Sunday) of an instant in `zone`. */
export const zonedWeekday = (d: Date | string, zone: TimeZone) => zonedDate(d, zone).getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Hours/minutes of an instant in `zone`. */
export const zonedHour = (d: Date | string, zone: TimeZone) => zonedDate(d, zone).getHours()
export const zonedMinutes = (d: Date | string, zone: TimeZone) => zonedDate(d, zone).getMinutes()

/** True when both instants fall on the same calendar day in `zone`. */
export const isSameZonedDay = (a: Date | string, b: Date | string, zone: TimeZone) => {
  const x = zonedDate(a, zone)
  const y = zonedDate(b, zone)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

/** Whole calendar days from `a` to `b` in `zone` (b − a). */
export function zonedDayDiff(a: Date | string, b: Date | string, zone: TimeZone) {
  const x = zonedDate(a, zone)
  const y = zonedDate(b, zone)
  return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 86_400_000)
}

/** Minutes since local midnight in `zone` (for positioning on a day grid). */
export const minutesIntoZonedDay = (d: Date | string, zone: TimeZone) => {
  const z = zonedDate(d, zone)
  return z.getHours() * 60 + z.getMinutes()
}

/** Validates an IANA zone name. */
export function isValidTimeZone(zone: unknown): zone is TimeZone {
  if (typeof zone !== 'string' || !zone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(zone)
  } catch {
    return false
  }
}

/** The zone to use for a business record (falls back safely on bad data). */
export const businessZone = (b: { timezone?: string } | undefined) => (b?.timezone && isValidTimeZone(b.timezone) ? b.timezone : DEFAULT_TIME_ZONE)

/** `YYYY-MM-DD` of an instant on the business's calendar (for `<input type="date">`). */
export function toLocalDateString(d: Date | string, zone: TimeZone): string {
  const z = zonedDate(d, zone)
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`
}

/** Instant of wall-clock `hh:mm` on local date `YYYY-MM-DD` in `zone` (midnight by default). */
export function fromLocalDateTime(ymd: string, hhmm = '00:00', zone: TimeZone): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const [h, min] = hhmm.split(':').map(Number)
  return instant(new TZDate(y, m - 1, d, h, min, 0, 0, zone))
}

/** `HH:mm` (24h) of an instant in `zone`, for `<input type="time">`. */
export const toLocalTimeString = (d: Date | string, zone: TimeZone) => {
  const z = zonedDate(d, zone)
  return `${String(z.getHours()).padStart(2, '0')}:${String(z.getMinutes()).padStart(2, '0')}`
}
