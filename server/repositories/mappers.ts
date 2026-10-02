import type {
  Appointment,
  AvailabilityOffer,
  Business,
  BusinessSettings,
  Customer,
  CustomerTag,
  NotificationRecord,
  DayHours,
  Service,
  StaffMember,
  Weekday,
  WeeklyHours,
} from '../../src/domain/types'

/** Row shapes as stored, and pure converters to/from the domain model. */

export const toMinor = (amount: number) => Math.round(amount * 100)
export const fromMinor = (minor: number) => minor / 100
const bool = (v: number | bigint) => Number(v) === 1
const flag = (v: boolean) => (v ? 1 : 0)

export interface BusinessRow {
  id: string; name: string; description: string; category: string; timezone: string; phone: string; email: string; address: string; created_at: string; updated_at: string
  logo_url?: string | null; cover_url?: string | null; published_at?: string | null; onboarding_completed_at?: string | null
  slug: string
  default_language: 'en' | 'he'; currency: BusinessSettings['currency']; phone_country?: string
  min_notice_hours: number; max_advance_days: number; cancellation_window_hours: number; require_deposit: number; deposit_percent: number; auto_confirm: number; reminder_hours_before: string; waitlist_enabled: number
  notification_channel: Business['policies']['notificationChannel']
}
export interface HoursRow { weekday: number; is_open: number; opens_at: string; closes_at: string }

export function toBusiness(row: BusinessRow, hours: HoursRow[]): Business {
  const week = {} as WeeklyHours
  for (let d = 0; d < 7; d++) week[d as Weekday] = { open: false, start: '09:00', end: '17:00' }
  for (const h of hours) week[h.weekday as Weekday] = { open: bool(h.is_open), start: h.opens_at, end: h.closes_at } satisfies DayHours
  return {
    id: row.id, slug: row.slug, name: row.name, description: row.description, category: row.category, timezone: row.timezone,
    phone: row.phone, email: row.email, address: row.address, hours: week,
    policies: {
      minNoticeHours: row.min_notice_hours, maxAdvanceDays: row.max_advance_days, cancellationWindowHours: row.cancellation_window_hours,
      requireDeposit: bool(row.require_deposit), depositPercent: row.deposit_percent, autoConfirm: bool(row.auto_confirm),
      reminderHoursBefore: JSON.parse(row.reminder_hours_before) as number[], waitlistEnabled: bool(row.waitlist_enabled),
      notificationChannel: row.notification_channel,
    },
    settings: { defaultLanguage: row.default_language, currency: row.currency, phoneCountry: (row.phone_country ?? 'US') as BusinessSettings['phoneCountry'] },
    ...(row.logo_url ? { logoUrl: row.logo_url } : {}),
    ...(row.cover_url ? { coverUrl: row.cover_url } : {}),
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    ...(row.onboarding_completed_at ? { onboardingCompletedAt: row.onboarding_completed_at } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export interface StaffHoursRow { staff_id: string; weekday: number; is_working: number; starts_at: string; ends_at: string }
/** Groups staff_hours rows into a WeeklyHours per staff member. */
export function toStaffAvailability(rows: StaffHoursRow[]): Map<string, WeeklyHours> {
  const out = new Map<string, WeeklyHours>()
  for (const r of rows) {
    const week = out.get(r.staff_id) ?? ({} as WeeklyHours)
    week[r.weekday as Weekday] = { open: bool(r.is_working), start: r.starts_at, end: r.ends_at }
    out.set(r.staff_id, week)
  }
  return out
}

export const settingsParams = (b: Pick<Business, 'policies' | 'settings' | 'updatedAt'>) => ({
  default_language: b.settings.defaultLanguage,
  phone_country: b.settings.phoneCountry ?? 'US',
  currency: b.settings.currency,
  min_notice_hours: b.policies.minNoticeHours,
  max_advance_days: b.policies.maxAdvanceDays,
  cancellation_window_hours: b.policies.cancellationWindowHours,
  require_deposit: flag(b.policies.requireDeposit),
  deposit_percent: b.policies.depositPercent,
  auto_confirm: flag(b.policies.autoConfirm),
  reminder_hours_before: JSON.stringify(b.policies.reminderHoursBefore),
  waitlist_enabled: flag(b.policies.waitlistEnabled),
  notification_channel: b.policies.notificationChannel,
  updated_at: b.updatedAt,
})

/** The settings UPDATE shared by settings saves and demo resets. */
export const UPDATE_SETTINGS_SQL = `UPDATE business_settings SET default_language = :default_language, currency = :currency, phone_country = :phone_country,
  min_notice_hours = :min_notice_hours, max_advance_days = :max_advance_days, cancellation_window_hours = :cancellation_window_hours,
  require_deposit = :require_deposit, deposit_percent = :deposit_percent, auto_confirm = :auto_confirm,
  reminder_hours_before = :reminder_hours_before, waitlist_enabled = :waitlist_enabled, notification_channel = :notification_channel,
  updated_at = :updated_at WHERE business_id = :business_id`

export interface StaffRow { id: string; business_id: string; name: string; role: string; color: StaffMember['color']; avatar_initials: string; service_ids: string | null }
export const toStaff = (r: StaffRow): StaffMember => ({
  businessId: r.business_id, id: r.id, name: r.name, role: r.role, color: r.color, avatarInitials: r.avatar_initials,
  serviceIds: r.service_ids ? r.service_ids.split(',') : [],
})

export interface ServiceRow { id: string; business_id: string; name: string; category: string; description: string; duration_min: number; buffer_min: number; price_minor: number; active: number }
export const toService = (r: ServiceRow): Service => ({
  businessId: r.business_id, id: r.id, name: r.name, category: r.category, description: r.description,
  durationMin: r.duration_min, bufferMin: r.buffer_min, price: fromMinor(r.price_minor), active: bool(r.active),
})
export const serviceParams = (s: Service) => ({
  id: s.id, business_id: s.businessId, name: s.name, category: s.category, description: s.description,
  duration_min: s.durationMin, buffer_min: s.bufferMin, price_minor: toMinor(s.price), active: flag(s.active),
})

export interface CustomerRow { id: string; business_id: string; first_name: string; last_name: string; email: string; phone: string; tags: string; notes: string | null; marketing_opt_in: number; created_at: string; preferred_language?: 'en' | 'he' | null; messaging_opt_out_at?: string | null; erased_at?: string | null }
export const toCustomer = (r: CustomerRow): Customer => {
  const c: Customer = {
    businessId: r.business_id, id: r.id, firstName: r.first_name, lastName: r.last_name, email: r.email, phone: r.phone,
    tags: JSON.parse(r.tags) as CustomerTag[], notes: r.notes ?? undefined, marketingOptIn: bool(r.marketing_opt_in), createdAt: r.created_at,
  }
  if (r.preferred_language) c.preferredLanguage = r.preferred_language
  if (r.messaging_opt_out_at) c.messagingOptOut = true
  return c
}
export const customerParams = (c: Customer) => ({
  id: c.id, business_id: c.businessId, first_name: c.firstName, last_name: c.lastName, email: c.email, phone: c.phone,
  phone_digits: c.phone.replace(/\D/g, ''), tags: JSON.stringify(c.tags), notes: c.notes ?? null, marketing_opt_in: flag(c.marketingOptIn), created_at: c.createdAt,
})

export interface AppointmentRow {
  id: string; business_id: string; customer_id: string; staff_id: string; service_id: string; start_at: string; end_at: string
  status: Appointment['status']; source: Appointment['source']; price_minor: number; notes: string | null; reminder_sent: number; reference: string | null
  cancelled_at: string | null; cancelled_by: Appointment['cancelledBy'] | null; cancellation_reason: Appointment['cancellationReason'] | null
  rescheduled_at: string | null; previous_start_at: string | null
  reminders_opt_in?: number
  manage_token?: string | null
}
const opt = <T,>(v: T | null) => (v === null ? undefined : v)
export const toAppointment = (r: AppointmentRow): Appointment => {
  const a: Appointment = {
    businessId: r.business_id, id: r.id, customerId: r.customer_id, staffId: r.staff_id, serviceId: r.service_id,
    start: r.start_at, end: r.end_at, status: r.status, source: r.source, price: fromMinor(r.price_minor), reminderSent: bool(r.reminder_sent),
  }
  // Only set optional fields that have values (keeps payloads small and equal to the local implementation).
  const extra: Partial<Appointment> = {
    notes: opt(r.notes), reference: opt(r.reference), manageToken: opt(r.manage_token ?? null), cancelledAt: opt(r.cancelled_at), cancelledBy: opt(r.cancelled_by),
    cancellationReason: opt(r.cancellation_reason), rescheduledAt: opt(r.rescheduled_at), previousStart: opt(r.previous_start_at),
    // Only surfaced when the client opted out, so default records stay identical across implementations.
    remindersOptIn: r.reminders_opt_in === 0 ? false : undefined,
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) (a as unknown as Record<string, unknown>)[k] = v
  return a
}
export const appointmentParams = (a: Appointment, now: string) => ({
  id: a.id, business_id: a.businessId, customer_id: a.customerId, staff_id: a.staffId, service_id: a.serviceId,
  start_at: a.start, end_at: a.end, status: a.status, source: a.source, price_minor: toMinor(a.price), notes: a.notes ?? null,
  reminder_sent: flag(a.reminderSent), reference: a.reference ?? null, manage_token: a.manageToken ?? null, cancelled_at: a.cancelledAt ?? null, cancelled_by: a.cancelledBy ?? null,
  cancellation_reason: a.cancellationReason ?? null, rescheduled_at: a.rescheduledAt ?? null, previous_start_at: a.previousStart ?? null,
  created_at: now, updated_at: now,
})

export interface OfferRow { id: string; business_id: string; appointment_id: string; channel: AvailabilityOffer['channel']; created_at: string }
export interface RecipientRow { offer_id: string; customer_id: string; address: string; message: string; status: AvailabilityOffer['recipients'][number]['status']; updated_at: string }
export const toOffer = (o: OfferRow, recipients: RecipientRow[]): AvailabilityOffer => ({
  businessId: o.business_id, id: o.id, appointmentId: o.appointment_id, channel: o.channel, createdAt: o.created_at,
  recipients: recipients.map((r) => ({ customerId: r.customer_id, address: r.address, message: r.message, status: r.status, updatedAt: r.updated_at })),
})

export interface NotificationRow {
  id: string; business_id: string; kind: NotificationRecord['kind']; channel: NotificationRecord['channel']; status: NotificationRecord['status']
  appointment_id: string | null; customer_id: string; offer_id: string | null; recipient: string; locale: 'en' | 'he'; payload: string; dedupe_key: string
  scheduled_for: string; attempts: number; max_attempts: number; last_error: string | null; locked_until: string | null
  provider: string | null; provider_message_id: string | null; subject: string | null; body: string | null
  sent_at: string | null; delivered_at: string | null; cancelled_reason: string | null; created_at: string; updated_at: string
}
export const toNotification = (r: NotificationRow): NotificationRecord => {
  const n: NotificationRecord = {
    businessId: r.business_id, id: r.id, kind: r.kind, channel: r.channel, status: r.status, customerId: r.customer_id,
    recipient: r.recipient, locale: r.locale, scheduledFor: r.scheduled_for, attempts: r.attempts, createdAt: r.created_at,
  }
  if (r.appointment_id) n.appointmentId = r.appointment_id
  if (r.sent_at) n.sentAt = r.sent_at
  if (r.delivered_at) n.deliveredAt = r.delivered_at
  if (r.last_error) n.lastError = r.last_error
  return n
}
