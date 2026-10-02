export type BookingErrorCode =
  | 'slot_unavailable'
  | 'invalid_input'
  | 'not_found'
  | 'already_cancelled'
  /** The appointment has already started or passed. */
  | 'not_changeable'
  /** Inside the business's free-change window (applies to reschedule and cancel). */
  | 'change_window_closed'
  /** A business setting failed validation (e.g. malformed or taken booking-link slug). */
  | 'invalid_slug'
  | 'slug_taken'
  /** The booking page isn't published yet (only the owner can preview it). */
  | 'not_published'
  /** The record is still used (e.g. a staff member with upcoming appointments). */
  | 'in_use'
  /** Uploaded file isn't an acceptable image (type or size). */
  | 'invalid_image'
  /** Can't publish yet: needs at least one bookable service and a team member who performs it. */
  | 'not_ready'
  /** A client with this phone number already exists. */
  | 'duplicate'
  /** The client opted out of messages (or of reminders for this visit). */
  | 'opted_out'
  /** No phone/email to reach the client on. */
  | 'no_contact'
  /** Online booking is paused for this business (subscription inactive). */
  | 'booking_paused'
  /** The business's plan doesn't allow this (e.g. more team members). */
  | 'plan_limit'

/** Typed business error so callers (and the UI) can react precisely and show translated messages. */
export class BookingError extends Error {
  constructor(public code: BookingErrorCode) {
    super(code)
    this.name = 'BookingError'
  }
}
