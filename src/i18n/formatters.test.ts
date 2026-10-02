import { describe, expect, it } from 'vitest'
import { LOCALES } from './config'
import { createFormatters } from './formatters'
import { catalogs } from './locales'

const strip = (s: string) => s.replace(/[‎‏ ]/g, ' ').replace(/\s+/g, ' ').trim()

describe('locale-aware formatting', () => {
  it('uses USD for English and ILS for Hebrew by default', () => {
    expect(createFormatters(LOCALES.en, catalogs.en).money(85)).toBe('$85')
    expect(strip(createFormatters(LOCALES.he, catalogs.he).money(85))).toBe('85 ₪')
  })
  it('honours a business currency override', () => {
    expect(strip(createFormatters({ ...LOCALES.en, currency: 'ILS' }, catalogs.en).money(85))).toBe('₪85')
    expect(strip(createFormatters({ ...LOCALES.he, currency: 'USD' }, catalogs.he).money(85))).toBe('85 $')
  })
  it('formats durations and 24h/12h times per locale', () => {
    const d = new Date('2026-10-05T15:30:00.000Z')
    expect(createFormatters(LOCALES.en, catalogs.en).duration(90)).toBe('1 h 30 min')
    expect(createFormatters(LOCALES.he, catalogs.he).duration(90)).toBe('1 ש׳ 30 דק׳')
    expect(createFormatters(LOCALES.en, catalogs.en).time(d)).toMatch(/3:30\sPM/)
    expect(createFormatters(LOCALES.he, catalogs.he).time(d)).toBe('15:30')
  })
})

describe('bidi isolation of interpolated values', async () => {
  const { interpolate, isolationFor } = await import('./plural')
  const FSI = '⁨'
  it('always isolates in right-to-left text', () => {
    expect(interpolate('{n} · {staff} פנוי', { n: 3, staff: 'Priya' }, isolationFor('rtl'))).toBe(`${FSI}3⁩ · ${FSI}Priya⁩ פנוי`)
  })
  it('only isolates right-to-left values in left-to-right text', () => {
    expect(interpolate('Showing {n} of {t}', { n: 240, t: 240 }, isolationFor('ltr'))).toBe('Showing 240 of 240')
    expect(interpolate('Cancelled by {name}', { name: 'נועה בר' }, isolationFor('ltr'))).toBe(`Cancelled by ${FSI}נועה בר⁩`)
  })
})
