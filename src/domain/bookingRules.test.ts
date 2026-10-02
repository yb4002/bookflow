import { describe, expect, it } from 'vitest'
import { applyCancellation, applyReschedule, assertChangeable, generateReference, slugify, splitName, validateCustomerInput, validateSlug } from './bookingRules'
import { BookingError } from './errors'
import type { Appointment } from './types'

const now = new Date('2026-10-05T08:00:00.000Z')
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  businessId: 'biz_1',
  id: 'apt_1',
  customerId: 'cus_1',
  staffId: 'stf_1',
  serviceId: 'svc_1',
  start: '2026-10-08T10:00:00.000Z',
  end: '2026-10-08T11:00:00.000Z',
  status: 'confirmed',
  source: 'online',
  price: 85,
  reminderSent: true,
  reference: 'ABC234',
  ...over,
})
const policies = { policies: { cancellationWindowHours: 24 } } as Parameters<typeof assertChangeable>[1]
const code = (fn: () => void) => {
  try {
    fn()
  } catch (e) {
    return (e as BookingError).code
  }
  return 'ok'
}

describe('customer input', () => {
  it('requires a real name and phone', () => {
    expect(validateCustomerInput('Dana Levi', '050-123-4567')).toEqual({ name: false, phone: false })
    expect(validateCustomerInput(' a ', '050-123-4567').name).toBe(true)
    expect(validateCustomerInput('Dana', '12345').phone).toBe(true)
    expect(validateCustomerInput('Dana', '050-ABC-4567').phone).toBe(true)
  })
  it('splits names, tolerating single words and extra spaces', () => {
    expect(splitName('  Dana   Levi Cohen ')).toEqual({ firstName: 'Dana', lastName: 'Levi Cohen' })
    expect(splitName('נועה')).toEqual({ firstName: 'נועה', lastName: '' })
  })
})

describe('change window', () => {
  it('allows changes outside the window only', () => {
    expect(code(() => assertChangeable(appt(), policies, now))).toBe('ok')
    expect(code(() => assertChangeable(appt({ start: '2026-10-05T20:00:00.000Z' }), policies, now))).toBe('change_window_closed')
    expect(code(() => assertChangeable(appt({ start: '2026-10-05T07:00:00.000Z' }), policies, now))).toBe('not_changeable')
    expect(code(() => assertChangeable(appt({ status: 'cancelled' }), policies, now))).toBe('already_cancelled')
    expect(code(() => assertChangeable(appt({ status: 'completed' }), policies, now))).toBe('not_changeable')
  })
})

describe('state transitions', () => {
  it('reschedule keeps service, price, staff and duration and records the old time', () => {
    const moved = applyReschedule(appt(), new Date('2026-10-09T14:30:00.000Z'), now)
    expect(moved).toMatchObject({ serviceId: 'svc_1', price: 85, staffId: 'stf_1', start: '2026-10-09T14:30:00.000Z', end: '2026-10-09T15:30:00.000Z', previousStart: '2026-10-08T10:00:00.000Z', reminderSent: false })
  })
  it('reschedule to the same time is rejected', () => {
    expect(code(() => applyReschedule(appt(), new Date('2026-10-08T10:00:00.000Z'), now))).toBe('invalid_input')
  })
  it('cancellation records who, when and why', () => {
    expect(applyCancellation(appt(), 'customer', now, 'unwell')).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', cancellationReason: 'unwell', cancelledAt: now.toISOString() })
  })
})

describe('references and slugs', () => {
  it('generates unique, unambiguous references', () => {
    const taken = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const ref = generateReference((r) => taken.has(r))
      expect(ref).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
      expect(taken.has(ref)).toBe(false)
      taken.add(ref)
    }
  })
  it('validates slugs', () => {
    expect(slugify('Luna Hair Studio!')).toBe('luna-hair-studio')
    expect(code(() => validateSlug('luna-hair', () => false))).toBe('ok')
    expect(code(() => validateSlug('Luna Hair', () => false))).toBe('invalid_slug')
    expect(code(() => validateSlug('ab', () => false))).toBe('invalid_slug')
    expect(code(() => validateSlug('app', () => false))).toBe('invalid_slug')
    expect(code(() => validateSlug('glow-lab', () => true))).toBe('slug_taken')
  })
})
