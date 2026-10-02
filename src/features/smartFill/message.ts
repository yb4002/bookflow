import type { Business, CustomerWithStats, MessageChannel } from '@/domain/types'
import type { Formatters } from '@/i18n/formatters'
import type { Messages } from '@/i18n'
import { interpolate } from '@/i18n/plural'
import type { FillOpportunity } from './matching'
import { bookingPath } from '@/features/booking/paths'
import { businessZone, toLocalDateString } from '@/domain/time'

/**
 * Renders the outbound availability message for one client.
 * `isolate` adds bidi isolation for on-screen preview only — messages that are
 * actually sent stay free of invisible control characters.
 */
export function renderAvailabilityMessage(
  t: Messages,
  f: Formatters,
  business: Business,
  opportunity: FillOpportunity,
  customer: CustomerWithStats,
  isolate = false,
) {
  const a = opportunity.appointment
  return interpolate(
    t.smartFill.message.body,
    {
      firstName: customer.firstName,
      service: a.service.name,
      staff: a.staff.name.split(' ')[0],
      date: f.dateMedium(a.start),
      time: f.time(a.start),
      business: business.name,
      // Opens the booking page on that service, team member and day.
      link: `${typeof window === 'undefined' ? '' : window.location.origin}${bookingPath(business.slug)}?service=${encodeURIComponent(a.serviceId)}&staff=${encodeURIComponent(a.staffId)}&date=${toLocalDateString(a.start, businessZone(business))}`,
    },
    isolate,
  )
}

/** Where a message is delivered for the chosen channel. */
export const addressFor = (customer: CustomerWithStats, channel: MessageChannel) =>
  channel === 'email' ? customer.email : customer.phone
