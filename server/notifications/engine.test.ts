import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewBookingInput } from '../../src/data/repositories/types'
import { migrate } from '../db/migrate'
import { DEMO, demoDatasets, insertDataset } from '../db/seed'
import { openSqlite, type Sql } from '../db/sqlite'
import { EventBus } from '../events'
import { createScheduler } from '../jobs/scheduler'
import type { NotificationRow } from '../repositories/mappers'
import { createSqlRepository } from '../repositories/sqlRepository'
import { NotificationEngine } from './engine'
import { ProviderRegistry, type NotificationProvider } from './provider'
import { DevProvider } from './providers/devProvider'
import { toE164 } from '../../src/domain/phone'

/** Monday 5 Oct 2026 08:00 UTC (tests run with TZ=UTC). */
const NOW = new Date('2026-10-05T08:00:00.000Z')
const SLUG = 'luna-hair'
const H = 3_600_000

let sql: Sql
let clock: Date
let provider: DevProvider
let engine: NotificationEngine
let repo: ReturnType<typeof createSqlRepository>
let events: EventBus

function setup(extraProviders: NotificationProvider[] = []) {
  sql = openSqlite(':memory:')
  migrate(sql)
  for (const ds of demoDatasets(NOW)) insertDataset(sql, ds)
  clock = new Date(NOW)
  const now = () => new Date(clock)
  provider = new DevProvider({ deliveryDelayMs: null, now })
  events = new EventBus()
  engine = new NotificationEngine({ sql, providers: new ProviderRegistry([...extraProviders, provider]), now, publicBaseUrl: 'https://book.example', events })
  repo = createSqlRepository({ sql, businessId: () => DEMO.luna.businessId, now, events, onDomainEvent: engine.handle })
}
beforeEach(() => setup())

const advance = (ms: number) => (clock = new Date(clock.getTime() + ms))
const rows = (appointmentId: string) => sql.all<NotificationRow>('SELECT * FROM notifications WHERE appointment_id = ? ORDER BY scheduled_for, created_at', [appointmentId])
const byKind = (appointmentId: string, kind: string) => rows(appointmentId).filter((r) => r.kind === kind)

async function slot(minHoursAhead: number, serviceId = 'luna_svc_1', staffId?: string) {
  const days = await repo.getAvailability(SLUG, serviceId, clock, 14, staffId)
  const s = days.flatMap((d) => d.slots).find((x) => x.available && x.start.getTime() >= clock.getTime() + minHoursAhead * H)
  if (!s) throw new Error('no slot')
  return s
}

async function book(over: Partial<NewBookingInput> & { hoursAhead?: number } = {}) {
  const { hoursAhead = 72, ...input } = over
  const s = await slot(hoursAhead, input.serviceId ?? 'luna_svc_1', input.staffId)
  return repo.createBooking(SLUG, { serviceId: 'luna_svc_1', start: s.start.toISOString(), name: 'Dana Levi', phone: '(555) 010-2030', remindersOptIn: true, locale: 'en', ...input })
}

describe('confirmation', () => {
  it('is queued with the booking and sent by the dispatcher in the client language', async () => {
    const b = await book({ locale: 'he', name: 'נועה בר', phone: '(555) 444-1000' })
    const [confirmation] = byKind(b.id, 'confirmation')
    expect(confirmation).toMatchObject({ status: 'pending', channel: 'sms', recipient: '(555) 444-1000', locale: 'he', scheduled_for: NOW.toISOString() })
    expect(provider.outbox).toHaveLength(0) // nothing leaves until the background job runs

    expect(await engine.dispatchDue()).toMatchObject({ sent: 1 })
    const [msg] = provider.outbox
    expect(msg).toMatchObject({ channel: 'sms', to: '+15554441000', locale: 'he', idempotencyKey: confirmation.id }) // E.164 for the provider
    expect(confirmation.recipient).toBe('(555) 444-1000') // as the business entered it
    expect(msg.body).toContain('התור שלכם ב-Luna Hair Studio נקבע')
    expect(msg.body).toContain(`https://book.example/book/luna-hair/manage/${b.manageToken}`)
    expect(b.manageToken).toMatch(/^[0-9a-f]{32}$/)
    expect(msg.body).toMatch(/\d{2}:\d{2}/) // 24h clock in Hebrew
    expect(byKind(b.id, 'confirmation')[0]).toMatchObject({ status: 'sent', provider: 'dev', provider_message_id: msg.providerMessageId, attempts: 1 })
  })

  it('uses English (12h clock) for an English booking and records the rendered text', async () => {
    const b = await book({ locale: 'en' })
    await engine.dispatchDue()
    const sent = byKind(b.id, 'confirmation')[0]
    expect(sent.body).toMatch(/^Hi Dana, you're booked at Luna Hair Studio: Women's haircut with \w+ on .+ (AM|PM)\. Manage or cancel: https:\/\/book\.example\//)
    expect(sent.subject).toBe('Booking confirmed — Luna Hair Studio')
  })

  it("states the time on the business's clock, not the server's", async () => {
    // Tests run in UTC; Luna is in New York, which is UTC−4 on 7 Oct 2026 (independent oracle below).
    const s = (await repo.getAvailability(SLUG, 'luna_svc_1', new Date('2026-10-07T12:00:00Z'), 1))[0].slots.find((x) => x.available)!
    const local = new Date(s.start.getTime() - 4 * H)
    const h = local.getUTCHours()
    const expected = `${h % 12 || 12}:${String(local.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
    expect(h).not.toBe(s.start.getUTCHours())
    const b = await repo.createBooking(SLUG, { serviceId: 'luna_svc_1', start: s.start.toISOString(), name: 'Dana Levi', phone: '(555) 010-2030', remindersOptIn: true, locale: 'en' })
    await engine.dispatchDue()
    expect(byKind(b.id, 'confirmation')[0].body).toContain(`on Wednesday, October 7 · ${expected}.`)
  })

  it('rolls back with the booking (transactional outbox)', async () => {
    const s = await slot(72)
    await repo.createBooking(SLUG, { serviceId: 'luna_svc_1', staffId: s.freeStaffIds[0], start: s.start.toISOString(), name: 'First Client', phone: '555-111-0001', remindersOptIn: true })
    const before = sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications')!.n
    await expect(repo.createBooking(SLUG, { serviceId: 'luna_svc_1', staffId: s.freeStaffIds[0], start: s.start.toISOString(), name: 'Second Client', phone: '555-111-0002', remindersOptIn: true })).rejects.toMatchObject({ code: 'slot_unavailable' })
    expect(sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications')!.n).toBe(before)
  })
})

describe('reminder scheduling', () => {
  it('schedules one reminder per configured lead time (24h and 2h)', async () => {
    const b = await book({ hoursAhead: 72 })
    const start = new Date(b.start).getTime()
    expect(byKind(b.id, 'reminder').map((r) => r.scheduled_for)).toEqual([new Date(start - 24 * H).toISOString(), new Date(start - 2 * H).toISOString()])
  })

  it('skips lead times that have already passed and respects the opt-out', async () => {
    const soon = await book({ hoursAhead: 5, serviceId: 'luna_svc_2', phone: '555-222-0001' })
    expect(byKind(soon.id, 'reminder').map((r) => JSON.parse(r.payload).hoursBefore)).toEqual([2])
    const optOut = await book({ remindersOptIn: false, phone: '555-222-0002' })
    expect(byKind(optOut.id, 'reminder')).toHaveLength(0)
    expect(byKind(optOut.id, 'confirmation')).toHaveLength(1) // confirmations are always sent
  })

  it('follows the business reminder settings', async () => {
    const b0 = await repo.getBusiness()
    await repo.updateBusiness({ policies: { ...b0.policies, reminderHoursBefore: [48] } })
    const b = await book()
    expect(byKind(b.id, 'reminder').map((r) => JSON.parse(r.payload).hoursBefore)).toEqual([48])
  })

  it('sends each reminder when due — once — and marks the appointment', async () => {
    const b = await book({ hoursAhead: 72 })
    await engine.dispatchDue() // confirmation
    expect(await engine.dispatchDue()).toMatchObject({ sent: 0 }) // reminders not due yet

    clock = new Date(new Date(b.start).getTime() - 24 * H)
    expect(await engine.dispatchDue()).toMatchObject({ sent: 1 })
    expect(provider.outbox.at(-1)!.body).toMatch(/^Reminder: Women's haircut/)
    expect(sql.get<{ reminder_sent: number }>('SELECT reminder_sent FROM appointments WHERE id = ?', [b.id])!.reminder_sent).toBe(1)
    expect(await engine.dispatchDue()).toMatchObject({ sent: 0 })

    clock = new Date(new Date(b.start).getTime() - 2 * H)
    expect(await engine.dispatchDue()).toMatchObject({ sent: 1 })
    expect(provider.outbox).toHaveLength(3) // confirmation + 2 reminders, no duplicates
  })

  it('a reminder that becomes stale before sending is cancelled, not sent', async () => {
    const b = await book({ hoursAhead: 72 })
    // Someone changes the appointment directly in the database (no event): the dispatcher re-checks.
    sql.run("UPDATE appointments SET status = 'no_show' WHERE id = ?", [b.id])
    clock = new Date(new Date(b.start).getTime() - 24 * H)
    const summary = await engine.dispatchDue()
    expect(summary.cancelled).toBeGreaterThanOrEqual(1)
    expect(byKind(b.id, 'reminder')[0]).toMatchObject({ status: 'cancelled', cancelled_reason: 'status_no_show' })
  })
})

describe('cancellation', () => {
  it('customer cancellation: pending reminders cancelled, cancellation confirmed', async () => {
    const b = await book({ hoursAhead: 72 })
    await engine.dispatchDue()
    await repo.cancelBooking(SLUG, b.manageToken!, 'unwell')
    expect(byKind(b.id, 'reminder').map((r) => [r.status, r.cancelled_reason])).toEqual([
      ['cancelled', 'appointment_cancelled'],
      ['cancelled', 'appointment_cancelled'],
    ])
    await engine.dispatchDue()
    expect(byKind(b.id, 'cancellation')[0].status).toBe('sent')
    expect(provider.outbox.at(-1)!.body).toMatch(/is cancelled\. Book again anytime: https:\/\/book\.example\/book\/luna-hair$/)
  })

  it('business cancellation tells the client and how to rebook', async () => {
    const b = await book({ hoursAhead: 72, locale: 'he' })
    await repo.updateAppointmentStatus(b.id, 'cancelled')
    await engine.dispatchDue()
    // The unsent confirmation is cancelled too — only the cancellation goes out.
    expect(byKind(b.id, 'confirmation')[0].status).toBe('cancelled')
    expect(provider.outbox).toHaveLength(1)
    expect(provider.outbox[0].body).toContain('נאלצו לבטל')
    expect(provider.outbox[0].body).toContain('(555) 214-8890')
  })

  it('completed / no-show stops reminders', async () => {
    const b = await book({ hoursAhead: 72 })
    await repo.updateAppointmentStatus(b.id, 'completed')
    expect(byKind(b.id, 'reminder').every((r) => r.status === 'cancelled' && r.cancelled_reason === 'status_completed')).toBe(true)
  })
})

describe('rescheduling', () => {
  it('replaces reminders, announces the new time, and can be undone without duplicates', async () => {
    const b = await book({ hoursAhead: 72, staffId: 'luna_stf_3' })
    await engine.dispatchDue()
    const options = await repo.getRescheduleAvailability(SLUG, b.manageToken!, clock, 14)
    const target = options.slice(6).flatMap((d) => d.slots).find((s) => s.available)!
    await repo.rescheduleBooking(SLUG, b.manageToken!, target.start.toISOString())

    const reminders = byKind(b.id, 'reminder')
    expect(reminders.filter((r) => r.status === 'cancelled').map((r) => r.cancelled_reason)).toEqual(['rescheduled', 'rescheduled'])
    const fresh = reminders.filter((r) => r.status === 'pending')
    expect(fresh.map((r) => r.scheduled_for)).toEqual([new Date(target.start.getTime() - 24 * H).toISOString(), new Date(target.start.getTime() - 2 * H).toISOString()])

    await engine.dispatchDue()
    const notice = provider.outbox.at(-1)!
    expect(notice.body).toMatch(/^Your Women's haircut at Luna Hair Studio is now on .+ \(was .+\)\./)

    // Move back to the original time: the original reminders are revived, not duplicated.
    await repo.rescheduleBooking(SLUG, b.manageToken!, b.start)
    const after = byKind(b.id, 'reminder')
    expect(after).toHaveLength(4)
    expect(after.filter((r) => r.status === 'pending').map((r) => JSON.parse(r.payload).start)).toEqual([b.start, b.start])
  })
})

describe('Smart Fill offers', () => {
  async function cancelledSlot() {
    const b = await book({ hoursAhead: 72, phone: '555-333-0001' })
    await repo.updateAppointmentStatus(b.id, 'cancelled')
    await engine.dispatchDue()
    provider.clear()
    return b
  }

  it('go through the same engine; the server owns delivery status', async () => {
    const appt = await cancelledSlot()
    const [c1, c2] = (await repo.listCustomers()).filter((c) => c.id !== appt.customerId && c.marketingOptIn).slice(0, 2)
    await repo.saveAvailabilityOffer({
      businessId: DEMO.luna.businessId,
      id: 'ofr_1',
      appointmentId: appt.id,
      channel: 'whatsapp',
      createdAt: clock.toISOString(),
      recipients: [
        { customerId: c1.id, address: c1.phone, message: 'Hi! A spot opened up — reply YES.', status: 'delivered', updatedAt: '' }, // spoofed status is ignored
        { customerId: c2.id, address: c2.phone, message: 'שלום! התפנה תור — השיבו כן.', status: 'sent', updatedAt: '' },
      ],
    })
    expect((await repo.listAvailabilityOffers(appt.id))[0].recipients.map((r) => r.status)).toEqual(['queued', 'queued'])

    const published = vi.fn()
    events.subscribe(DEMO.luna.businessId, published)
    await engine.dispatchDue()
    expect(provider.outbox.map((m) => [m.channel, m.to, m.body])).toEqual([
      ['whatsapp', toE164(c1.phone, 'US'), 'Hi! A spot opened up — reply YES.'],
      ['whatsapp', toE164(c2.phone, 'US'), 'שלום! התפנה תור — השיבו כן.'],
    ])
    expect((await repo.listAvailabilityOffers(appt.id))[0].recipients.map((r) => r.status)).toEqual(['sent', 'sent'])
    expect(published).toHaveBeenCalledWith(expect.arrayContaining(['offers']))

    provider.deliverAll()
    expect((await repo.listAvailabilityOffers(appt.id))[0].recipients.map((r) => r.status)).toEqual(['delivered', 'delivered'])
  })

  it('are not sent if the slot was re-booked in the meantime', async () => {
    const appt = await cancelledSlot()
    const [c1] = (await repo.listCustomers()).filter((c) => c.marketingOptIn)
    await repo.saveAvailabilityOffer({ businessId: DEMO.luna.businessId, id: 'ofr_2', appointmentId: appt.id, channel: 'sms', createdAt: clock.toISOString(), recipients: [{ customerId: c1.id, address: c1.phone, message: 'Spot open', status: 'queued', updatedAt: '' }] })
    await repo.createBooking(SLUG, { serviceId: appt.serviceId, staffId: appt.staffId, start: appt.start, name: 'Quick Taker', phone: '555-777-9999', remindersOptIn: true })
    await engine.dispatchDue()
    expect(provider.outbox.filter((m) => m.body === 'Spot open')).toHaveLength(0)
    expect(sql.get<{ status: string; cancelled_reason: string }>("SELECT status, cancelled_reason FROM notifications WHERE kind = 'smart_fill_offer'")).toEqual({ status: 'cancelled', cancelled_reason: 'slot_filled' })
  })
})

describe('idempotency and duplicate prevention', () => {
  it('replaying the same domain event creates no second message', async () => {
    const b = await book()
    const count = () => sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE appointment_id = ?', [b.id])!.n
    const before = count()
    engine.handle({ type: 'appointment.booked', businessId: DEMO.luna.businessId, appointmentId: b.id })
    engine.handle({ type: 'appointment.booked', businessId: DEMO.luna.businessId, appointmentId: b.id })
    expect(count()).toBe(before)
  })

  it('concurrent dispatchers never send the same message twice', async () => {
    for (let i = 0; i < 4; i++) await book({ phone: `555-600-000${i}` })
    const send = vi.spyOn(provider, 'send')
    const second = new NotificationEngine({ sql, providers: new ProviderRegistry([provider]), now: () => new Date(clock), publicBaseUrl: 'https://book.example' })
    await Promise.all([engine.dispatchDue(), second.dispatchDue(), engine.dispatchDue()])
    expect(send).toHaveBeenCalledTimes(4)
    expect(provider.outbox).toHaveLength(4)
    expect(sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'confirmation' AND status = 'sent'")!.n).toBe(4)
  })

  it('a crash after sending (lease expires) re-sends with the same idempotency key — the provider de-duplicates', async () => {
    const b = await book()
    const [row] = byKind(b.id, 'confirmation')
    // Simulate a worker that sent the message and died before recording it.
    await provider.send({ idempotencyKey: row.id, channel: 'sms', to: row.recipient, body: 'x', locale: 'en' })
    sql.run('UPDATE notifications SET locked_until = ?, attempts = 1 WHERE id = ?', [new Date(clock.getTime() + 60_000).toISOString(), row.id])
    expect(await engine.dispatchDue()).toMatchObject({ sent: 0 }) // still leased by the "dead" worker
    advance(5 * 60_000)
    expect(await engine.dispatchDue()).toMatchObject({ sent: 1 })
    expect(provider.outbox.filter((m) => m.idempotencyKey === row.id)).toHaveLength(1)
  })
})

describe('failure handling', () => {
  it('retries transient failures with backoff, then succeeds', async () => {
    const b = await book()
    provider.failNext(1)
    expect(await engine.dispatchDue()).toMatchObject({ retried: 1, sent: 0 })
    const [row] = byKind(b.id, 'confirmation')
    expect(row).toMatchObject({ status: 'pending', attempts: 1, last_error: 'dev: simulated timeout', scheduled_for: new Date(NOW.getTime() + 60_000).toISOString() })
    expect(await engine.dispatchDue()).toMatchObject({ sent: 0 }) // waits for the backoff
    advance(60_000)
    expect(await engine.dispatchDue()).toMatchObject({ sent: 1 })
    expect(byKind(b.id, 'confirmation')[0]).toMatchObject({ status: 'sent', attempts: 2 })
  })

  it('gives up after the maximum attempts', async () => {
    const b = await book()
    provider.failNext(10)
    for (let i = 0; i < 3; i++) {
      await engine.dispatchDue()
      advance(20 * 60_000)
    }
    expect(byKind(b.id, 'confirmation')[0]).toMatchObject({ status: 'failed', attempts: 3, last_error: 'dev: simulated timeout' })
  })

  it('fails permanent errors immediately (invalid number)', async () => {
    const b = await book({ phone: '+999 555 0101' })
    expect(await engine.dispatchDue()).toMatchObject({ failed: 1 })
    expect(byKind(b.id, 'confirmation')[0]).toMatchObject({ status: 'failed', attempts: 1, last_error: 'dev: invalid recipient' })
  })

  it('treats provider exceptions as transient and fails cleanly without a provider', async () => {
    const throwing: NotificationProvider = { name: 'flaky', channels: ['whatsapp'], send: async () => Promise.reject(new Error('socket hang up')) }
    setup([throwing])
    const b0 = await repo.getBusiness()
    await repo.updateBusiness({ policies: { ...b0.policies, notificationChannel: 'whatsapp' } })
    const b = await book()
    expect(await engine.dispatchDue()).toMatchObject({ retried: 1 })
    expect(byKind(b.id, 'confirmation')[0].last_error).toBe('socket hang up')

    setup()
    const noEmail = new NotificationEngine({ sql, providers: new ProviderRegistry([{ name: 'sms-only', channels: ['sms'], send: provider.send.bind(provider) }]), now: () => new Date(clock), publicBaseUrl: 'x' })
    repo = createSqlRepository({ sql, businessId: () => DEMO.luna.businessId, now: () => new Date(clock), onDomainEvent: noEmail.handle })
    const b1 = await repo.getBusiness()
    await repo.updateBusiness({ policies: { ...b1.policies, notificationChannel: 'whatsapp' } })
    const c = await book()
    expect(await noEmail.dispatchDue()).toMatchObject({ failed: 1 })
    expect(byKind(c.id, 'confirmation')[0].last_error).toBe('no provider for whatsapp')
  })

  it('email channel falls back to SMS when the client has no email address', async () => {
    const b0 = await repo.getBusiness()
    await repo.updateBusiness({ policies: { ...b0.policies, notificationChannel: 'email' } })
    const b = await book() // web bookings have no email
    expect(byKind(b.id, 'confirmation')[0]).toMatchObject({ channel: 'sms', recipient: '(555) 010-2030' })
  })

  it('a failed Smart Fill message marks that recipient as failed', async () => {
    const b = await book({ hoursAhead: 72, phone: '555-333-0009' })
    await repo.updateAppointmentStatus(b.id, 'cancelled')
    // A consenting client whose number the provider rejects (the dev provider refuses +999…).
    const c1 = (await repo.listCustomers()).find((c) => c.marketingOptIn && c.id !== b.customerId)!
    await repo.updateCustomer(c1.id, { firstName: c1.firstName, lastName: c1.lastName, phone: '+999 555 0101', email: c1.email, marketingOptIn: true })
    await repo.saveAvailabilityOffer({ businessId: DEMO.luna.businessId, id: 'ofr_f', appointmentId: b.id, channel: 'sms', createdAt: clock.toISOString(), recipients: [{ customerId: c1.id, address: '', message: 'Spot open', status: 'queued', updatedAt: '' }] })
    await engine.dispatchDue()
    expect((await repo.listAvailabilityOffers(b.id))[0].recipients[0].status).toBe('failed')
  })
})

describe('message log and background jobs', () => {
  it('lists an appointment’s messages for its own business only', async () => {
    const b = await book()
    await engine.dispatchDue()
    const list = await repo.listNotifications(b.id)
    expect(list.map((n) => [n.kind, n.status])).toEqual([
      ['confirmation', 'sent'],
      ['reminder', 'pending'],
      ['reminder', 'pending'],
    ])
    const glow = createSqlRepository({ sql, businessId: () => DEMO.glow.businessId, now: () => clock })
    expect(await glow.listNotifications(b.id)).toEqual([])
  })

  it('the scheduler runs jobs periodically, never overlapping, surviving errors', async () => {
    vi.useFakeTimers()
    let runs = 0
    let active = 0
    let maxActive = 0
    const errors: string[] = []
    const scheduler = createScheduler(
      [
        {
          name: 'slow',
          intervalMs: 100,
          run: async () => {
            active++
            maxActive = Math.max(maxActive, active)
            runs++
            await new Promise((r) => setTimeout(r, 250))
            active--
            if (runs === 2) throw new Error('boom')
          },
        },
      ],
      (m) => errors.push(m),
    )
    scheduler.start()
    await vi.advanceTimersByTimeAsync(2000)
    // stop() waits for the in-flight run to finish, so keep the (fake) clock moving meanwhile.
    const stopping = scheduler.stop()
    await vi.advanceTimersByTimeAsync(500)
    await stopping
    vi.useRealTimers()
    expect(runs).toBeGreaterThanOrEqual(4)
    expect(maxActive).toBe(1)
    expect(errors).toEqual(['[jobs] slow failed: boom'])
  })
})

describe('business-entered changes and direct messages', () => {
  const client = { firstName: 'Avi', lastName: 'Mizrahi', phone: '(555) 888-0101', email: 'avi@example.com', marketingOptIn: false }
  async function phoneBooking(notify: boolean) {
    const s = await slot(72, 'luna_svc_2', 'luna_stf_3')
    return repo.createAppointment({ customer: client, serviceId: 'luna_svc_2', staffId: 'luna_stf_3', start: s.start.toISOString(), source: 'phone', notify })
  }

  it('sends a confirmation only when the business asks to; reminders follow the settings either way', async () => {
    const quiet = await phoneBooking(false)
    expect(byKind(quiet.id, 'confirmation')).toHaveLength(0)
    expect(byKind(quiet.id, 'reminder').length).toBeGreaterThan(0)
    await repo.cancelAppointment(quiet.id, { notify: false })
    expect(byKind(quiet.id, 'cancellation')).toHaveLength(0)
    expect(byKind(quiet.id, 'reminder').every((r) => r.status === 'cancelled')).toBe(true)

    const told = await repo.createAppointment({ customer: { ...client, phone: '(555) 888-0202' }, serviceId: 'luna_svc_2', staffId: 'luna_stf_3', start: quiet.start, source: 'phone', notify: true })
    await engine.dispatchDue()
    expect(byKind(told.id, 'confirmation')[0]).toMatchObject({ status: 'sent' })
    // The confirmation carries a manage link, so phone bookings can be managed online too
    expect(provider.outbox.at(-1)!.body).toContain(`/book/luna-hair/manage/${told.manageToken}`)
    const s2 = await slot(96, 'luna_svc_2', 'luna_stf_1')
    await repo.moveAppointment(told.id, { start: s2.start.toISOString(), staffId: 'luna_stf_1', notify: true })
    await engine.dispatchDue()
    expect(provider.outbox.at(-1)!.body).toMatch(/is now on .+ \(was .+\)/)
  })

  it('sends a reminder on request (each request sends again)', async () => {
    const b = await phoneBooking(false)
    await repo.sendReminder(b.id)
    await engine.dispatchDue()
    expect(provider.outbox.at(-1)!.body).toMatch(/^Reminder: Men's haircut/)
    advance(60_000)
    await repo.sendReminder(b.id)
    await engine.dispatchDue()
    expect(byKind(b.id, 'reminder').filter((r) => r.status === 'sent')).toHaveLength(2)
  })

  it('delivers a free-text message, and nothing at all to a client who opted out', async () => {
    const b = await phoneBooking(false)
    await repo.sendCustomerMessage(b.customerId, 'Running 10 minutes late — sorry!')
    await engine.dispatchDue()
    expect(provider.outbox.at(-1)).toMatchObject({ to: '+15558880101', body: 'Running 10 minutes late — sorry!' })
    const [msg] = (await repo.listCustomerNotifications(b.customerId)).filter((n) => n.kind === 'message')
    expect(msg).toMatchObject({ status: 'sent', channel: 'sms' })

    await repo.setCustomerOptOut(b.customerId, true)
    expect(byKind(b.id, 'reminder').every((r) => r.status === 'cancelled')).toBe(true)
    const before = provider.outbox.length
    await repo.moveAppointment(b.id, { start: (await slot(120, 'luna_svc_2', 'luna_stf_3')).start.toISOString(), notify: true })
    await engine.dispatchDue()
    expect(provider.outbox.length).toBe(before)
    expect(await repo.sendReminder(b.id).then(() => 'ok', (e) => e.code)).toBe('opted_out')
  })

  it("derives Smart Fill recipients' addresses on the server and requires marketing consent", async () => {
    const b = await book({ hoursAhead: 72, phone: '555-333-0009' })
    await repo.updateAppointmentStatus(b.id, 'cancelled')
    const customers = await repo.listCustomers()
    const consenting = customers.find((c) => c.marketingOptIn && c.id !== b.customerId)!
    const declined = customers.find((c) => !c.marketingOptIn && c.id !== b.customerId)!
    const offer = (customerId: string, address: string) => ({ businessId: DEMO.luna.businessId, id: newOfferId(), appointmentId: b.id, channel: 'sms' as const, createdAt: clock.toISOString(), recipients: [{ customerId, address, message: 'Spot open', status: 'queued' as const, updatedAt: '' }] })
    await engine.dispatchDue() // the cancellation notice
    provider.clear()
    await repo.saveAvailabilityOffer(offer(consenting.id, '+1 900 555 0000')) // spoofed address
    await engine.dispatchDue()
    expect(provider.outbox.map((m) => m.to)).toEqual([toE164(consenting.phone, 'US')])
    expect(await repo.saveAvailabilityOffer(offer(declined.id, declined.phone)).then(() => 'ok', (e) => e.code)).toBe('opted_out')
  })
})

let offerSeq = 0
const newOfferId = () => `ofr_t${++offerSeq}`
