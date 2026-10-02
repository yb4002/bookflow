import { describe, expect, it } from 'vitest'
import { addZonedDays, atWallTime, fromLocalDateTime, isSameZonedDay, isValidTimeZone, minutesIntoZonedDay, startOfZonedDay, toLocalDateString, toLocalTimeString, zonedDate, zonedDayDiff, zonedHour, zonedMinutes, zonedWeekday } from './time'
import { createFormatters } from '@/i18n/formatters'
import { LOCALES } from '@/i18n/config'
import { catalogs } from '@/i18n/locales'

describe('business time', () => {
  it('converts wall-clock times to instants in the business zone', () => {
    expect(atWallTime(new Date('2026-10-07T12:00:00Z'), '09:30', 'Asia/Jerusalem').toISOString()).toBe('2026-10-07T06:30:00.000Z')
    expect(atWallTime(new Date('2026-10-07T12:00:00Z'), '09:30', 'America/Los_Angeles').toISOString()).toBe('2026-10-07T16:30:00.000Z')
  })

  it('computes local midnight, day steps across DST, weekdays and day differences', () => {
    expect(startOfZonedDay(new Date('2026-10-08T02:00:00Z'), 'America/New_York').toISOString()).toBe('2026-10-07T04:00:00.000Z')
    expect(addZonedDays(new Date('2026-10-31T12:00:00Z'), 2, 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z')
    // Israel leaves summer time at 02:00 on Sunday 25 Oct 2026: that midnight is +3, the next one +2.
    expect(addZonedDays(new Date('2026-10-24T12:00:00Z'), 1, 'Asia/Jerusalem').toISOString()).toBe('2026-10-24T21:00:00.000Z')
    expect(addZonedDays(new Date('2026-10-24T12:00:00Z'), 2, 'Asia/Jerusalem').toISOString()).toBe('2026-10-25T22:00:00.000Z')
    expect(zonedWeekday('2026-10-10T23:00:00Z', 'Asia/Jerusalem')).toBe(0)
    expect(zonedWeekday('2026-10-10T23:00:00Z', 'America/New_York')).toBe(6)
    expect(isSameZonedDay('2026-10-07T03:00:00Z', '2026-10-06T15:00:00Z', 'America/New_York')).toBe(true)
    expect(zonedDayDiff('2026-10-06T23:30:00Z', '2026-10-07T00:30:00Z', 'UTC')).toBe(1)
    expect(zonedDayDiff('2026-10-06T23:30:00Z', '2026-10-07T00:30:00Z', 'America/New_York')).toBe(0)
    expect(minutesIntoZonedDay('2026-10-07T13:15:00Z', 'America/New_York')).toBe(9 * 60 + 15)
  })

  it('cached calendar helpers agree with TZDate around DST changes and in odd-offset zones', () => {
    const zones = ['UTC', 'Asia/Jerusalem', 'America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'Pacific/Chatham', 'America/St_Johns']
    // Every 37 minutes across both 2026 DST seasons (spring and autumn transitions): not a multiple
    // of 15, so samples land at every position inside the 15-minute offset-cache buckets.
    const ranges = [[Date.UTC(2026, 2, 25), Date.UTC(2026, 3, 8)], [Date.UTC(2026, 9, 20), Date.UTC(2026, 10, 3)]]
    for (const zone of zones) {
      for (const [from, to] of ranges) {
        for (let t = from; t < to; t += 37 * 60_000) {
          const z = zonedDate(t, zone)
          const d = new Date(t)
          expect([zonedWeekday(d, zone), zonedHour(d, zone), zonedMinutes(d, zone), minutesIntoZonedDay(d, zone)], `${zone} ${d.toISOString()}`).toEqual([z.getDay(), z.getHours(), z.getMinutes(), z.getHours() * 60 + z.getMinutes()])
          expect(toLocalDateString(d, zone)).toBe(`${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`)
        }
      }
    }
  })

  it('round-trips local dates and times for form inputs', () => {
    expect(toLocalDateString('2026-10-08T02:00:00Z', 'America/New_York')).toBe('2026-10-07')
    expect(fromLocalDateTime('2026-10-07', '14:30', 'Asia/Jerusalem').toISOString()).toBe('2026-10-07T11:30:00.000Z')
    expect(toLocalTimeString('2026-10-07T11:30:00Z', 'Asia/Jerusalem')).toBe('14:30')
    expect(fromLocalDateTime('2026-11-02', undefined, 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z')
  })

  it('validates IANA zone names', () => {
    expect(isValidTimeZone('Asia/Jerusalem')).toBe(true)
    expect(isValidTimeZone('Nowhere/Land')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(42)).toBe(false)
  })

  it('formats dates and times in the business zone, not the host zone', () => {
    const he = createFormatters(LOCALES.he, catalogs.he, 'Asia/Jerusalem')
    const en = createFormatters(LOCALES.en, catalogs.en, 'America/New_York')
    const at = new Date('2026-10-07T07:00:00Z')
    expect(he.time(at)).toBe('10:00')
    expect(en.time(at)).toBe('3:00 AM')
    expect(en.weekdayName(0)).toBe('Sunday')
    expect(he.weekdayName(5)).toBe('יום שישי')
    // "Today" is the business's today.
    expect(en.friendlyDate('2026-10-07T03:00:00Z', new Date('2026-10-06T15:00:00Z'))).toBe(catalogs.en.common.today)
    expect(createFormatters(LOCALES.en, catalogs.en, 'UTC').friendlyDate('2026-10-07T03:00:00Z', new Date('2026-10-06T15:00:00Z'))).toBe(catalogs.en.common.tomorrow)
  })
})
