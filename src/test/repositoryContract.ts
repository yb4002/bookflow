import { minutesIntoZonedDay, zonedWeekday } from '@/domain/time'
import { describe, expect, it, vi } from 'vitest'
import { buildDemoDataset, type Dataset } from '@/data/seed/demo'
import { BookingError } from '@/domain/errors'
import { findFillOpportunities } from '@/features/smartFill/matching'
import { findSlot, NOW, type ContractEnv } from './fixtures'

/** Creates a fresh environment (optionally with a custom seed / acting business). */
export type EnvFactory = (options?: { seed?: () => Dataset; businessId?: string }) => ContractEnv

/**
 * Behavioural contract every BookFlowRepository implementation must satisfy.
 * Run against the local (browser) and SQL (server) implementations.
 */
export function runRepositoryContract(name: string, createTestEnv: EnvFactory) {
describe(`${name}: repository contract`, () => {

const SLUG = 'luna-hair'
const errorCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof BookingError ? e.code : String(e)))
const guest = { name: 'Dana Levi', phone: '(555) 010-2030', remindersOptIn: true }

describe('booking lifecycle (persisted)', () => {
  it('creates a booking that persists across reloads and shows on the dashboard', async () => {
    const env = createTestEnv()
    const slot = await findSlot(env, 'svc_1')
    const booking = await env.repo.createBooking(SLUG, { ...guest, serviceId: 'svc_1', start: slot.start.toISOString(), notes: 'Window seat' })

    expect(booking).toMatchObject({ status: 'confirmed', source: 'online', price: 85, serviceId: 'svc_1', notes: 'Window seat' })
    expect(booking.reference).toMatch(/^[A-Z2-9]{6}$/)
    expect(booking.customer).toMatchObject({ firstName: 'Dana', lastName: 'Levi', tags: ['New'] })

    const after = env.reload()
    expect(await after.repo.getBookingByReference(SLUG, booking.manageToken!)).toMatchObject({ id: booking.id, start: slot.start.toISOString() })
    // The short reference is a display code, not a key: it never opens the booking.
    expect(booking.manageToken).toMatch(/^[0-9a-f]{32}$/)
    expect(await after.repo.getBookingByReference(SLUG, booking.reference!)).toBeUndefined()
    const dashboard = await after.repo.listAppointments({ customerId: booking.customerId })
    expect(dashboard.map((a) => a.id)).toEqual([booking.id])
    const clients = await after.repo.listCustomers()
    expect(clients.find((c) => c.id === booking.customerId)?.nextAppointment).toBe(slot.start.toISOString())
  })

  it('recognises returning clients by phone instead of duplicating them', async () => {
    const env = createTestEnv()
    const a = await env.repo.createBooking(SLUG, { ...guest, serviceId: 'svc_2', start: (await findSlot(env, 'svc_2')).start.toISOString() })
    const b = await env.repo.createBooking(SLUG, { ...guest, phone: '555 010 2030', serviceId: 'svc_2', start: (await findSlot(env, 'svc_2', { minDaysAhead: 5 })).start.toISOString() })
    expect(b.customerId).toBe(a.customerId)
  })

  it('never double-books: a taken slot is rejected and shows as unavailable', async () => {
    const env = createTestEnv()
    const slot = await findSlot(env, 'svc_1', { staffId: 'stf_3' })
    await env.repo.createBooking(SLUG, { ...guest, serviceId: 'svc_1', staffId: 'stf_3', start: slot.start.toISOString() })
    expect(await errorCode(env.repo.createBooking(SLUG, { ...guest, phone: '555-777-0000', serviceId: 'svc_1', staffId: 'stf_3', start: slot.start.toISOString() }))).toBe('slot_unavailable')
    const days = await env.repo.getAvailability(SLUG, 'svc_1', NOW, 14, 'stf_3')
    expect(days.flatMap((d) => d.slots).find((s) => s.start.getTime() === slot.start.getTime())?.available).toBe(false)
  })

  it('stores the chosen staff member and only offers qualified staff', async () => {
    const env = createTestEnv()
    const slot = await findSlot(env, 'svc_1', { staffId: 'stf_3' })
    const booking = await env.repo.createBooking(SLUG, { ...guest, serviceId: 'svc_1', staffId: 'stf_3', start: slot.start.toISOString() })
    expect(booking.staffId).toBe('stf_3')
    // Jordan (stf_2) doesn't do haircuts: no availability at all
    const jordan = await env.repo.getAvailability(SLUG, 'svc_1', NOW, 14, 'stf_2')
    expect(jordan.flatMap((d) => d.slots).some((s) => s.available)).toBe(false)
  })

  it('validates customer input on the write path', async () => {
    const env = createTestEnv()
    const start = (await findSlot(env, 'svc_1')).start.toISOString()
    expect(await errorCode(env.repo.createBooking(SLUG, { ...guest, name: 'D', serviceId: 'svc_1', start }))).toBe('invalid_input')
    expect(await errorCode(env.repo.createBooking(SLUG, { ...guest, phone: '12', serviceId: 'svc_1', start }))).toBe('invalid_input')
    expect(await errorCode(env.repo.createBooking(SLUG, { ...guest, serviceId: 'svc_6', start }))).toBe('invalid_input') // inactive service
    expect(await errorCode(env.repo.createBooking('nope', { ...guest, serviceId: 'svc_1', start }))).toBe('not_found')
  })

  it('reschedules: same service, price, duration and staff; old time freed; persisted', async () => {
    const env = createTestEnv()
    const first = await findSlot(env, 'svc_1', { minDaysAhead: 3 })
    const booking = await env.repo.createBooking(SLUG, { ...guest, serviceId: 'svc_1', start: first.start.toISOString() })
    const options = await env.repo.getRescheduleAvailability(SLUG, booking.manageToken!, NOW, 14)
    const target = options.slice(5).flatMap((d) => d.slots).find((s) => s.available)!
    expect(target.freeStaffIds).toEqual([booking.staffId])

    const moved = await env.repo.rescheduleBooking(SLUG, booking.manageToken!, target.start.toISOString())
    expect(moved).toMatchObject({ id: booking.id, reference: booking.reference, serviceId: 'svc_1', price: 85, staffId: booking.staffId, previousStart: first.start.toISOString(), start: target.start.toISOString() })
    expect(new Date(moved.end).getTime() - new Date(moved.start).getTime()).toBe(60 * 60_000)

    const reloaded = env.reload()
    expect((await reloaded.repo.getBookingByReference(SLUG, booking.manageToken!))?.start).toBe(target.start.toISOString())
    const days = await reloaded.repo.getAvailability(SLUG, 'svc_1', NOW, 14, booking.staffId)
    expect(days.flatMap((d) => d.slots).find((s) => s.start.getTime() === first.start.getTime())?.available).toBe(true)
  })

  it('cancels with a reason, frees the slot, and Smart Fill detects it after a reload', async () => {
    const env = createTestEnv()
    const slot = await findSlot(env, 'svc_1', { minDaysAhead: 3, staffId: 'stf_1' })
    const booking = await env.repo.createBooking(SLUG, { ...guest, serviceId: 'svc_1', staffId: 'stf_1', start: slot.start.toISOString() })
    const cancelled = await env.repo.cancelBooking(SLUG, booking.manageToken!, 'schedule_conflict')
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', cancellationReason: 'schedule_conflict', cancelledAt: NOW.toISOString() })
    expect(await errorCode(env.repo.cancelBooking(SLUG, booking.manageToken!))).toBe('already_cancelled')

    const reloaded = env.reload()
    const days = await reloaded.repo.getAvailability(SLUG, 'svc_1', NOW, 14, 'stf_1')
    expect(days.flatMap((d) => d.slots).find((s) => s.start.getTime() === slot.start.getTime())?.available).toBe(true)
    const history = await reloaded.repo.listAppointments({ from: new Date(NOW.getTime() - 150 * 864e5), to: new Date(NOW.getTime() + 21 * 864e5) })
    const opportunities = findFillOpportunities(history, NOW)
    expect(opportunities.map((o) => o.appointment.id)).toContain(booking.id)
  })

  it('blocks online changes inside the change window', async () => {
    const env = createTestEnv()
    const soon = (await env.repo.getAvailability(SLUG, 'svc_2', NOW, 1))[0].slots.find((s) => s.available)!
    const booking = await env.repo.createBooking(SLUG, { ...guest, serviceId: 'svc_2', start: soon.start.toISOString() })
    expect(await errorCode(env.repo.cancelBooking(SLUG, booking.manageToken!))).toBe('change_window_closed')
    expect(await errorCode(env.repo.rescheduleBooking(SLUG, booking.manageToken!, soon.end.toISOString()))).toBe('change_window_closed')
    expect(await errorCode(env.repo.getRescheduleAvailability(SLUG, booking.manageToken!, NOW, 14))).toBe('change_window_closed')
  })

  it('rejects rescheduling into a taken slot', async () => {
    const env = createTestEnv()
    const booking = await env.repo.createBooking(SLUG, { ...guest, serviceId: 'svc_1', staffId: 'stf_1', start: (await findSlot(env, 'svc_1', { minDaysAhead: 3, staffId: 'stf_1' })).start.toISOString() })
    const options = await env.repo.getRescheduleAvailability(SLUG, booking.manageToken!, NOW, 14)
    const target = options.slice(6).flatMap((d) => d.slots).find((s) => s.available)!
    // Another client takes that stylist at that time first
    await env.repo.createBooking(SLUG, { name: 'Other Client', phone: '555-888-1111', remindersOptIn: false, serviceId: 'svc_1', staffId: 'stf_1', start: target.start.toISOString() })
    expect(await errorCode(env.repo.rescheduleBooking(SLUG, booking.manageToken!, target.start.toISOString()))).toBe('slot_unavailable')
  })
})

describe('business data (persisted)', () => {
  it('persists dashboard status changes', async () => {
    const env = createTestEnv()
    const [appt] = await env.repo.listAppointments({ status: ['confirmed'], from: NOW })
    await env.repo.updateAppointmentStatus(appt.id, 'cancelled')
    const reloaded = env.reload()
    expect((await reloaded.repo.listAppointments({ customerId: appt.customerId })).find((a) => a.id === appt.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'business' })
  })

  it('persists hours, policies, profile, language and currency settings', async () => {
    const env = createTestEnv()
    const before = await env.repo.getBusiness()
    await env.repo.updateBusiness({
      name: 'Luna Studio',
      description: 'Updated',
      hours: { ...before.hours, 0: { open: true, start: '11:00', end: '15:00' } },
      policies: { ...before.policies, cancellationWindowHours: 12, minNoticeHours: 4 },
      settings: { defaultLanguage: 'he', currency: 'ILS' },
    })
    const after = await env.reload().repo.getBusiness()
    expect(after).toMatchObject({ name: 'Luna Studio', description: 'Updated', settings: { defaultLanguage: 'he', currency: 'ILS' } })
    expect(after.hours[0]).toEqual({ open: true, start: '11:00', end: '15:00' })
    expect(after.policies.cancellationWindowHours).toBe(12)
    expect(after.updatedAt).toBe(NOW.toISOString())
  })

  it('new policies apply to the public booking rules immediately', async () => {
    const env = createTestEnv()
    const b = await env.repo.getBusiness()
    await env.repo.updateBusiness({ hours: { ...b.hours, 3: { ...b.hours[3], open: false } } }) // close Wednesdays
    const days = await env.repo.getAvailability(SLUG, 'svc_1', NOW, 7)
    expect(days.find((d) => d.date.getDay() === 3)?.slots).toHaveLength(0)
  })

  it('changes the booking link slug with validation; links already shared keep working', async () => {
    const env = createTestEnv()
    expect(await errorCode(env.repo.updateBusiness({ slug: 'Not Valid!' }))).toBe('invalid_slug')
    await env.repo.updateBusiness({ slug: 'luna-studio' })
    expect((await env.repo.getBusiness()).slug).toBe('luna-studio')
    expect((await env.repo.getPublicProfile('luna-studio'))?.business.slug).toBe('luna-studio')
    // The previous link still resolves to the same business (now reporting its current link)
    expect((await env.repo.getPublicProfile('luna-hair'))?.business.slug).toBe('luna-studio')
    expect(await env.reload().repo.getPublicProfile('luna-hair')).toBeDefined()
    // Switching back to a former link of the same business is allowed
    await env.repo.updateBusiness({ slug: 'luna-hair' })
    expect((await env.repo.getBusiness()).slug).toBe('luna-hair')
    expect(await errorCode(env.repo.updateBusiness({ settings: { defaultLanguage: 'fr' as never, currency: 'auto' } }))).toBe('invalid_input')
  })

  it('isolates tenants: a second business sees only its own data and slugs must be unique', async () => {
    const luna = buildDemoDataset(NOW, 'biz_1')
    const other = buildDemoDataset(NOW, 'biz_2')
    other.businesses[0] = { ...other.businesses[0], slug: 'glow-lab', name: 'Glow Lab' }
    const prefix = (rows: { id: string }[]) => rows.map((r) => ({ ...r, id: `b2_${r.id}` }))
    const seed = () => ({
      businesses: [...luna.businesses, ...other.businesses],
      staff: [...luna.staff, ...other.staff.map((s) => ({ ...s, id: `b2_${s.id}`, serviceIds: s.serviceIds.map((x) => `b2_${x}`) }))],
      services: [...luna.services, ...prefix(other.services)] as typeof luna.services,
      customers: [...luna.customers, ...prefix(other.customers)] as typeof luna.customers,
      appointments: [...luna.appointments, ...other.appointments.map((a) => ({ ...a, id: `b2_${a.id}`, customerId: `b2_${a.customerId}`, staffId: `b2_${a.staffId}`, serviceId: `b2_${a.serviceId}` }))],
    })
    const asLuna = createTestEnv({ seed })
    const asGlow = asLuna.as('biz_2')
    expect((await asLuna.repo.listStaff()).every((s) => s.businessId === 'biz_1')).toBe(true)
    expect((await asGlow.repo.listCustomers()).every((c) => c.businessId === 'biz_2')).toBe(true)
    expect((await asGlow.repo.getBusiness()).name).toBe('Glow Lab')
    expect(await errorCode(asLuna.repo.updateBusiness({ slug: 'glow-lab' }))).toBe('slug_taken')
    // A Luna appointment can't be touched from Glow Lab's dashboard
    const [lunaAppt] = await asLuna.repo.listAppointments({ from: NOW })
    expect(await errorCode(asGlow.repo.updateAppointmentStatus(lunaAppt.id, 'cancelled'))).toBe('not_found')
  })

  it('announces changes by topic and can reset the demo', async () => {
    const env = createTestEnv()
    const listener = vi.fn()
    env.repo.onChange(listener)
    await env.repo.updateBusiness({ name: 'Renamed' })
    expect(listener).toHaveBeenLastCalledWith(['business'])
    await env.repo.resetDemoData()
    expect((await env.repo.getBusiness()).name).toBe('Luna Hair Studio')
  })
})

describe('onboarding & catalog management (persisted)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  it('creates, edits and removes services; removed ones keep history but are not bookable', async () => {
    const env = createTestEnv()
    expect(await errorCode(env.repo.createService({ name: '', category: 'Cuts', description: '', durationMin: 30, bufferMin: 0, price: 40, active: true }))).toBe('invalid_input')
    expect(await errorCode(env.repo.createService({ name: 'Trim', category: 'Cuts', description: '', durationMin: 3, bufferMin: 0, price: 40, active: true }))).toBe('invalid_input')
    const trim = await env.repo.createService({ name: ' Fringe trim ', category: 'Cuts', description: 'Quick tidy-up', durationMin: 15, bufferMin: 5, price: 20, active: true })
    expect(trim).toMatchObject({ name: 'Fringe trim', durationMin: 15, price: 20 })
    expect((await env.reload().repo.listServices()).some((s) => s.id === trim.id)).toBe(true)

    // A past appointment for a service that is later removed still shows its service
    const [past] = await env.repo.listAppointments({ status: ['completed'] })
    await env.repo.deleteService(past.serviceId)
    expect((await env.repo.listServices()).some((s) => s.id === past.serviceId)).toBe(false)
    expect((await env.repo.listAppointments({ customerId: past.customerId })).find((a) => a.id === past.id)?.service.name).toBe(past.service.name)
    expect(await errorCode(env.repo.getAvailability(SLUG, past.serviceId, NOW, 7))).toBe('invalid_input')
    expect((await env.repo.getPublicProfile(SLUG))!.services.some((s) => s.id === past.serviceId)).toBe(false)
    expect(await errorCode(env.repo.deleteService(past.serviceId))).toBe('not_found')
  })

  it('adds team members whose personal hours limit their availability', async () => {
    const env = createTestEnv()
    const closed = { open: false, start: '09:00', end: '17:00' }
    // Works Wednesdays 10:00–13:00 only (2026-10-07 is a Wednesday)
    const week = { 0: closed, 1: closed, 2: closed, 3: { open: true, start: '10:00', end: '13:00' }, 4: closed, 5: closed, 6: closed }
    const noa = await env.repo.createStaff({ name: 'Noa  Levi', role: 'Stylist', color: 'rose', serviceIds: ['svc_2'], availability: week })
    expect(noa).toMatchObject({ name: 'Noa Levi', avatarInitials: 'NL', serviceIds: ['svc_2'] })
    expect(noa.availability?.[3]).toEqual({ open: true, start: '10:00', end: '13:00' })

    const days = await env.reload().repo.getAvailability(SLUG, 'svc_2', NOW, 7, noa.id)
    const free = days.flatMap((d) => d.slots).filter((s) => s.available)
    expect(free.length).toBeGreaterThan(0)
    // Hours are the business's wall clock (Luna is in New York), whatever zone the code runs in.
    const zone = 'America/New_York'
    expect(free.every((s) => zonedWeekday(s.start, zone) === 3 && minutesIntoZonedDay(s.start, zone) >= 10 * 60 && minutesIntoZonedDay(s.end, zone) <= 13 * 60)).toBe(true)
    expect(minutesIntoZonedDay(free[0].start, zone)).toBe(10 * 60)

    // Editing: now also does svc_1, works every open day (no personal hours)
    const edited = await env.repo.updateStaff(noa.id, { name: 'Noa Levi', role: 'Senior stylist', color: 'teal', serviceIds: ['svc_1', 'svc_2'] })
    expect(edited.availability).toBeUndefined()
    expect(edited.serviceIds.sort()).toEqual(['svc_1', 'svc_2'])
    expect(await errorCode(env.repo.createStaff({ name: 'X', role: '', color: 'rose', serviceIds: [] }))).toBe('invalid_input')
    expect(await errorCode(env.repo.createStaff({ name: 'Unknown Service', role: '', color: 'rose', serviceIds: ['svc_nope'] }))).toBe('invalid_input')
  })

  it("won't remove a team member with upcoming appointments", async () => {
    const env = createTestEnv()
    const busy = (await env.repo.listAppointments({ status: ['confirmed'], from: NOW }))[0]
    expect(await errorCode(env.repo.deleteStaff(busy.staffId))).toBe('in_use')
    const idle = await env.repo.createStaff({ name: 'Temp Helper', role: '', color: 'amber', serviceIds: ['svc_2'] })
    await env.repo.deleteStaff(idle.id)
    expect((await env.repo.listStaff()).some((s) => s.id === idle.id)).toBe(false)
    expect((await env.repo.getPublicProfile(SLUG))!.staff.some((s) => s.id === idle.id)).toBe(false)
  })

  it('publishing controls the public page; publishing needs something bookable', async () => {
    const env = createTestEnv()
    await env.repo.setPublished(false)
    expect(await env.repo.getPublicProfile(SLUG)).toBeUndefined()
    expect(await errorCode(env.repo.getAvailability(SLUG, 'svc_1', NOW, 7))).toBe('not_found')
    const back = await env.repo.setPublished(true)
    expect(back.publishedAt).toBe(NOW.toISOString())
    expect(await env.reload().repo.getPublicProfile(SLUG)).toBeDefined()

    for (const s of await env.repo.listServices()) await env.repo.deleteService(s.id)
    await env.repo.setPublished(false)
    expect(await errorCode(env.repo.setPublished(true))).toBe('not_ready')
  })

  it('stores branding, time zone and onboarding completion', async () => {
    const env = createTestEnv()
    const withLogo = await env.repo.setBusinessImage('logo', PNG)
    expect(withLogo.logoUrl).toBeTruthy()
    expect((await env.reload().repo.getPublicProfile(SLUG))!.business.logoUrl).toBe(withLogo.logoUrl)
    expect(await errorCode(env.repo.setBusinessImage('cover', 'data:text/html;base64,PHNjcmlwdD4='))).toBe('invalid_image')
    expect((await env.repo.setBusinessImage('logo', null)).logoUrl).toBeUndefined()

    await env.repo.updateBusiness({ timezone: 'Asia/Jerusalem' })
    expect((await env.reload().repo.getBusiness()).timezone).toBe('Asia/Jerusalem')
    expect(await errorCode(env.repo.updateBusiness({ timezone: 'Mars/Olympus' }))).toBe('invalid_input')

    const done = await env.repo.completeOnboarding()
    expect(done.onboardingCompletedAt).toBeTruthy()
    expect((await env.repo.completeOnboarding()).onboardingCompletedAt).toBe(done.onboardingCompletedAt) // idempotent
  })
})

describe('appointments & clients managed by the business (persisted)', () => {
  const newClient = { firstName: 'Avi', lastName: 'Mizrahi', phone: '+972 52-555-0101', email: 'Avi@Example.com ', marketingOptIn: true }
  /** A free time for Priya (stf_3) at least two days out, from the business's own availability. */
  const freeTimes = async (env: ContractEnv, serviceId = 'svc_2', staffId = 'stf_3') => {
    const days = await env.repo.getStaffAvailability(serviceId, NOW, 14, { staffId })
    const free = days.slice(2).flatMap((d) => d.slots).filter((s) => s.available).map((s) => s.start)
    if (!free.length) throw new Error('no free time')
    return free
  }
  const freeTime = async (env: ContractEnv, serviceId = 'svc_2', staffId = 'stf_3') => (await freeTimes(env, serviceId, staffId))[0]

  it('books a phone appointment for a new client; overlaps and unqualified staff are refused', async () => {
    const env = createTestEnv()
    const times = await freeTimes(env)
    const start = times[0]
    const later = times.find((t) => t.getTime() >= start.getTime() + 60 * 60_000)!
    const appt = await env.repo.createAppointment({ customer: newClient, serviceId: 'svc_2', staffId: 'stf_3', start: start.toISOString(), source: 'phone', notify: true, notes: 'Prefers scissors' })
    expect(appt).toMatchObject({ status: 'confirmed', source: 'phone', staffId: 'stf_3', price: 45, notes: 'Prefers scissors' })
    expect(appt.reference).toMatch(/^[A-Z2-9]{6}$/)
    expect(appt.customer).toMatchObject({ firstName: 'Avi', lastName: 'Mizrahi', email: 'avi@example.com', marketingOptIn: true })

    const after = env.reload()
    expect((await after.repo.listAppointments({ customerId: appt.customerId })).map((a) => a.id)).toEqual([appt.id])
    // Same person again → reuse the client; same phone as a new client → duplicate
    const again = await after.repo.createAppointment({ customerId: appt.customerId, serviceId: 'svc_2', staffId: 'stf_3', start: later.toISOString(), source: 'walk_in', notify: false })
    expect(again.customerId).toBe(appt.customerId)
    expect(await errorCode(after.repo.createCustomer({ ...newClient, firstName: 'Someone' }))).toBe('duplicate')
    // Overlap (incl. the 5-minute buffer) is refused; Priya doesn't do balayage
    expect(await errorCode(after.repo.createAppointment({ customerId: appt.customerId, serviceId: 'svc_2', staffId: 'stf_3', start: new Date(start.getTime() + 20 * 60_000).toISOString(), source: 'phone', notify: false }))).toBe('slot_unavailable')
    expect(await errorCode(after.repo.createAppointment({ customerId: appt.customerId, serviceId: 'svc_4', staffId: 'stf_3', start: start.toISOString(), source: 'phone', notify: false }))).toBe('invalid_input')
    expect(await errorCode(after.repo.createAppointment({ customer: { ...newClient, phone: 'call me' }, serviceId: 'svc_2', staffId: 'stf_3', start: start.toISOString(), source: 'phone', notify: false }))).toBe('invalid_input')
    expect(await errorCode(after.repo.createAppointment({ customerId: appt.customerId, serviceId: 'svc_2', staffId: 'stf_3', start: 'tomorrow', source: 'phone', notify: false }))).toBe('invalid_input')
    // The online page no longer offers that time
    const online = (await after.repo.getAvailability(SLUG, 'svc_2', NOW, 14, 'stf_3')).flatMap((d) => d.slots).find((s) => s.start.getTime() === start.getTime())
    expect(online?.available ?? false).toBe(false)
  })

  it('moves, annotates and cancels an appointment from the dashboard', async () => {
    const env = createTestEnv()
    const start = await freeTime(env)
    const appt = await env.repo.createAppointment({ customer: newClient, serviceId: 'svc_2', staffId: 'stf_3', start: start.toISOString(), source: 'phone', notify: false })
    const target = await freeTime(env, 'svc_2', 'stf_1')
    const moved = await env.repo.moveAppointment(appt.id, { start: target.toISOString(), staffId: 'stf_1', notify: true })
    expect(moved).toMatchObject({ staffId: 'stf_1', start: target.toISOString(), previousStart: start.toISOString(), price: 45 })
    // Persisted (re-read after a restart), including the new team member
    expect((await env.reload().repo.listAppointments({ customerId: appt.customerId }))[0]).toMatchObject({ staffId: 'stf_1', start: target.toISOString(), staff: { name: 'Maya Cohen' } })
    expect(new Date(moved.end).getTime() - target.getTime()).toBe(30 * 60_000)
    // Can't move onto someone else's booking
    const busy = (await env.repo.listAppointments({ from: NOW, staffId: 'stf_1', status: ['confirmed'] })).find((a) => a.id !== appt.id)!
    expect(await errorCode(env.repo.moveAppointment(appt.id, { start: busy.start, notify: false }))).toBe('slot_unavailable')

    await env.repo.updateAppointmentNotes(appt.id, '  Allergic to lavender ')
    expect((await env.reload().repo.listAppointments({ customerId: appt.customerId }))[0].notes).toBe('Allergic to lavender')

    const cancelled = await env.repo.cancelAppointment(appt.id, { notify: false })
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelledBy: 'business' })
    expect(await errorCode(env.repo.cancelAppointment(appt.id, { notify: false }))).toBe('already_cancelled')
    expect(await errorCode(env.repo.moveAppointment(appt.id, { start: target.toISOString(), notify: false }))).toBe('not_changeable')
    expect(await errorCode(env.repo.sendReminder(appt.id))).toBe('not_changeable')
  })

  it('manages clients: edit, opt out, message rules and erasure', async () => {
    const env = createTestEnv()
    const client = await env.repo.createCustomer(newClient)
    expect(client.tags).toEqual(['New'])
    const edited = await env.repo.updateCustomer(client.id, { ...newClient, lastName: 'Mizrahi-Cohen', notes: 'Likes early mornings', tags: ['VIP'], preferredLanguage: 'he' })
    expect(edited).toMatchObject({ lastName: 'Mizrahi-Cohen', notes: 'Likes early mornings', tags: ['VIP'], preferredLanguage: 'he' })
    expect(await errorCode(env.repo.updateCustomer(client.id, { ...newClient, email: 'not-an-email' }))).toBe('invalid_input')
    expect(await errorCode(env.repo.sendCustomerMessage(client.id, '   '))).toBe('invalid_input')
    await env.repo.sendCustomerMessage(client.id, 'See you soon!')

    const optedOut = await env.repo.setCustomerOptOut(client.id, true)
    expect(optedOut.messagingOptOut).toBe(true)
    expect(await errorCode(env.repo.sendCustomerMessage(client.id, 'Hello'))).toBe('opted_out')
    expect((await env.repo.setCustomerOptOut(client.id, false)).messagingOptOut).toBeUndefined()

    // Erasure: refused while a visit is coming up; afterwards personal data is gone, history stays.
    const start = await freeTime(env)
    const appt = await env.repo.createAppointment({ customerId: client.id, serviceId: 'svc_2', staffId: 'stf_3', start: start.toISOString(), source: 'phone', notify: false, notes: 'private note' })
    expect(await errorCode(env.repo.eraseCustomer(client.id))).toBe('in_use')
    await env.repo.cancelAppointment(appt.id, { notify: false })
    await env.repo.eraseCustomer(client.id)
    const after = env.reload()
    expect((await after.repo.listCustomers()).some((c) => c.id === client.id)).toBe(false)
    expect(await after.repo.getCustomer(client.id)).toBeUndefined()
    const [history] = await after.repo.listAppointments({ customerId: client.id })
    expect(history).toMatchObject({ id: appt.id, price: 45, status: 'cancelled' })
    expect(history.notes).toBeUndefined()
    expect(history.customer).toMatchObject({ phone: '', email: '' })
    expect(history.customer.lastName).toBe('')
    expect(await errorCode(after.repo.eraseCustomer(client.id))).toBe('not_found')
    // The phone number is free to use again
    expect((await after.repo.createCustomer(newClient)).id).not.toBe(client.id)
  })

  it('imports clients in bulk, skipping duplicates and invalid rows', async () => {
    const env = createTestEnv()
    const existing = (await env.repo.listCustomers())[0]
    const result = await env.repo.importCustomers([
      { firstName: 'Tamar', lastName: 'Ofer', phone: '052-555-0111', email: 'tamar@example.com', marketingOptIn: false, notes: 'Imported' },
      { firstName: 'Copy', lastName: 'Of Existing', phone: existing.phone, email: '', marketingOptIn: false },
      { firstName: '', lastName: 'No first name', phone: '052-555-0112', email: '', marketingOptIn: false },
      { firstName: 'Bad', lastName: 'Phone', phone: 'n/a', email: '', marketingOptIn: false },
      { firstName: 'Tamar', lastName: 'Twin', phone: '0525550111', email: '', marketingOptIn: false }, // same phone as row 1
    ])
    expect(result).toEqual({ created: 1, duplicates: [2, 5], invalid: [3, 4] })
    const imported = (await env.reload().repo.listCustomers()).find((c) => c.firstName === 'Tamar')!
    expect(imported).toMatchObject({ lastName: 'Ofer', email: 'tamar@example.com', notes: 'Imported', tags: [], marketingOptIn: false })
    expect(await errorCode(env.repo.importCustomers('nope' as never))).toBe('invalid_input')
  })

  it("keeps each business's appointments and clients to itself", async () => {
    const luna = buildDemoDataset(NOW)
    const other = buildDemoDataset(NOW, 'biz_2')
    other.businesses[0] = { ...other.businesses[0], slug: 'glow-lab', name: 'Glow Lab' }
    const p = (id: string) => `b2_${id}`
    const seed = () => ({
      businesses: [...luna.businesses, ...other.businesses],
      staff: [...luna.staff, ...other.staff.map((s) => ({ ...s, id: p(s.id), serviceIds: s.serviceIds.map(p) }))],
      services: [...luna.services, ...other.services.map((s) => ({ ...s, id: p(s.id) }))],
      customers: [...luna.customers, ...other.customers.map((c) => ({ ...c, id: p(c.id) }))],
      appointments: [...luna.appointments, ...other.appointments.map((a) => ({ ...a, id: p(a.id), customerId: p(a.customerId), staffId: p(a.staffId), serviceId: p(a.serviceId) }))],
    })
    const asLuna = createTestEnv({ seed })
    const asGlow = asLuna.as('biz_2')
    const [lunaAppt] = await asLuna.repo.listAppointments({ from: NOW, status: ['confirmed'] })
    const lunaClient = (await asLuna.repo.listCustomers())[0]
    const start = new Date(NOW.getTime() + 5 * 86_400_000).toISOString()
    expect(await errorCode(asGlow.repo.moveAppointment(lunaAppt.id, { start, notify: false }))).toBe('not_found')
    expect(await errorCode(asGlow.repo.cancelAppointment(lunaAppt.id, { notify: false }))).toBe('not_found')
    expect(await errorCode(asGlow.repo.updateAppointmentNotes(lunaAppt.id, 'x'))).toBe('not_found')
    expect(await errorCode(asGlow.repo.sendReminder(lunaAppt.id))).toBe('not_found')
    expect(await errorCode(asGlow.repo.updateCustomer(lunaClient.id, newClient))).toBe('not_found')
    expect(await errorCode(asGlow.repo.eraseCustomer(lunaClient.id))).toBe('not_found')
    expect(await errorCode(asGlow.repo.sendCustomerMessage(lunaClient.id, 'Hi'))).toBe('not_found')
    expect(await asGlow.repo.getCustomer(lunaClient.id)).toBeUndefined()
    // …and can't book a Luna client or Luna's staff/service from Glow Lab
    expect(await errorCode(asGlow.repo.createAppointment({ customerId: lunaClient.id, serviceId: 'b2_svc_2', staffId: 'b2_stf_3', start, source: 'phone', notify: false }))).toBe('not_found')
    expect(await errorCode(asGlow.repo.createAppointment({ customer: newClient, serviceId: 'svc_2', staffId: 'stf_3', start, source: 'phone', notify: false }))).toBe('invalid_input')
    // The same phone number can be a client of both businesses
    await asLuna.repo.createCustomer(newClient)
    await asGlow.repo.createCustomer(newClient)
  })
})
})
}
