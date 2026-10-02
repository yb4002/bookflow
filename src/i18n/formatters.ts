import { zonedDayDiff, zonedMinutes } from '@/domain/time'
import type { LocaleConfig } from './config'
import type { Messages } from './locales/en'
import { interpolate } from './plural'

type DateInput = string | number | Date
const toDate = (d: DateInput) => (d instanceof Date ? d : new Date(d))

/**
 * Locale-aware formatting built on Intl. Created once per locale and exposed
 * through `useI18n().f`. Components must not format dates/numbers themselves.
 * Dates and times are shown in `timeZone` (the business's zone) — not the viewer's —
 * so a salon's 10:00 reads 10:00 for everyone. Omit it to use the runtime's zone.
 */
export function createFormatters(cfg: LocaleConfig, t: Messages, timeZone?: string) {
  const L = cfg.intl
  const currency = cfg.currency
  const cache = new Map<string, Intl.DateTimeFormat>()
  const dtf = (o: Intl.DateTimeFormatOptions) => {
    const key = JSON.stringify(o)
    let f = cache.get(key)
    if (!f) cache.set(key, (f = new Intl.DateTimeFormat(L, timeZone ? { ...o, timeZone } : o)))
    return f
  }
  const numberFmt = new Intl.NumberFormat(L)
  const relativeFmt = new Intl.RelativeTimeFormat(L, { numeric: 'auto' })
  const moneyFmt = new Intl.NumberFormat(L, { style: 'currency', currency, maximumFractionDigits: 0 })
  const currencySymbol =
    new Intl.NumberFormat(L, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? currency
  const cycle = dtf({ hour: 'numeric' }).resolvedOptions().hourCycle
  const uses12h = cycle === 'h11' || cycle === 'h12'

  const time = (d: DateInput) => dtf({ hour: 'numeric', minute: '2-digit' }).format(toDate(d))
  const dateMedium = (d: DateInput) => dtf({ weekday: 'short', month: 'short', day: 'numeric' }).format(toDate(d))

  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const weekdayFmt = { long: new Intl.DateTimeFormat(L, { weekday: 'long', timeZone: 'UTC' }), short: new Intl.DateTimeFormat(L, { weekday: 'short', timeZone: 'UTC' }) }

  return {
    locale: L,
    /** IANA zone dates are displayed in. */
    timeZone: zone,
    number: (n: number) => numberFmt.format(n),
    /** ISO code of the active currency, e.g. "USD" / "ILS". */
    currency,
    /** Display symbol of the active currency, e.g. "$" / "₪". */
    currencySymbol,
    /** Whole-unit amount in the active currency: "$85" / "‏85 ‏₪". */
    money: (n: number) => moneyFmt.format(n),
    percent: (ratio: number, digits = 0) =>
      new Intl.NumberFormat(L, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(ratio),

    /** "9:30 AM" / "9:30" */
    time,
    /** Same-day time range using the locale's range convention: "9:00 – 10:30 AM" / "9:00–10:30". */
    timeRange: (from: DateInput, to: DateInput) =>
      dtf({ hour: 'numeric', minute: '2-digit' }).formatRange(toDate(from), toDate(to)),
    /** Clock face without the day period: "9:30" in every locale (for compact schedules). */
    clock: (d: DateInput) =>
      dtf({ hour: 'numeric', minute: '2-digit' })
        .formatToParts(toDate(d))
        .filter((p) => p.type !== 'dayPeriod')
        .map((p) => p.value)
        .join('')
        .trim(),
    /** Drops ":00" only where a 12h clock keeps it unambiguous: "9 AM", but "9:00" in 24h locales. */
    shortTime: (d: DateInput) => {
      const date = toDate(d)
      return uses12h && zonedMinutes(date, zone) === 0 ? dtf({ hour: 'numeric' }).format(date) : time(date)
    },
    day: (d: DateInput) => dtf({ day: 'numeric' }).format(toDate(d)),
    weekdayShort: (d: DateInput) => dtf({ weekday: 'short' }).format(toDate(d)),
    weekdayNarrow: (d: DateInput) => dtf({ weekday: 'narrow' }).format(toDate(d)),
    weekdayLong: (d: DateInput) => dtf({ weekday: 'long' }).format(toDate(d)),
    /** Name of a weekday index (0 = Sunday), e.g. for opening-hours rows. */
    weekdayName: (index: number, width: 'long' | 'short' = 'long') => weekdayFmt[width].format(new Date(Date.UTC(2024, 0, 7 + index, 12))),
    monthDay: (d: DateInput) => dtf({ month: 'short', day: 'numeric' }).format(toDate(d)),
    /** "Wed, Sep 30" */
    dateMedium,
    /** "Wednesday, September 30" */
    dateLong: (d: DateInput) => dtf({ weekday: 'long', month: 'long', day: 'numeric' }).format(toDate(d)),
    /** "Sep 2026" */
    monthYear: (d: DateInput) => dtf({ month: 'short', year: 'numeric' }).format(toDate(d)),
    /** "Sep 28 – Oct 4, 2026" */
    dateRange: (from: DateInput, to: DateInput) =>
      dtf({ month: 'short', day: 'numeric', year: 'numeric' }).formatRange(toDate(from), toDate(to)),
    /** "Today" / "Tomorrow" / "Yesterday" / "Wed, Sep 30" */
    friendlyDate: (d: DateInput, now: Date = new Date()) => {
      const date = toDate(d)
      const diff = zonedDayDiff(now, date, zone)
      if (diff === 0) return t.common.today
      if (diff === 1) return t.common.tomorrow
      if (diff === -1) return t.common.yesterday
      return dateMedium(date)
    },
    /** "18 minutes ago" / "in 3 hours" / "yesterday" — picks the largest sensible unit. */
    relative: (d: DateInput, now: Date = new Date()) => {
      const minutes = Math.round((toDate(d).getTime() - now.getTime()) / 60_000)
      if (Math.abs(minutes) < 60) return relativeFmt.format(minutes, 'minute')
      const hours = Math.round(minutes / 60)
      if (Math.abs(hours) < 24) return relativeFmt.format(hours, 'hour')
      return relativeFmt.format(Math.round(hours / 24), 'day')
    },
    /** "1 h 30 min" */
    duration: (min: number) => {
      const h = Math.floor(min / 60)
      const m = min % 60
      if (!h) return interpolate(t.duration.minutes, { m: numberFmt.format(m) })
      if (!m) return interpolate(t.duration.hours, { h: numberFmt.format(h) })
      return interpolate(t.duration.hoursMinutes, { h: numberFmt.format(h), m: numberFmt.format(m) })
    },
  }
}

export type Formatters = ReturnType<typeof createFormatters>
