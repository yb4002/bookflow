import type { DayAvailability } from '@/domain/availability'
import type { AppointmentView, AvailabilityOffer, Business, Customer, CustomerWithStats, NotificationRecord, Service, StaffMember } from '@/domain/types'
import { api } from '../api/client'
import type { BookFlowRepository, DataTopic, ImportResult, PublicBusinessProfile } from './types'

/** JSON has no dates: turn availability ISO strings back into Date objects. */
type WireDay = { date: string; open: boolean; slots: { start: string; end: string; available: boolean; freeStaffIds: string[] }[] }
const reviveDays = (days: WireDay[]): DayAvailability[] =>
  days.map((d) => ({ ...d, date: new Date(d.date), slots: d.slots.map((s) => ({ ...s, start: new Date(s.start), end: new Date(s.end) })) }))

const qs = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string][]
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : ''
}
const enc = encodeURIComponent

/**
 * BookFlowRepository over the BookFlow API. Dashboard calls are authorized by the
 * session cookie (the server decides which business they act for); public calls
 * are addressed by booking-link slug.
 */
export function createHttpRepository(): BookFlowRepository {
  // One shared live-update stream, opened only while someone is listening.
  const listeners = new Set<(topics: DataTopic[]) => void>()
  let source: EventSource | null = null
  const openStream = () => {
    if (source || typeof EventSource === 'undefined') return
    source = new EventSource('/api/app/events', { withCredentials: true })
    source.addEventListener('change', (e) => {
      const topics = JSON.parse((e as MessageEvent<string>).data) as DataTopic[]
      listeners.forEach((l) => l(topics))
    })
  }
  const closeStream = () => {
    source?.close()
    source = null
  }

  return {
    isPersistent: true,

    getBusiness: () => api<Business>('GET', '/app/business'),
    updateBusiness: (update) => api<Business>('PATCH', '/app/business', update),
    listStaff: () => api<StaffMember[]>('GET', '/app/staff'),
    listServices: () => api<Service[]>('GET', '/app/services'),
    updateService: (service) => api<void>('PUT', `/app/services/${enc(service.id)}`, service),
    listCustomers: () => api<CustomerWithStats[]>('GET', '/app/customers'),
    getCustomer: (id) => api<Customer>('GET', `/app/customers/${enc(id)}`).catch(() => undefined),
    listAppointments: (q = {}) =>
      api<AppointmentView[]>('GET', `/app/appointments${qs({ from: q.from?.toISOString(), to: q.to?.toISOString(), staffId: q.staffId, customerId: q.customerId, status: q.status?.join(',') })}`),
    updateAppointmentStatus: (id, status) => api<void>('PATCH', `/app/appointments/${enc(id)}/status`, { status }),
    listAvailabilityOffers: (appointmentId) => api<AvailabilityOffer[]>('GET', `/app/offers${qs({ appointmentId })}`),
    saveAvailabilityOffer: (offer) => api<void>('PUT', `/app/offers/${enc(offer.id)}`, offer),
    createService: (input) => api<Service>('POST', '/app/services', input),
    deleteService: (id) => api<void>('DELETE', `/app/services/${enc(id)}`),
    createStaff: (input) => api<StaffMember>('POST', '/app/staff', input),
    updateStaff: (id, input) => api<StaffMember>('PUT', `/app/staff/${enc(id)}`, input),
    deleteStaff: (id) => api<void>('DELETE', `/app/staff/${enc(id)}`),
    setBusinessImage: (kind, dataUrl) => api<Business>('PUT', `/app/business/images/${kind}`, { dataUrl }),
    setPublished: (published) => api<Business>('POST', '/app/business/publish', { published }),
    completeOnboarding: () => api<Business>('POST', '/app/business/onboarding/complete'),
    listNotifications: (appointmentId) => api<NotificationRecord[]>('GET', `/app/notifications${qs({ appointmentId })}`),
    listCustomerNotifications: (customerId) => api<NotificationRecord[]>('GET', `/app/notifications${qs({ customerId })}`),

    getStaffAvailability: (serviceId, from, days, options = {}) =>
      api<WireDay[]>('GET', `/app/availability${qs({ serviceId, from: from.toISOString(), days, staffId: options.staffId, ignore: options.ignoreAppointmentId })}`).then(reviveDays),
    createAppointment: (input) => api<AppointmentView>('POST', '/app/appointments', input),
    moveAppointment: (id, move) => api<AppointmentView>('POST', `/app/appointments/${enc(id)}/move`, move),
    cancelAppointment: (id, options) => api<AppointmentView>('POST', `/app/appointments/${enc(id)}/cancel`, options),
    updateAppointmentNotes: (id, notes) => api<void>('PUT', `/app/appointments/${enc(id)}/notes`, { notes }),
    sendReminder: (id) => api<void>('POST', `/app/appointments/${enc(id)}/remind`),

    createCustomer: (input) => api<Customer>('POST', '/app/customers', input),
    updateCustomer: (id, input) => api<Customer>('PUT', `/app/customers/${enc(id)}`, input),
    setCustomerOptOut: (id, optedOut) => api<Customer>('POST', `/app/customers/${enc(id)}/opt-out`, { optedOut }),
    eraseCustomer: (id) => api<void>('DELETE', `/app/customers/${enc(id)}`),
    sendCustomerMessage: (id, body) => api<void>('POST', `/app/customers/${enc(id)}/messages`, { body }),
    importCustomers: (rows) => api<ImportResult>('POST', '/app/customers/import', { rows }),

    getPublicProfile: (slug) =>
      api<PublicBusinessProfile>('GET', `/public/${enc(slug)}`).catch((e) => {
        if ((e as { code?: string }).code === 'not_found') return undefined
        throw e
      }),
    getAvailability: (slug, serviceId, from, days, staffId) =>
      api<WireDay[]>('GET', `/public/${enc(slug)}/availability${qs({ serviceId, from: from.toISOString(), days, staffId })}`).then(reviveDays),
    createBooking: (slug, input) => api<AppointmentView>('POST', `/public/${enc(slug)}/bookings`, input),
    getBookingByReference: (slug, reference) =>
      api<AppointmentView>('GET', `/public/${enc(slug)}/bookings/${enc(reference)}`).catch((e) => {
        if ((e as { code?: string }).code === 'not_found') return undefined
        throw e
      }),
    getRescheduleAvailability: (slug, reference, from, days) =>
      api<WireDay[]>('GET', `/public/${enc(slug)}/bookings/${enc(reference)}/availability${qs({ from: from.toISOString(), days })}`).then(reviveDays),
    rescheduleBooking: (slug, reference, start) => api<AppointmentView>('POST', `/public/${enc(slug)}/bookings/${enc(reference)}/reschedule`, { start }),
    cancelBooking: (slug, reference, reason) => api<AppointmentView>('POST', `/public/${enc(slug)}/bookings/${enc(reference)}/cancel`, { reason }),

    onChange: (listener) => {
      listeners.add(listener)
      openStream()
      return () => {
        listeners.delete(listener)
        if (!listeners.size) closeStream()
      }
    },
    resetDemoData: () => api<void>('POST', '/app/demo/reset'),
  }
}
