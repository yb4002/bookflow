import { isAfter, isBefore } from 'date-fns'
import { getAvailability, hasConflict, pickStaffForSlot, type AvailabilityContext } from '@/domain/availability'
import {
  applyCancellation,
  applyReschedule,
  applyStatusChange,
  assertChangeable,
  generateReference,
  isManageToken,
  newManageToken,
  newId,
  normalizeName,
  ownedBy,
  phoneDigits,
  splitName,
  validateCustomerInput,
  initialsFor,
  isValidTimeZone,
  validateHours,
  validatePolicies,
  validateService,
  validateSettings,
  validateSlug,
  validateStaff,
  applyBusinessMove,
  cleanCustomer,
  ERASED_NAME,
  validateBusinessBooking,
  validateCustomer,
  validateMessageBody,
  type CustomerInput,
} from '@/domain/bookingRules'
import { BookingError } from '@/domain/errors'
import type { Appointment, AppointmentView, Business, Customer, CustomerWithStats, ID, Service, StaffMember } from '@/domain/types'
import type { Database } from '../db/database'
import type { TableName } from '../db/schema'
import type { AppointmentQuery, BookFlowRepository, DataTopic, PublicBusinessProfile } from './types'

export interface LocalRepositoryOptions {
  db: Database
  /** Business the dashboard acts for — replaced by the authenticated session later. */
  businessId: () => ID
  /** Artificial latency so loading states behave like a network (0 in tests). */
  latencyMs?: number
  /** Injectable clock for deterministic tests. */
  now?: () => Date
  /** May the caller see an unpublished booking page? (The browser-only build has no sessions.) */
  canPreview?: (businessId: ID) => boolean
}

/** Local storage shapes: removed services/staff are kept (soft delete) so history still resolves. */
type Removable = { deletedAt?: string }
const live = <T,>(row: T) => !(row as T & Removable).deletedAt
/** Erased clients keep an anonymous record (visit history); they're hidden from client lists. */
type Erasable = { erasedAt?: string }
const present = (c: Customer) => !(c as Customer & Erasable).erasedAt

const TOPIC: Record<TableName, DataTopic> = {
  businesses: 'business',
  staff: 'staff',
  services: 'services',
  customers: 'customers',
  appointments: 'appointments',
  offers: 'offers',
}

/**
 * BookFlowRepository over the local database. Orchestrates reads/writes and applies
 * the pure domain rules; contains no UI concerns. Returned objects are copies, so
 * callers can never mutate stored state by accident.
 */
export function createLocalRepository({ db, businessId, latencyMs = 120, now = () => new Date(), canPreview = () => false }: LocalRepositoryOptions): BookFlowRepository {
  const businesses = db.table('businesses')
  const staff = db.table('staff')
  const services = db.table('services')
  const customers = db.table('customers')
  const appointments = db.table('appointments')
  const offers = db.table('offers')

  const respond = <T,>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), latencyMs))
  /** Runs `fn` after the simulated latency so failures surface asynchronously, like a server. */
  const perform = <T,>(fn: () => T): Promise<T> =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(structuredClone(fn()))
        } catch (e) {
          reject(e)
        }
      }, latencyMs),
    )

  /* ---------------- helpers ---------------- */

  const currentBusiness = (): Business => {
    const b = businesses.get(businessId())
    if (!b) throw new BookingError('not_found')
    return b
  }
  /** Former booking links (local storage shape only) — shared links keep working after a rename. */
  const formerSlugs = (b: Business) => (b as Business & { previousSlugs?: string[] }).previousSlugs ?? []
  const bySlug = (slug: string) => businesses.find((b) => b.slug === slug || formerSlugs(b).includes(slug))
  /** Public lookup: unpublished pages only resolve for callers allowed to preview them. */
  const publicBySlug = (slug: string) => {
    const b = bySlug(slug)
    return b && (b.publishedAt || canPreview(b.id)) ? b : undefined
  }
  const requireBySlug = (slug: string) => {
    const b = publicBySlug(slug)
    if (!b) throw new BookingError('not_found')
    return b
  }

  /** Joins appointments with their customer, staff and service in O(n). */
  const joiner = (bizId: ID) => {
    const own = ownedBy(bizId)
    const c = new Map(customers.where(own).map((x) => [x.id, x]))
    const s = new Map(staff.where(own).map((x) => [x.id, x]))
    const v = new Map(services.where(own).map((x) => [x.id, x]))
    return (a: Appointment): AppointmentView => ({ ...a, customer: c.get(a.customerId)!, staff: s.get(a.staffId)!, service: v.get(a.serviceId)! })
  }

  const availabilityContext = (business: Business, serviceId: ID, extra: Partial<AvailabilityContext> = {}): AvailabilityContext => {
    const own = ownedBy(business.id)
    const service = services.get(serviceId)
    if (!service || service.businessId !== business.id || !service.active || !live(service)) throw new BookingError('invalid_input')
    const tenantServices = services.where(own)
    return {
      business,
      service,
      staff: staff.where((s) => own(s) && live(s)),
      appointments: appointments.where(own),
      servicesById: new Map(tenantServices.map((x) => [x.id, x])),
      now: now(),
      ...extra,
    }
  }

  /** Public access to a booking is by its manage token only. */
  const bookingByRef = (business: Business, token: string) =>
    isManageToken(token) ? appointments.find((a) => a.businessId === business.id && a.manageToken === token) : undefined

  const changeableByRef = (business: Business, reference: string) => {
    const a = bookingByRef(business, reference)
    if (!a) throw new BookingError('not_found')
    assertChangeable(a, business, now())
    return a
  }

  /** Business-side availability: no notice/window limits; hidden (not deleted) services allowed. */
  const staffContext = (business: Business, serviceId: ID, extra: Partial<AvailabilityContext> = {}): AvailabilityContext => {
    const own = ownedBy(business.id)
    const service = services.get(serviceId)
    if (!service || service.businessId !== business.id || !live(service)) throw new BookingError('invalid_input')
    return {
      business: { ...business, policies: { ...business.policies, minNoticeHours: 0, maxAdvanceDays: 730 } },
      service,
      staff: staff.where((s) => own(s) && live(s)),
      appointments: appointments.where(own),
      servicesById: new Map(services.where(own).map((x) => [x.id, x])),
      now: now(),
      ...extra,
    }
  }
  const requireAppointment = (id: ID) => {
    const a = appointments.get(id)
    if (!a || a.businessId !== businessId()) throw new BookingError('not_found')
    return a
  }
  const requireCustomer = (id: ID) => {
    const c = customers.get(id)
    if (!c || c.businessId !== businessId() || !present(c)) throw new BookingError('not_found')
    return c
  }
  const insertCustomer = (bizId: ID, input: CustomerInput): Customer => {
    validateCustomer(input)
    const c = cleanCustomer(input)
    if (customers.find((x) => x.businessId === bizId && present(x) && phoneDigits(x.phone) === phoneDigits(c.phone))) throw new BookingError('duplicate')
    const customer: Customer = { businessId: bizId, id: newId('cus'), firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, createdAt: now().toISOString(), tags: c.tags ?? ['New'], marketingOptIn: c.marketingOptIn }
    if (c.notes) customer.notes = c.notes
    if (c.preferredLanguage) customer.preferredLanguage = c.preferredLanguage
    return customers.insert(customer)
  }

  /** Same service and staff member; the booking's own slot doesn't block itself. */
  const rescheduleContext = (business: Business, a: Appointment) =>
    availabilityContext(business, a.serviceId, { staffIds: [a.staffId], ignoreAppointmentId: a.id })

  return {
    get isPersistent() {
      return db.durable
    },

    /* ---------------- Business (dashboard) ---------------- */

    getBusiness: () => perform(currentBusiness),

    updateBusiness: (update) =>
      perform(() => {
        const business = currentBusiness()
        if (update.slug !== undefined && update.slug !== business.slug) {
          validateSlug(update.slug, (slug) => { const owner = bySlug(slug); return owner !== undefined && owner.id !== business.id })
        }
        if (update.settings) validateSettings(update.settings)
        if (update.policies) validatePolicies(update.policies)
        if (update.hours) validateHours(update.hours)
        if (update.timezone !== undefined && !isValidTimeZone(update.timezone)) throw new BookingError('invalid_input')
        if (update.name !== undefined && normalizeName(update.name).length < 2) throw new BookingError('invalid_input')
        const previousSlugs =
          update.slug !== undefined && update.slug !== business.slug
            ? [...new Set([...formerSlugs(business), business.slug])].filter((s) => s !== update.slug)
            : formerSlugs(business)
        return businesses.update(business.id, { ...update, previousSlugs, updatedAt: now().toISOString() } as Partial<Business>)
      }),

    listStaff: () => perform(() => staff.where((s) => ownedBy(businessId())(s) && live(s)).map(({ deletedAt: _d, ...s }: StaffMember & Removable) => s)),
    listServices: () => perform(() => services.where((s) => ownedBy(businessId())(s) && live(s)).map(({ deletedAt: _d, ...s }: Service & Removable) => s)),

    updateService: (service) =>
      perform(() => {
        validateService(service)
        const existing = services.get(service.id)
        if (!existing || existing.businessId !== businessId() || !live(existing)) throw new BookingError('not_found')
        services.update(service.id, { ...service, businessId: existing.businessId })
      }),

    createService: (input) =>
      perform(() => {
        validateService(input)
        return services.insert({ businessId: businessId(), id: newId('svc'), ...input, name: input.name.trim(), category: input.category.trim(), description: input.description.trim() })
      }),

    deleteService: (id) =>
      perform(() => {
        const existing = services.get(id)
        if (!existing || existing.businessId !== businessId() || !live(existing)) throw new BookingError('not_found')
        services.update(id, { active: false, deletedAt: now().toISOString() } as Partial<Service>)
      }),

    createStaff: (input) =>
      perform(() => {
        validateStaff(input)
        const bizId = businessId()
        const valid = new Set(services.where((s) => s.businessId === bizId && live(s)).map((s) => s.id))
        if (!input.serviceIds.every((id) => valid.has(id))) throw new BookingError('invalid_input')
        const member: StaffMember = { businessId: bizId, id: newId('stf'), name: normalizeName(input.name), role: input.role.trim(), color: input.color, serviceIds: [...input.serviceIds], avatarInitials: initialsFor(input.name) }
        if (input.availability) member.availability = input.availability as StaffMember['availability']
        return staff.insert(member)
      }),

    updateStaff: (id, input) =>
      perform(() => {
        validateStaff(input)
        const bizId = businessId()
        const existing = staff.get(id)
        if (!existing || existing.businessId !== bizId || !live(existing)) throw new BookingError('not_found')
        const valid = new Set(services.where((s) => s.businessId === bizId && live(s)).map((s) => s.id))
        if (!input.serviceIds.every((sid) => valid.has(sid))) throw new BookingError('invalid_input')
        const { availability: _a, ...rest } = existing
        const next: StaffMember = { ...rest, name: normalizeName(input.name), role: input.role.trim(), color: input.color, serviceIds: [...input.serviceIds], avatarInitials: initialsFor(input.name) }
        if (input.availability) next.availability = input.availability as StaffMember['availability']
        return staff.upsert(next)
      }),

    deleteStaff: (id) =>
      perform(() => {
        const bizId = businessId()
        const existing = staff.get(id)
        if (!existing || existing.businessId !== bizId || !live(existing)) throw new BookingError('not_found')
        const t = now().toISOString()
        if (appointments.find((a) => a.staffId === id && (a.status === 'confirmed' || a.status === 'pending') && a.start > t)) throw new BookingError('in_use')
        staff.update(id, { deletedAt: t } as Partial<StaffMember>)
      }),

    // The browser-only build keeps the image inline (data URL); the server stores files.
    setBusinessImage: (kind, dataUrl) =>
      perform(() => {
        if (dataUrl !== null && !/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) throw new BookingError('invalid_image')
        const key = kind === 'logo' ? 'logoUrl' : 'coverUrl'
        return businesses.update(businessId(), { [key]: dataUrl ?? undefined, updatedAt: now().toISOString() } as Partial<Business>)
      }),

    setPublished: (published) =>
      perform(() => {
        const bizId = businessId()
        const bookable = new Set(services.where((s) => s.businessId === bizId && s.active && live(s)).map((s) => s.id))
        const ready = staff.where((s) => s.businessId === bizId && live(s)).some((s) => s.serviceIds.some((id) => bookable.has(id)))
        if (published && !ready) throw new BookingError('not_ready')
        return businesses.update(bizId, { publishedAt: published ? now().toISOString() : undefined, updatedAt: now().toISOString() })
      }),

    completeOnboarding: () =>
      perform(() => {
        const b = currentBusiness()
        return businesses.update(b.id, { onboardingCompletedAt: b.onboardingCompletedAt ?? now().toISOString(), updatedAt: now().toISOString() })
      }),

    getCustomer: (id) =>
      perform(() => {
        const c = customers.get(id)
        return c && c.businessId === businessId() && present(c) ? c : undefined
      }),

    listCustomers: () =>
      perform(() => {
        const bizId = businessId()
        const t = now()
        const byCustomer = new Map<ID, Appointment[]>()
        for (const a of appointments.where(ownedBy(bizId))) {
          const list = byCustomer.get(a.customerId)
          if (list) list.push(a)
          else byCustomer.set(a.customerId, [a])
        }
        return customers.where((c) => ownedBy(bizId)(c) && present(c)).map<CustomerWithStats>((c) => {
          const appts = byCustomer.get(c.id) ?? []
          const done = appts.filter((a) => a.status === 'completed').sort((x, y) => y.start.localeCompare(x.start))
          const upcoming = appts
            .filter((a) => isAfter(new Date(a.start), t) && (a.status === 'confirmed' || a.status === 'pending'))
            .sort((x, y) => x.start.localeCompare(y.start))
          return {
            ...c,
            totalVisits: done.length,
            noShows: appts.filter((a) => a.status === 'no_show').length,
            lifetimeValue: done.reduce((sum, a) => sum + a.price, 0),
            lastVisit: done[0]?.start,
            nextAppointment: upcoming[0]?.start,
          }
        })
      }),

    listAppointments: (q: AppointmentQuery = {}) =>
      perform(() => {
        const bizId = businessId()
        return appointments
          .where((a) => {
            if (a.businessId !== bizId) return false
            const start = new Date(a.start)
            if (q.from && isBefore(start, q.from)) return false
            if (q.to && !isBefore(start, q.to)) return false
            if (q.staffId && a.staffId !== q.staffId) return false
            if (q.customerId && a.customerId !== q.customerId) return false
            if (q.status && !q.status.includes(a.status)) return false
            return true
          })
          .sort((x, y) => x.start.localeCompare(y.start))
          .map(joiner(bizId))
      }),

    updateAppointmentStatus: (id, status) =>
      perform(() => {
        const a = appointments.get(id)
        if (!a || a.businessId !== businessId()) throw new BookingError('not_found')
        appointments.upsert(applyStatusChange(a, status, now()))
      }),

    listAvailabilityOffers: (appointmentId) =>
      perform(() =>
        offers
          .where((o) => o.businessId === businessId() && o.appointmentId === appointmentId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      ),

    saveAvailabilityOffer: (offer) =>
      perform(() => {
        offers.upsert({ ...offer, businessId: offer.businessId ?? businessId() })
      }),

    // The local (browser) implementation has no notification engine — messages are a server concern.
    listNotifications: () => perform(() => []),
    listCustomerNotifications: () => perform(() => []),

    getStaffAvailability: (serviceId, from, days, options = {}) =>
      perform(() => getAvailability(staffContext(currentBusiness(), serviceId, { staffIds: options.staffId ? [options.staffId] : undefined, ignoreAppointmentId: options.ignoreAppointmentId }), from, Math.min(Math.max(days, 1), 62))),

    createAppointment: (input) =>
      perform(() => {
        const business = currentBusiness()
        const start = validateBusinessBooking(input, now())
        const ctx = staffContext(business, input.serviceId)
        if (!ctx.staff.some((s) => s.id === input.staffId && s.serviceIds.includes(ctx.service.id))) throw new BookingError('invalid_input')
        if (hasConflict(ctx, input.staffId, start)) throw new BookingError('slot_unavailable')
        const customerId = input.customerId ? requireCustomer(input.customerId).id : insertCustomer(business.id, input.customer!).id
        const appointment: Appointment = {
          businessId: business.id,
          id: newId('apt'),
          customerId,
          staffId: input.staffId,
          serviceId: ctx.service.id,
          start: start.toISOString(),
          end: new Date(start.getTime() + ctx.service.durationMin * 60_000).toISOString(),
          status: 'confirmed',
          source: input.source,
          price: ctx.service.price,
          reminderSent: false,
          reference: generateReference((ref) => appointments.find((a) => a.reference === ref) !== undefined),
          manageToken: newManageToken(),
        }
        if (input.notes?.trim()) appointment.notes = input.notes.trim()
        appointments.insert(appointment)
        return joiner(business.id)(appointment)
      }),

    moveAppointment: (id, move) =>
      perform(() => {
        const business = currentBusiness()
        const before = requireAppointment(id)
        const start = new Date(typeof move?.start === 'string' ? move.start : NaN)
        if (Number.isNaN(start.getTime()) || typeof move.notify !== 'boolean') throw new BookingError('invalid_input')
        if (before.status !== 'confirmed' && before.status !== 'pending') throw new BookingError('not_changeable')
        const staffId = move.staffId ?? before.staffId
        const ctx = staffContext(business, before.serviceId, { ignoreAppointmentId: id })
        if (!ctx.staff.some((s) => s.id === staffId && s.serviceIds.includes(before.serviceId))) throw new BookingError('invalid_input')
        if (hasConflict(ctx, staffId, start)) throw new BookingError('slot_unavailable')
        const next = applyBusinessMove(before, start, staffId, now())
        appointments.upsert(next)
        return joiner(business.id)(next)
      }),

    cancelAppointment: (id) =>
      perform(() => {
        const before = requireAppointment(id)
        if (before.status === 'cancelled') throw new BookingError('already_cancelled')
        const next = applyCancellation(before, 'business', now())
        appointments.upsert(next)
        return joiner(before.businessId)(next)
      }),

    updateAppointmentNotes: (id, notes) =>
      perform(() => {
        if (typeof notes !== 'string' || notes.length > 2000) throw new BookingError('invalid_input')
        const a = requireAppointment(id)
        appointments.upsert({ ...a, notes: notes.trim() || undefined })
      }),

    sendReminder: (id) =>
      perform(() => {
        const a = requireAppointment(id)
        if ((a.status !== 'confirmed' && a.status !== 'pending') || new Date(a.start) <= now()) throw new BookingError('not_changeable')
        const c = customers.get(a.customerId)!
        if (a.remindersOptIn === false || c.messagingOptOut) throw new BookingError('opted_out')
      }),

    createCustomer: (input) => perform(() => insertCustomer(businessId(), input)),

    updateCustomer: (id, input) =>
      perform(() => {
        validateCustomer(input)
        const existing = requireCustomer(id)
        const c = cleanCustomer(input)
        if (customers.find((x) => x.businessId === existing.businessId && x.id !== id && present(x) && phoneDigits(x.phone) === phoneDigits(c.phone))) throw new BookingError('duplicate')
        return customers.update(id, {
          firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email, notes: c.notes, marketingOptIn: c.marketingOptIn,
          ...(c.preferredLanguage ? { preferredLanguage: c.preferredLanguage } : {}),
          ...(c.tags ? { tags: c.tags } : {}),
        })
      }),

    setCustomerOptOut: (id, optedOut) =>
      perform(() => {
        requireCustomer(id)
        return customers.update(id, { messagingOptOut: optedOut || undefined })
      }),

    eraseCustomer: (id) =>
      perform(() => {
        const c = requireCustomer(id)
        if (appointments.find((a) => a.customerId === id && (a.status === 'confirmed' || a.status === 'pending') && new Date(a.start) > now())) throw new BookingError('in_use')
        customers.upsert({ businessId: c.businessId, id, firstName: ERASED_NAME, lastName: '', email: '', phone: '', createdAt: c.createdAt, tags: [], marketingOptIn: false, erasedAt: now().toISOString() } as Customer)
        for (const a of appointments.where((x) => x.customerId === id && !!x.notes)) appointments.upsert({ ...a, notes: undefined })
      }),

    importCustomers: (rows) =>
      perform(() => {
        if (!Array.isArray(rows) || rows.length > 5000) throw new BookingError('invalid_input')
        const bizId = businessId()
        const result = { created: 0, duplicates: [] as number[], invalid: [] as number[] }
        rows.forEach((row, i) => {
          try {
            insertCustomer(bizId, { ...row, tags: row?.tags ?? [] })
            result.created++
          } catch (e) {
            if (e instanceof BookingError && e.code === 'duplicate') result.duplicates.push(i + 1)
            else if (e instanceof BookingError) result.invalid.push(i + 1)
            else throw e
          }
        })
        return result
      }),

    sendCustomerMessage: (id, body) =>
      perform(() => {
        validateMessageBody(body)
        const c = requireCustomer(id)
        if (c.messagingOptOut) throw new BookingError('opted_out')
      }),

    /* ---------------- Public booking ---------------- */

    getPublicProfile: (slug) =>
      perform(() => {
        const b = publicBySlug(slug)
        if (!b) return undefined
        const own = ownedBy(b.id)
        const profile: PublicBusinessProfile = {
          business: { id: b.id, slug: b.slug, name: b.name, description: b.description, category: b.category, phone: b.phone, address: b.address, hours: b.hours, policies: b.policies, settings: b.settings, timezone: b.timezone, logoUrl: b.logoUrl, coverUrl: b.coverUrl, publishedAt: b.publishedAt },
          services: services.where((s) => own(s) && s.active && live(s)),
          staff: staff.where((s) => own(s) && live(s)).map(({ id, name, color, avatarInitials, serviceIds }) => ({ id, name, color, avatarInitials, serviceIds })),
        }
        return profile
      }),

    getAvailability: (slug, serviceId, from, days, staffId) =>
      perform(() => {
        const business = requireBySlug(slug)
        return getAvailability(availabilityContext(business, serviceId, staffId ? { staffIds: [staffId] } : {}), from, days)
      }),

    createBooking: (slug, input) =>
      perform(() => {
        const business = requireBySlug(slug)
        if (!business.publishedAt) throw new BookingError('not_published')
        const invalid = validateCustomerInput(input.name, input.phone)
        if (invalid.name || invalid.phone) throw new BookingError('invalid_input')

        const ctx = availabilityContext(business, input.serviceId, input.staffId ? { staffIds: [input.staffId] } : {})
        const start = new Date(input.start)
        // Authoritative check against live data: the slot may have been taken since the page loaded.
        const staffId = pickStaffForSlot(ctx, start)
        if (!staffId) throw new BookingError('slot_unavailable')

        const t = now()
        const created = db.batch(() => {
          // Returning clients are recognised by phone number (per business).
          let customer = customers.find((c) => c.businessId === business.id && phoneDigits(c.phone) === phoneDigits(input.phone))
          if (!customer) {
            customer = customers.insert({
              businessId: business.id,
              id: newId('cus'),
              ...splitName(input.name),
              email: '',
              phone: input.phone.trim(),
              createdAt: t.toISOString(),
              tags: ['New'],
              marketingOptIn: false,
            } satisfies Customer)
          }
          return appointments.insert({
            businessId: business.id,
            id: newId('apt'),
            customerId: customer.id,
            staffId,
            serviceId: ctx.service.id,
            start: start.toISOString(),
            end: new Date(start.getTime() + ctx.service.durationMin * 60_000).toISOString(),
            status: business.policies.autoConfirm ? 'confirmed' : 'pending',
            source: 'online',
            price: ctx.service.price,
            notes: input.notes?.trim() || undefined,
            reminderSent: false,
            reference: generateReference((ref) => appointments.find((a) => a.reference === ref) !== undefined),
            manageToken: newManageToken(),
          })
        })
        return joiner(business.id)(created)
      }),

    getBookingByReference: (slug, reference) =>
      perform(() => {
        const business = publicBySlug(slug)
        const a = business && bookingByRef(business, reference)
        return a ? joiner(business.id)(a) : undefined
      }),

    getRescheduleAvailability: (slug, reference, from, days) =>
      perform(() => {
        const business = requireBySlug(slug)
        return getAvailability(rescheduleContext(business, changeableByRef(business, reference)), from, days)
      }),

    rescheduleBooking: (slug, reference, start) =>
      perform(() => {
        const business = requireBySlug(slug)
        const a = changeableByRef(business, reference)
        const newStart = new Date(start)
        if (!pickStaffForSlot(rescheduleContext(business, a), newStart)) throw new BookingError('slot_unavailable')
        return joiner(business.id)(appointments.upsert(applyReschedule(a, newStart, now())))
      }),

    cancelBooking: (slug, reference, reason) =>
      perform(() => {
        const business = requireBySlug(slug)
        const a = changeableByRef(business, reference)
        return joiner(business.id)(appointments.upsert(applyCancellation(a, 'customer', now(), reason)))
      }),

    /* ---------------- Data lifecycle ---------------- */

    onChange: (listener) => db.onChange((tables) => listener([...new Set(tables.map((t) => TOPIC[t]))])),

    resetDemoData: () => respond(undefined).then(() => db.reset()),
  }
}
