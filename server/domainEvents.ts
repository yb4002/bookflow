import type { ID } from '../src/domain/types'

/**
 * Facts the business logic announces. It knows nothing about messages, channels or
 * providers — the notification engine (and future consumers: analytics, webhooks)
 * subscribe to these. Emitted inside the transaction that made the change.
 */
/** `notify: false` = the business chose not to message the client about this change. */
export type DomainEvent =
  | { type: 'appointment.booked'; businessId: ID; appointmentId: ID; notify?: boolean }
  | { type: 'appointment.rescheduled'; businessId: ID; appointmentId: ID; previousStart: string; notify?: boolean }
  | { type: 'appointment.cancelled'; businessId: ID; appointmentId: ID; by: 'customer' | 'business'; notify?: boolean }
  | { type: 'appointment.reminder_requested'; businessId: ID; appointmentId: ID }
  | { type: 'customer.message_requested'; businessId: ID; customerId: ID; body: string }
  | { type: 'customer.opted_out'; businessId: ID; customerId: ID }
  | { type: 'customer.erased'; businessId: ID; customerId: ID }
  | { type: 'appointment.status_changed'; businessId: ID; appointmentId: ID; status: string }
  | { type: 'smart_fill.offer_saved'; businessId: ID; offerId: ID }

export type DomainEventHandler = (event: DomainEvent) => void
