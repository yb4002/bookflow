import { businessZone } from '../../src/domain/time'
import { isValidEmail, newId } from '../../src/domain/bookingRules'
import { isPhoneCountry, toE164 } from '../../src/domain/phone'
import type { LanguageCode, MessageChannel, NotificationKind } from '../../src/domain/types'
import type { DomainEvent } from '../domainEvents'
import type { Sql } from '../db/sqlite'
import type { EventBus } from '../events'
import type { AppointmentRow, CustomerRow, NotificationRow } from '../repositories/mappers'
import type { DeliveryReceipt, ProviderRegistry } from './provider'
import { renderMessage, type MessageFacts } from './templates'

export interface NotificationEngineOptions {
  sql: Sql
  providers: ProviderRegistry
  now?: () => Date
  /** Public origin used in links inside messages, e.g. https://book.example.com */
  publicBaseUrl: string
  /** Live-update bus (dashboard SSE). */
  events?: EventBus
  /** How long a dispatcher owns a claimed message. */
  leaseMs?: number
  /** Delay before retry n (1-based). The last value repeats. */
  retryBackoffMs?: number[]
  maxAttempts?: number
  log?: (message: string) => void
}

export interface DispatchSummary {
  sent: number
  retried: number
  failed: number
  cancelled: number
}

interface BusinessFacts {
  name: string
  phone: string
  slug: string
  timezone: string
  phone_country: string
  default_language: LanguageCode
  notification_channel: MessageChannel
  reminder_hours_before: string
}

const ACTIVE = new Set(['confirmed', 'pending'])
const MIN = 60_000

/**
 * Provider-independent notification engine.
 *
 * Planning (`handle`) turns domain events into rows in the `notifications` outbox — inside
 * the caller's transaction, so a booking and its messages commit (or roll back) together.
 * Every row has a deterministic dedupe key, so replays never create a second message.
 *
 * Delivery (`dispatchDue`) runs in the background: it leases due rows, re-checks they're
 * still relevant (a reminder for a cancelled visit is cancelled, not sent), renders the
 * template, calls the provider with the row id as idempotency key, and records the result
 * with retries + backoff for transient failures.
 */
export class NotificationEngine {
  private readonly sql: Sql
  private readonly now: () => Date
  private readonly leaseMs: number
  private readonly backoff: number[]
  private readonly maxAttempts: number
  private readonly log: (m: string) => void

  constructor(private readonly options: NotificationEngineOptions) {
    this.sql = options.sql
    this.now = options.now ?? (() => new Date())
    this.leaseMs = options.leaseMs ?? 2 * MIN
    this.backoff = options.retryBackoffMs ?? [1 * MIN, 5 * MIN, 15 * MIN]
    this.maxAttempts = options.maxAttempts ?? 3
    this.log = options.log ?? (() => {})
    for (const p of options.providers.providers) p.onReceipt?.((r) => this.recordReceipt(p.name, r))
  }

  /* ============================== Planning ============================== */

  /** Domain-event handler. Synchronous; runs inside the caller's transaction. */
  handle = (event: DomainEvent): void => {
    switch (event.type) {
      case 'appointment.booked':
        if (event.notify !== false) this.planForAppointment(event.appointmentId, 'confirmation', `confirmation:${event.appointmentId}`)
        this.planReminders(event.appointmentId)
        break
      case 'appointment.rescheduled': {
        this.cancelPending(event.appointmentId, ['reminder'], 'rescheduled')
        const a = this.appointment(event.appointmentId)
        if (a && event.notify !== false) this.planForAppointment(a.id, 'reschedule', `reschedule:${a.id}:${a.start_at}`, { previousStart: event.previousStart })
        this.planReminders(event.appointmentId)
        break
      }
      case 'appointment.cancelled':
        this.cancelPending(event.appointmentId, ['reminder', 'confirmation', 'reschedule'], 'appointment_cancelled')
        if (event.notify !== false) this.planForAppointment(event.appointmentId, 'cancellation', `cancellation:${event.appointmentId}`, { cancelledBy: event.by })
        break
      case 'appointment.reminder_requested': {
        // Sent now, on request. Keyed by the request time, so asking again later sends again.
        const a = this.appointment(event.appointmentId)
        if (a) this.planForAppointment(a.id, 'reminder', `reminder:manual:${a.id}:${this.now().toISOString()}`, { start: a.start_at, manual: true })
        break
      }
      case 'customer.message_requested':
        this.planMessage(event.businessId, event.customerId, event.body)
        break
      case 'customer.opted_out':
      case 'customer.erased':
        this.sql.run(
          `UPDATE notifications SET status = 'cancelled', cancelled_reason = ?, locked_until = NULL, updated_at = ?
           WHERE business_id = ? AND customer_id = ? AND status = 'pending'`,
          [event.type === 'customer.erased' ? 'customer_erased' : 'opted_out', this.now().toISOString(), event.businessId, event.customerId],
        )
        break
      case 'appointment.status_changed':
        if (ACTIVE.has(event.status)) this.planReminders(event.appointmentId)
        else this.cancelPending(event.appointmentId, ['reminder'], `status_${event.status}`)
        break
      case 'smart_fill.offer_saved':
        this.planSmartFill(event.offerId)
        break
    }
  }

  /** One reminder per configured lead time ("24h before", "2h before"), keyed by the start time. */
  private planReminders(appointmentId: string) {
    const a = this.appointment(appointmentId)
    if (!a || !ACTIVE.has(a.status) || a.reminders_opt_in === 0) return
    const business = this.business(a.business_id)
    const start = new Date(a.start_at).getTime()
    const earliest = this.now().getTime() + MIN
    for (const hours of JSON.parse(business.reminder_hours_before) as number[]) {
      const at = start - hours * 60 * MIN
      if (at < earliest) continue // too late for this one (booked last-minute)
      this.planForAppointment(a.id, 'reminder', `reminder:${a.id}:${a.start_at}:${hours}h`, { start: a.start_at, hoursBefore: hours }, new Date(at))
    }
  }

  private planForAppointment(appointmentId: string, kind: Exclude<NotificationKind, 'smart_fill_offer' | 'message'>, dedupeKey: string, payload: Record<string, unknown> = {}, at = this.now()) {
    const a = this.appointment(appointmentId)
    if (!a) return
    const business = this.business(a.business_id)
    const customer = this.sql.get<CustomerRow>('SELECT * FROM customers WHERE business_id = ? AND id = ?', [a.business_id, a.customer_id])!
    // Respect "stop": a client who opted out gets nothing (not even confirmations).
    if (customer.messaging_opt_out_at || customer.erased_at) return
    const { channel, recipient } = this.route(business.notification_channel, customer)
    this.insert({
      businessId: a.business_id,
      kind,
      channel,
      appointmentId: a.id,
      customerId: customer.id,
      recipient,
      locale: customer.preferred_language ?? business.default_language,
      payload: { start: a.start_at, ...payload },
      dedupeKey,
      scheduledFor: at,
    })
  }

  /** A message the business typed for one client, on the business's channel. */
  private planMessage(businessId: string, customerId: string, body: string) {
    const business = this.business(businessId)
    const customer = this.sql.get<CustomerRow>('SELECT * FROM customers WHERE business_id = ? AND id = ?', [businessId, customerId])
    if (!customer || customer.messaging_opt_out_at || customer.erased_at) return
    const { channel, recipient } = this.route(business.notification_channel, customer)
    this.insert({
      businessId,
      kind: 'message',
      channel,
      customerId,
      recipient,
      locale: customer.preferred_language ?? business.default_language,
      payload: { body },
      dedupeKey: `message:${customerId}:${newId('req')}`,
      scheduledFor: this.now(),
    })
  }

  private planSmartFill(offerId: string) {
    const offer = this.sql.get<{ business_id: string; appointment_id: string; channel: MessageChannel }>('SELECT business_id, appointment_id, channel FROM availability_offers WHERE id = ?', [offerId])
    if (!offer) return
    const business = this.business(offer.business_id)
    const recipients = this.sql.all<{ customer_id: string; address: string; message: string }>(
      "SELECT customer_id, address, message FROM offer_recipients WHERE offer_id = ? AND status = 'queued'",
      [offerId],
    )
    for (const r of recipients) {
      const customer = this.sql.get<CustomerRow>('SELECT * FROM customers WHERE business_id = ? AND id = ?', [offer.business_id, r.customer_id])
      if (!customer || customer.messaging_opt_out_at || customer.erased_at) continue
      this.insert({
        businessId: offer.business_id,
        kind: 'smart_fill_offer',
        channel: offer.channel,
        appointmentId: offer.appointment_id,
        customerId: r.customer_id,
        offerId,
        recipient: r.address,
        locale: customer?.preferred_language ?? business.default_language,
        // The business reviewed this exact text in the Smart Fill drawer.
        payload: { body: r.message },
        dedupeKey: `smart_fill:${offerId}:${r.customer_id}`,
        scheduledFor: this.now(),
      })
    }
  }

  /** Email needs an address; otherwise fall back to SMS so the client still hears from us. */
  private route(preferred: MessageChannel, customer: CustomerRow): { channel: MessageChannel; recipient: string } {
    if (preferred === 'email') return customer.email ? { channel: 'email', recipient: customer.email } : { channel: 'sms', recipient: customer.phone }
    return { channel: preferred, recipient: customer.phone }
  }

  private insert(n: { businessId: string; kind: NotificationKind; channel: MessageChannel; appointmentId?: string; customerId: string; offerId?: string; recipient: string; locale: LanguageCode; payload: Record<string, unknown>; dedupeKey: string; scheduledFor: Date }) {
    const ts = this.now().toISOString()
    // Idempotent: the same logical message (dedupe key) is created once. A message that was
    // cancelled earlier (e.g. a reminder before a reschedule that was later undone) is revived.
    this.sql.run(
      `INSERT INTO notifications (id, business_id, kind, channel, status, appointment_id, customer_id, offer_id, recipient, locale, payload,
         dedupe_key, scheduled_for, max_attempts, created_at, updated_at)
       VALUES (:id, :business_id, :kind, :channel, 'pending', :appointment_id, :customer_id, :offer_id, :recipient, :locale, :payload,
         :dedupe_key, :scheduled_for, :max_attempts, :ts, :ts)
       ON CONFLICT (dedupe_key) DO UPDATE SET status = 'pending', cancelled_reason = NULL, scheduled_for = excluded.scheduled_for,
         recipient = excluded.recipient, channel = excluded.channel, attempts = 0, last_error = NULL, locked_until = NULL, updated_at = excluded.updated_at
       WHERE notifications.status = 'cancelled'`,
      {
        id: newId('ntf'),
        business_id: n.businessId,
        kind: n.kind,
        channel: n.channel,
        appointment_id: n.appointmentId ?? null,
        customer_id: n.customerId,
        offer_id: n.offerId ?? null,
        recipient: n.recipient,
        locale: n.locale,
        payload: JSON.stringify(n.payload),
        dedupe_key: n.dedupeKey,
        scheduled_for: n.scheduledFor.toISOString(),
        max_attempts: this.maxAttempts,
        ts,
      },
    )
  }

  private cancelPending(appointmentId: string, kinds: NotificationKind[], reason: string) {
    this.sql.run(
      `UPDATE notifications SET status = 'cancelled', cancelled_reason = ?, locked_until = NULL, updated_at = ?
       WHERE appointment_id = ? AND status = 'pending' AND kind IN (${kinds.map(() => '?').join(',')})`,
      [reason, this.now().toISOString(), appointmentId, ...kinds],
    )
  }

  /* ============================== Delivery ============================== */

  /** Sends everything that is due. Safe to run concurrently (rows are leased) and repeatedly. */
  async dispatchDue(limit = 25): Promise<DispatchSummary> {
    const summary: DispatchSummary = { sent: 0, retried: 0, failed: 0, cancelled: 0 }
    const nowIso = this.now().toISOString()
    const due = this.sql.all<{ id: string }>(
      `SELECT id FROM notifications WHERE status = 'pending' AND scheduled_for <= ? AND (locked_until IS NULL OR locked_until <= ?)
       ORDER BY scheduled_for, created_at LIMIT ?`,
      [nowIso, nowIso, limit],
    )
    for (const { id } of due) {
      const outcome = await this.deliver(id)
      if (outcome) summary[outcome]++
    }
    return summary
  }

  private claim(id: string): NotificationRow | undefined {
    return this.sql.transaction(() => {
      const nowIso = this.now().toISOString()
      const r = this.sql.run(
        `UPDATE notifications SET locked_until = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status = 'pending' AND (locked_until IS NULL OR locked_until <= ?)`,
        [new Date(this.now().getTime() + this.leaseMs).toISOString(), nowIso, id, nowIso],
      )
      return r.changes === 1 ? this.sql.get<NotificationRow>('SELECT * FROM notifications WHERE id = ?', [id]) : undefined
    })
  }

  private async deliver(id: string): Promise<keyof DispatchSummary | null> {
    const row = this.claim(id)
    if (!row) return null // another dispatcher has it (or it changed)

    // 1. Still relevant?
    const stale = this.staleReason(row)
    if (stale) {
      this.finish(row, { status: 'cancelled', cancelled_reason: stale })
      return 'cancelled'
    }

    // 2. Render (appointment messages from current data; Smart Fill uses the reviewed text).
    let subject: string | undefined
    let body: string
    try {
      ;({ subject, body } = this.render(row))
    } catch (e) {
      this.finish(row, { status: 'failed', last_error: `render: ${(e as Error).message}` })
      return 'failed'
    }

    // 3. Send.
    const provider = this.options.providers.for(row.channel)
    if (!provider) {
      this.finish(row, { status: 'failed', last_error: `no provider for ${row.channel}` })
      return 'failed'
    }
    const address = this.address(row)
    if (!address.ok) {
      this.finish(row, { status: 'failed', last_error: address.error })
      return 'failed'
    }
    const result = await provider
      .send({ idempotencyKey: row.id, channel: row.channel, to: address.to, subject, body, locale: row.locale })
      .catch((e: unknown) => ({ ok: false as const, retryable: true, error: e instanceof Error ? e.message : String(e) }))

    // 4. Record.
    if (result.ok) {
      this.finish(row, { status: 'sent', sent_at: this.now().toISOString(), provider: provider.name, provider_message_id: result.providerMessageId, subject: subject ?? null, body })
      this.log(`[notify] sent ${row.kind} ${row.id} via ${provider.name}/${row.channel}`)
      return 'sent'
    }
    if (result.retryable && row.attempts < row.max_attempts) {
      const delay = this.backoff[Math.min(row.attempts - 1, this.backoff.length - 1)]
      this.finish(row, { status: 'pending', scheduled_for: new Date(this.now().getTime() + delay).toISOString(), last_error: result.error })
      this.log(`[notify] retry ${row.kind} ${row.id} in ${Math.round(delay / 1000)}s: ${result.error}`)
      return 'retried'
    }
    this.finish(row, { status: 'failed', last_error: result.error })
    this.log(`[notify] failed ${row.kind} ${row.id}: ${result.error}`)
    return 'failed'
  }

  /** Provider-ready address: E.164 for SMS/WhatsApp (read with the business's phone country), a valid email otherwise. */
  private address(row: NotificationRow): { ok: true; to: string } | { ok: false; error: string } {
    const raw = row.recipient.trim()
    if (!raw) return { ok: false, error: 'no recipient' }
    if (row.channel === 'email') return isValidEmail(raw) ? { ok: true, to: raw } : { ok: false, error: 'invalid email address' }
    const country = this.business(row.business_id).phone_country
    const e164 = toE164(raw, isPhoneCountry(country) ? country : 'US')
    return e164 ? { ok: true, to: e164 } : { ok: false, error: 'invalid phone number' }
  }

  /** Why a claimed message should no longer go out (null = send it). */
  private staleReason(row: NotificationRow): string | null {
    const customer = this.sql.get<{ messaging_opt_out_at: string | null; erased_at: string | null }>('SELECT messaging_opt_out_at, erased_at FROM customers WHERE business_id = ? AND id = ?', [row.business_id, row.customer_id])
    if (!customer || customer.erased_at) return 'customer_erased'
    if (customer.messaging_opt_out_at) return 'opted_out'
    if (!row.appointment_id) return null
    const a = this.appointment(row.appointment_id)
    if (!a) return 'appointment_deleted'
    const payload = JSON.parse(row.payload) as { start?: string }
    switch (row.kind) {
      case 'reminder':
        if (!ACTIVE.has(a.status)) return `status_${a.status}`
        if (a.reminders_opt_in === 0) return 'opted_out'
        if (payload.start !== a.start_at) return 'rescheduled'
        if (new Date(a.start_at) <= this.now()) return 'too_late'
        return null
      case 'confirmation':
      case 'reschedule':
        return ACTIVE.has(a.status) ? null : `status_${a.status}`
      case 'smart_fill_offer': {
        // Don't offer a slot that has been re-booked in the meantime.
        const rebooked = this.sql.get(
          `SELECT 1 FROM appointments WHERE business_id = ? AND staff_id = ? AND id <> ? AND status IN ('confirmed','pending') AND start_at < ? AND end_at > ?`,
          [a.business_id, a.staff_id, a.id, a.end_at, a.start_at],
        )
        return rebooked ? 'slot_filled' : null
      }
      default:
        return null
    }
  }

  private render(row: NotificationRow): { subject?: string; body: string } {
    const payload = JSON.parse(row.payload) as { body?: string; previousStart?: string; cancelledBy?: 'customer' | 'business' }
    if (row.kind === 'smart_fill_offer' || row.kind === 'message') return { subject: row.kind === 'message' ? this.business(row.business_id).name : undefined, body: payload.body ?? '' }
    const a = this.appointment(row.appointment_id!)!
    const business = this.business(row.business_id)
    const facts = this.sql.get<{ first_name: string; service_name: string; staff_name: string }>(
      `SELECT c.first_name, sv.name AS service_name, st.name AS staff_name
       FROM appointments a
       JOIN customers c ON c.business_id = a.business_id AND c.id = a.customer_id
       JOIN services sv ON sv.business_id = a.business_id AND sv.id = a.service_id
       JOIN staff st ON st.business_id = a.business_id AND st.id = a.staff_id
       WHERE a.id = ?`,
      [a.id],
    )!
    const base = this.options.publicBaseUrl.replace(/\/$/, '')
    const messageFacts: MessageFacts = {
      businessName: business.name,
      businessPhone: business.phone,
      customerFirstName: facts.first_name,
      serviceName: facts.service_name,
      staffName: facts.staff_name.split(' ')[0],
      start: new Date(a.start_at),
      previousStart: payload.previousStart ? new Date(payload.previousStart) : undefined,
      manageUrl: `${base}/book/${business.slug}/manage/${a.manage_token ?? ''}`,
      bookUrl: `${base}/book/${business.slug}`,
      cancelledBy: payload.cancelledBy,
    }
    return renderMessage(row.kind as Exclude<NotificationKind, 'smart_fill_offer' | 'message'>, row.locale, messageFacts, businessZone(business))
  }

  private finish(row: NotificationRow, changes: Partial<Record<keyof NotificationRow, string | number | null>>) {
    const topics = new Set<'offers' | 'appointments' | 'notifications'>(['notifications'])
    this.sql.transaction(() => {
      const fields = { ...changes, locked_until: null, updated_at: this.now().toISOString() }
      const keys = Object.keys(fields)
      this.sql.run(`UPDATE notifications SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :id`, { ...(fields as Record<string, string | number | null>), id: row.id })

      // Side effects on business records.
      if (row.kind === 'reminder' && changes.status === 'sent' && row.appointment_id) {
        this.sql.run('UPDATE appointments SET reminder_sent = 1 WHERE id = ?', [row.appointment_id])
        topics.add('appointments')
      }
      if (row.kind === 'smart_fill_offer' && row.offer_id && (changes.status === 'sent' || changes.status === 'failed' || changes.status === 'cancelled')) {
        const status = changes.status === 'sent' ? 'sent' : 'failed'
        this.sql.run('UPDATE offer_recipients SET status = ?, updated_at = ? WHERE offer_id = ? AND customer_id = ?', [status, this.now().toISOString(), row.offer_id, row.customer_id])
        topics.add('offers')
      }
    })
    if (topics.size) this.options.events?.publish(row.business_id, [...topics])
  }

  /** Provider delivery receipt (webhook in real providers). */
  recordReceipt(providerName: string, receipt: DeliveryReceipt) {
    const row = this.sql.get<NotificationRow>('SELECT * FROM notifications WHERE provider = ? AND provider_message_id = ?', [providerName, receipt.providerMessageId])
    if (!row) return
    this.sql.transaction(() => {
      if (receipt.status === 'delivered') {
        this.sql.run('UPDATE notifications SET delivered_at = ?, updated_at = ? WHERE id = ? AND delivered_at IS NULL', [receipt.at, this.now().toISOString(), row.id])
        if (row.offer_id) this.sql.run("UPDATE offer_recipients SET status = 'delivered', updated_at = ? WHERE offer_id = ? AND customer_id = ?", [receipt.at, row.offer_id, row.customer_id])
      } else {
        this.sql.run("UPDATE notifications SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", [receipt.error ?? 'undelivered', this.now().toISOString(), row.id])
        if (row.offer_id) this.sql.run("UPDATE offer_recipients SET status = 'failed', updated_at = ? WHERE offer_id = ? AND customer_id = ?", [receipt.at, row.offer_id, row.customer_id])
      }
    })
    if (row.offer_id) this.options.events?.publish(row.business_id, ['offers'])
  }

  /* ============================== helpers ============================== */

  private appointment(id: string) {
    return this.sql.get<AppointmentRow & { reminders_opt_in: number }>('SELECT * FROM appointments WHERE id = ?', [id])
  }
  private business(id: string): BusinessFacts {
    return this.sql.get<BusinessFacts>(
      `SELECT b.name, b.phone, b.timezone, s.phone_country, l.slug, s.default_language, s.notification_channel, s.reminder_hours_before
       FROM businesses b JOIN business_settings s ON s.business_id = b.id JOIN booking_links l ON l.business_id = b.id AND l.is_primary = 1
       WHERE b.id = ?`,
      [id],
    )!
  }
}
