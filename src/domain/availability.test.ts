import { describe, expect, it } from 'vitest'
import { buildDemoDataset } from '@/data/seed/demo'
import { getAvailability, getDayAvailability, pickStaffForSlot, type AvailabilityContext } from './availability'
import type { Appointment } from './types'

const now = new Date('2026-10-05T08:00:00.000Z') // Monday 08:00 UTC
const base = buildDemoDataset(now)
// Grid logic is easiest to read on a UTC business; time-zone behaviour has its own tests below.
base.businesses[0] = { ...base.businesses[0], timezone: 'UTC' }
const service = base.services.find((s) => s.id === 'svc_2')! // Men's haircut, 30 min, 5 min buffer
const ctx = (appointments: Appointment[] = [], extra: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  business: base.businesses[0],
  service,
  staff: base.staff,
  appointments,
  servicesById: new Map(base.services.map((s) => [s.id, s])),
  now,
  ...extra,
})
const day = new Date('2026-10-07T00:00:00.000Z') // Wednesday, open 09:00–20:00
const at = (iso: string) => new Date(iso)
const busy = (staffId: string, start: string, end: string, status: Appointment['status'] = 'confirmed'): Appointment => ({
  businessId: 'biz_1', id: `apt_${staffId}_${start}`, customerId: 'cus_1', staffId, serviceId: 'svc_1', start, end, status, source: 'phone', price: 85, reminderSent: false,
})

describe('availability engine', () => {
  it('builds a 30-minute grid inside opening hours', () => {
    const d = getDayAvailability(ctx(), day)
    expect(d.open).toBe(true)
    expect(d.slots[0].start.toISOString()).toBe('2026-10-07T09:00:00.000Z')
    expect(d.slots.at(-1)!.end.toISOString()).toBe('2026-10-07T20:00:00.000Z')
    expect(d.slots.every((s) => s.available)).toBe(true)
  })

  it('returns no slots on closed days and beyond the booking window', () => {
    expect(getDayAvailability(ctx(), new Date('2026-10-11T00:00:00.000Z')).slots).toHaveLength(0) // Sunday
    expect(getDayAvailability(ctx(), new Date('2027-01-01T00:00:00.000Z')).slots).toHaveLength(0) // > 60 days
  })

  it('enforces minimum notice', () => {
    const today = getDayAvailability(ctx(), now)
    expect(today.slots.filter((s) => s.start < at('2026-10-05T10:00:00.000Z')).every((s) => !s.available)).toBe(true)
    expect(today.slots.find((s) => s.start.toISOString() === '2026-10-05T10:00:00.000Z')!.available).toBe(true)
  })

  it('blocks a time only when every qualified staff member is busy (including buffers)', () => {
    // svc_2 is offered by stf_1 (Maya) and stf_3 (Priya)
    const both = [busy('stf_1', '2026-10-07T10:00:00.000Z', '2026-10-07T11:00:00.000Z'), busy('stf_3', '2026-10-07T10:00:00.000Z', '2026-10-07T11:00:00.000Z')]
    const d = getDayAvailability(ctx(both), day)
    const slot = (iso: string) => d.slots.find((s) => s.start.toISOString() === iso)!
    expect(slot('2026-10-07T10:30:00.000Z').available).toBe(false)
    // svc_1 buffer is 10 min → busy until 11:10, so 11:00 is still blocked
    expect(slot('2026-10-07T11:00:00.000Z').available).toBe(false)
    expect(slot('2026-10-07T11:30:00.000Z').available).toBe(true)
    const one = getDayAvailability(ctx([both[0]]), day).slots.find((s) => s.start.toISOString() === '2026-10-07T10:30:00.000Z')!
    expect(one.available).toBe(true)
    expect(one.freeStaffIds).toEqual(['stf_3'])
  })

  it('ignores cancelled appointments', () => {
    const d = getDayAvailability(ctx([busy('stf_1', '2026-10-07T10:00:00.000Z', '2026-10-07T11:00:00.000Z', 'cancelled')], { staffIds: ['stf_1'] }), day)
    expect(d.slots.find((s) => s.start.toISOString() === '2026-10-07T10:00:00.000Z')!.available).toBe(true)
  })

  it('supports a staff restriction and ignoring the booking being moved', () => {
    const own = busy('stf_1', '2026-10-07T10:00:00.000Z', '2026-10-07T10:30:00.000Z')
    expect(pickStaffForSlot(ctx([own], { staffIds: ['stf_1'] }), at('2026-10-07T10:00:00.000Z'))).toBeNull()
    expect(pickStaffForSlot(ctx([own], { staffIds: ['stf_1'], ignoreAppointmentId: own.id }), at('2026-10-07T10:00:00.000Z'))).toBe('stf_1')
    expect(pickStaffForSlot(ctx([], { staffIds: ['stf_2'] }), at('2026-10-07T10:00:00.000Z'))).toBeNull() // Jordan doesn't cut hair
  })
})

describe('availability in the business time zone', () => {
  const zoned = (timezone: string) => ctx([], { business: { ...base.businesses[0], timezone } })

  it('opening hours are wall-clock time where the business is, not where the code runs', () => {
    // Wednesday 7 Oct 2026: New York is UTC−4 (EDT), Jerusalem UTC+3 (IDT).
    const ny = getDayAvailability(zoned('America/New_York'), new Date('2026-10-07T12:00:00.000Z'))
    expect(ny.date.toISOString()).toBe('2026-10-07T04:00:00.000Z') // local midnight
    expect(ny.slots[0].start.toISOString()).toBe('2026-10-07T13:00:00.000Z') // 09:00 EDT
    expect(ny.slots.at(-1)!.end.toISOString()).toBe('2026-10-08T00:00:00.000Z') // 20:00 EDT
    const jlm = getDayAvailability(zoned('Asia/Jerusalem'), new Date('2026-10-07T12:00:00.000Z'))
    expect(jlm.slots[0].start.toISOString()).toBe('2026-10-07T06:00:00.000Z') // 09:00 IDT
  })

  it('uses the business weekday near midnight', () => {
    // 02:00 UTC Thursday is still Wednesday evening in New York.
    expect(getDayAvailability(zoned('America/New_York'), new Date('2026-10-08T02:00:00.000Z')).date.toISOString()).toBe('2026-10-07T04:00:00.000Z')
    // Sunday 11 Oct is closed for Luna; 23:00 UTC Saturday is already Sunday in Jerusalem.
    expect(getDayAvailability(zoned('Asia/Jerusalem'), new Date('2026-10-10T23:00:00.000Z')).open).toBe(false)
  })

  it('handles daylight-saving changes (opening time stays 09:00 local)', () => {
    // US clocks fall back on Sunday 1 Nov 2026; Monday 2 Nov 09:00 EST = 14:00 UTC.
    const later = { ...base.businesses[0], timezone: 'America/New_York', policies: { ...base.businesses[0].policies, maxAdvanceDays: 90 } }
    const before = getDayAvailability(ctx([], { business: later }), new Date('2026-10-26T12:00:00.000Z'))
    const after = getDayAvailability(ctx([], { business: later }), new Date('2026-11-02T12:00:00.000Z'))
    expect(before.slots[0].start.toISOString()).toBe('2026-10-26T13:00:00.000Z')
    expect(after.slots[0].start.toISOString()).toBe('2026-11-02T14:00:00.000Z')
  })

  it('a business in another zone sees the same instants regardless of the host zone', () => {
    const a = getAvailability(zoned('Asia/Jerusalem'), new Date('2026-10-06T21:30:00.000Z'), 3).map((d) => d.slots.map((s) => s.start.toISOString()))
    const b = getAvailability(zoned('Asia/Jerusalem'), new Date('2026-10-06T22:30:00.000Z'), 3).map((d) => d.slots.map((s) => s.start.toISOString()))
    expect(a).toEqual(b) // both instants are Wednesday 7 Oct in Jerusalem
  })
})
