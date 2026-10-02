import { addMinutes, differenceInMinutes } from 'date-fns'
import { BookingError } from './errors'
import { isPhoneCountry } from './phone'
import type { Appointment, BookingPolicies, BookingSource, Business, BusinessSettings, CancellationReason, CustomerTag, ID, LanguageCode } from './types'

/**
 * Pure booking business rules — no storage, no UI. The repository applies them to
 * stored records; a server can run the exact same functions.
 */

export const phoneDigits = (phone: string) => phone.replace(/\D/g, '')
export const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ')

const isStr = (v: unknown): v is string => typeof v === 'string'

export function validateCustomerInput(name: unknown, phone: unknown): { name: boolean; phone: boolean } {
  return {
    name: !isStr(name) || normalizeName(name).length < 2 || name.length > 120,
    phone: !isStr(phone) || !isValidPhone(phone),
  }
}

/** Loose international phone check: 7–15 digits, only phone punctuation. */
export const isValidPhone = (phone: string) => phoneDigits(phone).length >= 7 && phoneDigits(phone).length <= 15 && !/[^\d\s()+\-.]/.test(phone)
export const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/
export const isValidEmail = (email: string) => email.length <= 254 && EMAIL_PATTERN.test(email)

export function splitName(fullName: string) {
  const [firstName, ...rest] = normalizeName(fullName).split(' ')
  return { firstName, lastName: rest.join(' ') }
}

const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L
/** Short, human-friendly booking reference that avoids look-alike characters. */
export function generateReference(isTaken: (ref: string) => boolean, random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const ref = Array.from({ length: 6 }, () => REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)]).join('')
    if (!isTaken(ref)) return ref
  }
  throw new Error('Could not generate a unique reference')
}

/** 128-bit random token (hex) for manage-booking links — uses the platform CSPRNG. */
export function newManageToken(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
export const isManageToken = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v)

export const newId = (prefix: string, random: () => number = Math.random) =>
  `${prefix}_${Date.now().toString(36)}${Math.floor(random() * 36 ** 5).toString(36).padStart(5, '0')}`

/** Throws unless the customer may still change (reschedule/cancel) this appointment at `now`. */
export function assertChangeable(appt: Appointment, business: Pick<Business, 'policies'>, now: Date): void {
  if (appt.status === 'cancelled') throw new BookingError('already_cancelled')
  if (appt.status !== 'confirmed' && appt.status !== 'pending') throw new BookingError('not_changeable')
  const minutesLeft = differenceInMinutes(new Date(appt.start), now)
  if (minutesLeft <= 0) throw new BookingError('not_changeable')
  if (minutesLeft < business.policies.cancellationWindowHours * 60) throw new BookingError('change_window_closed')
}

/** Moves an appointment, keeping service, booked price, duration and staff member. */
export function applyReschedule(appt: Appointment, newStart: Date, now: Date): Appointment {
  if (newStart.getTime() === new Date(appt.start).getTime()) throw new BookingError('invalid_input')
  const duration = differenceInMinutes(new Date(appt.end), new Date(appt.start))
  return {
    ...appt,
    previousStart: appt.start,
    rescheduledAt: now.toISOString(),
    start: newStart.toISOString(),
    end: addMinutes(newStart, duration).toISOString(),
    reminderSent: false,
  }
}

export function applyCancellation(appt: Appointment, by: 'customer' | 'business', now: Date, reason?: CancellationReason): Appointment {
  return { ...appt, status: 'cancelled', cancelledAt: now.toISOString(), cancelledBy: by, cancellationReason: reason }
}

/** Status change made by the business from the dashboard (completed, no-show, cancelled…). */
export function applyStatusChange(appt: Appointment, status: Appointment['status'], now: Date): Appointment {
  if (status === 'cancelled') return applyCancellation(appt, 'business', now)
  return { ...appt, status, cancelledAt: undefined, cancelledBy: undefined, cancellationReason: undefined }
}

/* ---------------- Business settings ---------------- */

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
const RESERVED_SLUGS = new Set(['app', 'book', 'admin', 'api', 'login', 'signup'])

/** Lowercases and hyphenates free text into a candidate slug ("Luna Hair!" → "luna-hair"). */
export const slugify = (text: string) =>
  text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

export function validateSlug(slug: string, isTakenByOther: (slug: string) => boolean): void {
  if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.has(slug)) throw new BookingError('invalid_slug')
  if (isTakenByOther(slug)) throw new BookingError('slug_taken')
}

export function validatePolicies(policies: BookingPolicies): void {
  if (!['sms', 'whatsapp', 'email'].includes(policies.notificationChannel)) throw new BookingError('invalid_input')
  if (!policies.reminderHoursBefore.every((h) => Number.isInteger(h) && h > 0 && h <= 168)) throw new BookingError('invalid_input')
}

export function validateSettings(settings: BusinessSettings): void {
  if (!settings || !['en', 'he'].includes(settings.defaultLanguage)) throw new BookingError('invalid_input')
  if (!['auto', 'USD', 'ILS'].includes(settings.currency)) throw new BookingError('invalid_input')
  if (settings.phoneCountry !== undefined && !isPhoneCountry(settings.phoneCountry)) throw new BookingError('invalid_input')
}

export const ownedBy = (businessId: ID) => (row: { businessId: ID }) => row.businessId === businessId

/* ---------------- Catalog & team ---------------- */

export interface ServiceInput {
  name: string
  category: string
  description: string
  durationMin: number
  bufferMin: number
  price: number
  active: boolean
}

export function validateService(s: ServiceInput): void {
  if (!s || !isStr(s.name) || !isStr(s.category ?? '') || !isStr(s.description ?? '') || typeof s.active !== 'boolean') throw new BookingError('invalid_input')
  const ok =
    s.name.trim().length >= 1 && s.name.trim().length <= 80 &&
    Number.isInteger(s.durationMin) && s.durationMin >= 5 && s.durationMin <= 12 * 60 &&
    Number.isInteger(s.bufferMin) && s.bufferMin >= 0 && s.bufferMin <= 240 &&
    Number.isFinite(s.price) && s.price >= 0 && s.price <= 1_000_000
  if (!ok) throw new BookingError('invalid_input')
}

export interface StaffInput {
  name: string
  role: string
  color: 'indigo' | 'teal' | 'amber' | 'rose'
  serviceIds: ID[]
  availability?: Record<number, { open: boolean; start: string; end: string }>
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
export function validateHours(hours: Record<number, { open: boolean; start: string; end: string }>): void {
  if (!hours || typeof hours !== 'object') throw new BookingError('invalid_input')
  for (let d = 0; d < 7; d++) {
    const h = hours[d]
    if (!h || typeof h.open !== 'boolean' || !HHMM.test(h.start) || !HHMM.test(h.end)) throw new BookingError('invalid_input')
    if (h.open && h.end <= h.start) throw new BookingError('invalid_input')
  }
}

export function validateStaff(s: StaffInput): void {
  if (!s || !isStr(s.name) || !isStr(s.role ?? '') || !Array.isArray(s.serviceIds) || !s.serviceIds.every(isStr)) throw new BookingError('invalid_input')
  if (normalizeName(s.name).length < 2 || s.name.length > 80) throw new BookingError('invalid_input')
  if (!['indigo', 'teal', 'amber', 'rose'].includes(s.color)) throw new BookingError('invalid_input')
  if (s.availability) validateHours(s.availability)
}

export const initialsFor = (name: string) =>
  normalizeName(name).split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

/** IANA time zone check using the runtime's own data. */
export { isValidTimeZone } from './time'

/* ---------------- Clients ---------------- */

export const CUSTOMER_TAGS: CustomerTag[] = ['VIP', 'New', 'Regular', 'At risk']

/** What the business enters for a client. */
export interface CustomerInput {
  firstName: string
  lastName: string
  phone: string
  email: string
  notes?: string
  marketingOptIn: boolean
  preferredLanguage?: LanguageCode
  tags?: CustomerTag[]
}

export function validateCustomer(c: CustomerInput): void {
  const ok =
    !!c && isStr(c.firstName) && normalizeName(c.firstName).length >= 1 && c.firstName.length <= 60 &&
    isStr(c.lastName) && c.lastName.length <= 60 &&
    isStr(c.phone) && isValidPhone(c.phone) &&
    isStr(c.email) && (c.email.trim() === '' || isValidEmail(c.email.trim())) &&
    (c.notes === undefined || (isStr(c.notes) && c.notes.length <= 2000)) &&
    typeof c.marketingOptIn === 'boolean' &&
    (c.preferredLanguage === undefined || c.preferredLanguage === 'en' || c.preferredLanguage === 'he') &&
    (c.tags === undefined || (Array.isArray(c.tags) && c.tags.every((t) => CUSTOMER_TAGS.includes(t))))
  if (!ok) throw new BookingError('invalid_input')
}

/** Trimmed, normalized copy of a client's details. */
export const cleanCustomer = (c: CustomerInput): CustomerInput => ({
  ...c,
  firstName: normalizeName(c.firstName),
  lastName: normalizeName(c.lastName),
  phone: c.phone.trim(),
  email: c.email.trim().toLowerCase(),
  notes: c.notes?.trim() || undefined,
})

/* ---------------- Business-side bookings ---------------- */

export const BOOKING_SOURCES: BookingSource[] = ['online', 'phone', 'walk_in', 'instagram']

/** An appointment the business enters (phone call, walk-in, DM). */
export interface BusinessBookingInput {
  /** Existing client… */
  customerId?: ID
  /** …or a new one. */
  customer?: CustomerInput
  serviceId: ID
  staffId: ID
  /** ISO start. Any time — the business may book outside the online grid — but never overlapping. */
  start: string
  notes?: string
  source: BookingSource
  /** Send the client a confirmation now (reminders follow the business's settings either way). */
  notify: boolean
}

/** The business can record up to a week back (walk-ins entered late) and book up to two years ahead. */
export function validateBusinessBooking(input: BusinessBookingInput, now: Date): Date {
  const start = isStr(input?.start) ? new Date(input.start) : new Date(NaN)
  const ok =
    !Number.isNaN(start.getTime()) &&
    start.getTime() > now.getTime() - 7 * 86_400_000 && start.getTime() < now.getTime() + 730 * 86_400_000 &&
    isStr(input.serviceId) && isStr(input.staffId) &&
    BOOKING_SOURCES.includes(input.source) && typeof input.notify === 'boolean' &&
    (input.notes === undefined || (isStr(input.notes) && input.notes.length <= 2000)) &&
    (isStr(input.customerId) !== (input.customer !== undefined))
  if (!ok) throw new BookingError('invalid_input')
  if (input.customer) validateCustomer(input.customer)
  return start
}

/** Moves an appointment from the dashboard: optionally to another team member; keeps service and price. */
export function applyBusinessMove(appt: Appointment, newStart: Date, staffId: ID, now: Date): Appointment {
  if (appt.status !== 'confirmed' && appt.status !== 'pending') throw new BookingError('not_changeable')
  if (newStart.getTime() === new Date(appt.start).getTime() && staffId === appt.staffId) throw new BookingError('invalid_input')
  const duration = differenceInMinutes(new Date(appt.end), new Date(appt.start))
  return {
    ...appt,
    staffId,
    previousStart: appt.start,
    rescheduledAt: now.toISOString(),
    start: newStart.toISOString(),
    end: addMinutes(newStart, duration).toISOString(),
    reminderSent: false,
  }
}

/** Free-text message from the business to one client (SMS-friendly length). */
export function validateMessageBody(body: unknown): string {
  if (!isStr(body) || !body.trim() || body.length > 640) throw new BookingError('invalid_input')
  return body.trim()
}

/** Personal data removed from an erased client; their visit history stays for the business's records. */
export const ERASED_NAME = '—'
