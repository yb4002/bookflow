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

/*
 * Hot-path helpers. Calendar questions about many instants (dashboards, Smart Fill ranking,
 * grouping by day) only need the zone's UTC offset at each instant. Offsets are cached per
 * zone in 15-minute buckets (every real-world transition falls on a 15-minute boundary), so
 * these cost a Map lookup instead of a TZDate construction.
 */
const BUCKET_MS = 15 * 60_000
const DAY_MS = 86_400_000
const offsetFormats = new Map<TimeZone, Intl.DateTimeFormat>()
const offsetCache = new Map<TimeZone, Map<number, number>>()

/** UTC offset of `zone` at instant `t` (ms since epoch), in milliseconds (e.g. +3 h = 10_800_000). */
export function zoneOffsetMs(t: number, zone: TimeZone): number {
  let cache = offsetCache.get(zone)
  if (!cache) offsetCache.set(zone, (cache = new Map()))
  const bucket = Math.floor(t / BUCKET_MS)
  const hit = cache.get(bucket)
  if (hit !== undefined) return hit
  let fmt = offsetFormats.get(zone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    offsetFormats.set(zone, fmt)
  }
  const at = bucket * BUCKET_MS
  const p: Record<string, number> = {}
  for (const part of fmt.formatToParts(at)) if (part.type !== 'literal') p[part.type] = Number(part.value)
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - at
  if (cache.size > 100_000) cache.clear() // bound memory in long-running processes
  cache.set(bucket, offset)
  return offset
}

const ms = (d: Date | string | number) => (typeof d === 'string' ? Date.parse(d) : +d)
/** Wall-clock milliseconds of an instant in `zone` (as if that wall clock were UTC). */
const wallMs = (d: Date | string | number, zone: TimeZone) => {
  const t = ms(d)
  return t + zoneOffsetMs(t, zone)
}

/** The calendar day of an instant in `zone`, as a day number (equal numbers = same local day). */
export const zonedDayKey = (d: Date | string | number, zone: TimeZone) => Math.floor(wallMs(d, zone) / DAY_MS)

/** Weekday (0 = Sunday) of an instant in `zone`. */
export const zonedWeekday = (d: Date | string, zone: TimeZone) => (((zonedDayKey(d, zone) + 4) % 7) + 7) % 7 as 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Hours/minutes of an instant in `zone`. */
export const zonedHour = (d: Date | string, zone: TimeZone) => Math.floor((((wallMs(d, zone) % DAY_MS) + DAY_MS) % DAY_MS) / 3_600_000)
export const zonedMinutes = (d: Date | string, zone: TimeZone) => Math.floor((((wallMs(d, zone) % 3_600_000) + 3_600_000) % 3_600_000) / 60_000)

/** True when both instants fall on the same calendar day in `zone`. */
export const isSameZonedDay = (a: Date | string, b: Date | string, zone: TimeZone) => zonedDayKey(a, zone) === zonedDayKey(b, zone)

/** Whole calendar days from `a` to `b` in `zone` (b − a). */
export const zonedDayDiff = (a: Date | string, b: Date | string, zone: TimeZone) => zonedDayKey(b, zone) - zonedDayKey(a, zone)

/** Minutes since local midnight in `zone` (for positioning on a day grid). */
export const minutesIntoZonedDay = (d: Date | string, zone: TimeZone) => Math.floor((((wallMs(d, zone) % DAY_MS) + DAY_MS) % DAY_MS) / 60_000)

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
