/**
 * Core domain model for BookFlow.
 * These types are the contract between the UI and the data layer. When a real
 * backend arrives, API responses should be mapped into these shapes.
 */

import type { PhoneCountry } from './phone'

export type ID = string

/** UI languages a business can choose as default (mirrors i18n locales). */
export type LanguageCode = 'en' | 'he'
/** ISO 4217 codes the product supports today. */
export type CurrencyCode = 'USD' | 'ILS'

export interface BusinessSettings {
  /** Language the public booking page opens in when the visitor hasn't chosen one. */
  defaultLanguage: LanguageCode
  /** Display currency. `auto` follows the viewer's language (English → USD, Hebrew → ILS). */
  currency: 'auto' | CurrencyCode
  /** How local phone numbers are read (for SMS/WhatsApp delivery). */
  phoneCountry?: PhoneCountry
}

export interface Business {
  id: ID
  /** URL-safe handle for the public booking page: /book/<slug>. The booking link is derived from it. */
  slug: string
  name: string
  /** Short public description shown on the booking page (entered by the business). */
  description: string
  category: string
  timezone: string
  phone: string
  email: string
  address: string
  hours: WeeklyHours
  policies: BookingPolicies
  settings: BusinessSettings
  /** Public URL of the uploaded logo / cover image (served by the API). */
  logoUrl?: string
  coverUrl?: string
  /** Set when the owner publishes the booking page; unpublished pages are visible only to the owner (preview). */
  publishedAt?: string
  /** Set when the owner finished the onboarding wizard. */
  onboardingCompletedAt?: string
  createdAt: string // ISO
  updatedAt: string // ISO
}

/** Every tenant-owned record carries its business — the multi-business (SaaS) boundary. */
export interface TenantOwned {
  businessId: ID
}

/** 0 = Sunday … 6 = Saturday */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface DayHours {
  open: boolean
  /** "HH:mm" 24h */
  start: string
  end: string
}

export type WeeklyHours = Record<Weekday, DayHours>

export interface BookingPolicies {
  minNoticeHours: number
  maxAdvanceDays: number
  cancellationWindowHours: number
  requireDeposit: boolean
  depositPercent: number
  autoConfirm: boolean
  reminderHoursBefore: number[]
  waitlistEnabled: boolean
  /** Channel used for confirmations and reminders (provider chosen by the server). */
  notificationChannel: MessageChannel
}

export interface StaffMember extends TenantOwned {
  id: ID
  name: string
  role: string
  color: StaffColor
  serviceIds: ID[]
  avatarInitials: string
  /** Personal working hours (within the business's opening hours). Undefined = works all opening hours. */
  availability?: WeeklyHours
}

export type StaffColor = 'indigo' | 'teal' | 'amber' | 'rose'

export interface Service extends TenantOwned {
  id: ID
  name: string
  category: string
  durationMin: number
  price: number
  description: string
  active: boolean
  bufferMin: number
}

export type CustomerTag = 'VIP' | 'New' | 'Regular' | 'At risk'

export interface Customer extends TenantOwned {
  id: ID
  firstName: string
  lastName: string
  email: string
  phone: string
  createdAt: string // ISO
  tags: CustomerTag[]
  notes?: string
  marketingOptIn: boolean
  /** Language for messages to this client (set from the booking page they used). */
  preferredLanguage?: LanguageCode
  /** Client replied STOP (or asked not to be messaged): only nothing is sent, not even reminders. */
  messagingOptOut?: boolean
}

export type AppointmentStatus =
  | 'confirmed'
  | 'pending'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type BookingSource = 'online' | 'phone' | 'walk_in' | 'instagram'

/** Lightweight, optional reason a customer gives when cancelling online. */
export type CancellationReason = 'schedule_conflict' | 'unwell' | 'found_alternative' | 'other'

export interface Appointment extends TenantOwned {
  id: ID
  customerId: ID
  staffId: ID
  serviceId: ID
  start: string // ISO
  end: string // ISO
  status: AppointmentStatus
  source: BookingSource
  price: number
  notes?: string
  reminderSent: boolean
  /** Set when status becomes `cancelled` — drives Smart Fill's "cancelled 18 min ago". */
  cancelledAt?: string // ISO
  /** Short, human-readable booking code shown to the client (e.g. "K7Q2MX"). Not a secret. */
  reference?: string
  /** Unguessable token in the client's manage-booking link (/book/<slug>/manage/<token>). */
  manageToken?: string
  /** Who cancelled, and why (customer-provided, optional). */
  cancelledBy?: 'customer' | 'business'
  cancellationReason?: CancellationReason
  /** Set when the customer moves the appointment; the original start is kept for the business. */
  rescheduledAt?: string // ISO
  previousStart?: string // ISO
  /** Client agreed to appointment reminders when booking (default true). */
  remindersOptIn?: boolean
}

/** Appointment joined with its related entities — what most screens render. */
export interface AppointmentView extends Appointment {
  customer: Customer
  staff: StaffMember
  service: Service
}

/** Derived per-customer stats (computed, never stored). */
export interface CustomerStats {
  totalVisits: number
  noShows: number
  lifetimeValue: number
  lastVisit?: string
  nextAppointment?: string
}

export interface CustomerWithStats extends Customer, CustomerStats {}

/* ---------------- Smart Fill: availability offers ---------------- */

export type MessageChannel = 'whatsapp' | 'sms' | 'email'

/** Lifecycle of one outbound message, as reported by the notification provider. */
export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'failed'

export interface OfferRecipient {
  customerId: ID
  /** Phone number or email address the message was sent to. */
  address: string
  /** Fully rendered, personalized message body. */
  message: string
  status: DeliveryStatus
  updatedAt: string // ISO
}

/* ---------------- Notifications ---------------- */

/** `message`: a free-text message the business wrote to one client. */
export type NotificationKind = 'confirmation' | 'reminder' | 'reschedule' | 'cancellation' | 'smart_fill_offer' | 'message'
/** pending → sent | failed | cancelled (a pending message that became pointless, e.g. a reminder for a cancelled visit). */
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'cancelled'

/** One outbound message, as recorded by the notification engine. */
export interface NotificationRecord extends TenantOwned {
  id: ID
  kind: NotificationKind
  channel: MessageChannel
  status: NotificationStatus
  appointmentId?: ID
  customerId: ID
  /** Phone number or email the message goes (went) to. */
  recipient: string
  locale: LanguageCode
  /** When it is due (reminders) or was queued (immediate messages). */
  scheduledFor: string
  sentAt?: string
  deliveredAt?: string
  attempts: number
  lastError?: string
  createdAt: string
}

/** An open slot offered to selected clients ("first to reply gets it"). */
export interface AvailabilityOffer extends TenantOwned {
  id: ID
  /** The cancelled appointment whose time slot is being offered. */
  appointmentId: ID
  channel: MessageChannel
  createdAt: string // ISO
  recipients: OfferRecipient[]
}
