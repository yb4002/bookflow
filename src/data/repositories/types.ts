import type { DayAvailability } from '@/domain/availability'
import type { BusinessBookingInput, CustomerInput, ServiceInput, StaffInput } from '@/domain/bookingRules'
import type {
  AppointmentStatus,
  AppointmentView,
  AvailabilityOffer,
  Business,
  CancellationReason,
  Customer,
  CustomerWithStats,
  ID,
  LanguageCode,
  NotificationRecord,
  Service,
  StaffMember,
} from '@/domain/types'

export { BookingError, type BookingErrorCode } from '@/domain/errors'

/** What a customer sees on the public booking page — no internal data. */
export interface PublicBusinessProfile {
  business: Pick<Business, 'id' | 'slug' | 'name' | 'description' | 'category' | 'phone' | 'address' | 'hours' | 'policies' | 'settings' | 'timezone' | 'logoUrl' | 'coverUrl' | 'publishedAt'>
  /** Online booking is paused (the business's subscription isn't active): show contact details instead. */
  bookingPaused?: boolean
  /** One of the seeded demo businesses (its messages are simulated). */
  demo?: boolean
  services: Service[]
  staff: Pick<StaffMember, 'id' | 'name' | 'color' | 'avatarInitials' | 'serviceIds'>[]
}

export interface NewBookingInput {
  serviceId: ID
  /** ISO start time chosen from the availability list. */
  start: string
  /** Preferred staff member; omitted = "any available" (least busy is assigned). */
  staffId?: ID
  name: string
  phone: string
  notes?: string
  remindersOptIn: boolean
  /** Language the client booked in — their confirmations and reminders use it. */
  locale?: LanguageCode
}

/** Business-editable fields (settings screens). */
export type BusinessUpdate = Partial<Pick<Business, 'name' | 'description' | 'category' | 'phone' | 'email' | 'address' | 'slug' | 'hours' | 'policies' | 'settings' | 'timezone'>>

export type { BusinessBookingInput, CustomerInput, ServiceInput, StaffInput } from '@/domain/bookingRules'

/** Outcome of a client import: row numbers are 1-based positions in the submitted list. */
export interface ImportResult {
  created: number
  duplicates: number[]
  invalid: number[]
}

/** Moving an appointment from the dashboard. */
export interface AppointmentMove {
  start: string
  /** Hand it to another team member (who performs the service). */
  staffId?: ID
  /** Tell the client about the new time. */
  notify: boolean
}
export type ImageKind = 'logo' | 'cover'

export interface AppointmentQuery {
  from?: Date
  to?: Date
  staffId?: ID
  customerId?: ID
  status?: AppointmentStatus[]
}

/** Which data changed — lets screens refresh only when their data is affected. */
export type DataTopic = 'business' | 'staff' | 'services' | 'customers' | 'appointments' | 'offers' | 'notifications'

/**
 * The single seam between UI and data. Screens depend on this interface only.
 * Business-side methods are scoped to the signed-in business (see `session.ts`);
 * public methods are addressed by booking-link slug. Today it is backed by the
 * local database; a real backend implements the same contract over HTTP.
 */
export interface BookFlowRepository {
  /* ---- Business (dashboard) ---- */
  getBusiness(): Promise<Business>
  updateBusiness(update: BusinessUpdate): Promise<Business>
  listStaff(): Promise<StaffMember[]>
  listServices(): Promise<Service[]>
  updateService(service: Service): Promise<void>
  createService(input: ServiceInput): Promise<Service>
  /** Removes a service from the menu; past appointments keep their history. */
  deleteService(id: ID): Promise<void>
  createStaff(input: StaffInput): Promise<StaffMember>
  updateStaff(id: ID, input: StaffInput): Promise<StaffMember>
  /** Throws `in_use` while the person still has upcoming appointments. */
  deleteStaff(id: ID): Promise<void>
  /** Sets the logo/cover from an image data URL (png/jpeg/webp); null removes it. */
  setBusinessImage(kind: ImageKind, dataUrl: string | null): Promise<Business>
  /** Publishes (or unpublishes) the public booking page. */
  setPublished(published: boolean): Promise<Business>
  /** Marks the onboarding wizard as finished. */
  completeOnboarding(): Promise<Business>
  listCustomers(): Promise<CustomerWithStats[]>
  getCustomer(id: ID): Promise<Customer | undefined>
  listAppointments(query?: AppointmentQuery): Promise<AppointmentView[]>
  updateAppointmentStatus(id: ID, status: AppointmentStatus): Promise<void>

  /** Smart Fill: offers already sent for a cancelled appointment's slot. */
  listAvailabilityOffers(appointmentId: ID): Promise<AvailabilityOffer[]>
  /** Smart Fill: record a new offer; delivery is handled (and its statuses owned) by the server. */
  saveAvailabilityOffer(offer: AvailabilityOffer): Promise<void>
  /** Messages sent / scheduled for an appointment (confirmation, reminders, changes). */
  listNotifications(appointmentId: ID): Promise<NotificationRecord[]>
  /** Every message to one client, newest first. */
  listCustomerNotifications(customerId: ID): Promise<NotificationRecord[]>

  /* ---- Appointments entered by the business (phone, walk-in…) ---- */
  /** Times for the business's own booking form: no notice/advance limits; hours and staff hours apply. */
  getStaffAvailability(serviceId: ID, from: Date, days: number, options?: { staffId?: ID; ignoreAppointmentId?: ID }): Promise<DayAvailability[]>
  /** Any time (also outside the online grid) as long as the team member is free. Throws `slot_unavailable` on overlap. */
  createAppointment(input: BusinessBookingInput): Promise<AppointmentView>
  moveAppointment(id: ID, move: AppointmentMove): Promise<AppointmentView>
  cancelAppointment(id: ID, options: { notify: boolean }): Promise<AppointmentView>
  updateAppointmentNotes(id: ID, notes: string): Promise<void>
  /** Sends a reminder now. Throws `opted_out` when the client declined reminders. */
  sendReminder(id: ID): Promise<void>

  /* ---- Clients ---- */
  /** Throws `duplicate` when a client with the same phone number exists. */
  createCustomer(input: CustomerInput): Promise<Customer>
  updateCustomer(id: ID, input: CustomerInput): Promise<Customer>
  /** Client asked not to be messaged ("STOP"): nothing is sent to them, not even reminders. */
  setCustomerOptOut(id: ID, optedOut: boolean): Promise<Customer>
  /** Right to erasure: removes personal data, keeps anonymous visit history. Throws `in_use` with upcoming visits. */
  eraseCustomer(id: ID): Promise<void>
  /** Free-text message to one client on the business's channel. */
  sendCustomerMessage(id: ID, body: string): Promise<void>
  /** Bulk import (spreadsheet). Skips invalid rows and phone numbers that already exist. */
  importCustomers(rows: CustomerInput[]): Promise<ImportResult>

  /* ---- Public booking (customer-facing; a real backend exposes these without auth) ---- */
  getPublicProfile(slug: string): Promise<PublicBusinessProfile | undefined>
  getAvailability(slug: string, serviceId: ID, from: Date, days: number, staffId?: ID): Promise<DayAvailability[]>
  /** Re-validates the slot; throws `BookingError('slot_unavailable')` if it was taken. */
  createBooking(slug: string, input: NewBookingInput): Promise<AppointmentView>
  /** A client's booking by its manage token (from their manage link). */
  getBookingByReference(slug: string, token: string): Promise<AppointmentView | undefined>
  /** Free times for moving a booking: same service, duration and staff member; its own slot doesn't block. */
  getRescheduleAvailability(slug: string, reference: string, from: Date, days: number): Promise<DayAvailability[]>
  /** Moves the booking, keeping service, price, duration and staff. Re-validates the slot and the change window. */
  rescheduleBooking(slug: string, reference: string, start: string): Promise<AppointmentView>
  /** Releases the slot (so Smart Fill can offer it). Throws `change_window_closed` inside the free-change window. */
  cancelBooking(slug: string, reference: string, reason?: CancellationReason): Promise<AppointmentView>

  /* ---- Data lifecycle ---- */
  /** Subscribe to data changes (this tab or others). Returns an unsubscribe function. */
  onChange(listener: (topics: DataTopic[]) => void): () => void
  /** Demo/dev only: discard all data and re-seed the demo business. */
  resetDemoData(): Promise<void>
  /** True when data survives a reload on this device. */
  readonly isPersistent: boolean
}
