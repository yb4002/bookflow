import { addDays, subDays } from 'date-fns'
import { addZonedDays, businessZone, startOfZonedDay } from '../../src/domain/time'
import { getAvailability, hasConflict, pickStaffForSlot, type AvailabilityContext } from '../../src/domain/availability'
import {
  applyCancellation,
  applyReschedule,
  applyStatusChange,
  assertChangeable,
  generateReference,
  newId,
  normalizeName,
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
  isManageToken,
  newManageToken,
  type CustomerInput,
  type StaffInput,
} from '../../src/domain/bookingRules'
import { BookingError } from '../../src/domain/errors'
import type { Appointment, AppointmentView, Business, Customer, CustomerWithStats, ID, Service } from '../../src/domain/types'
import type { AppointmentQuery, BookFlowRepository, DataTopic, ImageKind, ImportResult, PublicBusinessProfile } from '../../src/data/repositories/types'
import type { Sql } from '../db/sqlite'
import type { DomainEvent, DomainEventHandler } from '../domainEvents'
import type { EventBus } from '../events'
import {
  appointmentParams,
  customerParams,
  fromMinor,
  serviceParams,
  settingsParams,
  toAppointment,
  toBusiness,
  toCustomer,
  toOffer,
  toService,
  toStaff,
  toNotification,
  toStaffAvailability,
  UPDATE_SETTINGS_SQL,
  type StaffHoursRow,
  type AppointmentRow,
  type NotificationRow,
  type BusinessRow,
  type CustomerRow,
  type HoursRow,
  type OfferRow,
  type RecipientRow,
  type ServiceRow,
  type StaffRow,
} from './mappers'

export interface SqlRepositoryOptions {
  sql: Sql
  /** Business the caller acts for (from the authenticated session). Public methods don't use it. */
  businessId: () => ID
  events?: EventBus
  now?: () => Date
  /** Re-seeds one business's operational data (demo mode only). */
  resetBusiness?: (businessId: ID) => void
  /** Receives domain events inside the writing transaction (transactional outbox). */
  onDomainEvent?: DomainEventHandler
  /** Stores uploaded logo/cover images and returns their public URL. */
  images?: ImageStore
  /** May the caller see this business's unpublished booking page? (its signed-in owner/staff) */
  canPreview?: (businessId: ID) => boolean
  /** May this business take online bookings (subscription)? Default: always. */
  entitled?: (businessId: ID) => boolean
  /** Most team members the business's plan allows. Default: unlimited. */
  staffLimit?: (businessId: ID) => number
}

export interface ImageStore {
  save(businessId: ID, kind: ImageKind, dataUrl: string): string
  remove(url: string): void
}

const BUSINESS_SQL = `
  SELECT b.*, l.slug, s.default_language, s.currency, s.phone_country, s.min_notice_hours, s.max_advance_days, s.cancellation_window_hours,
         s.require_deposit, s.deposit_percent, s.auto_confirm, s.reminder_hours_before, s.waitlist_enabled, s.notification_channel
  FROM businesses b
  JOIN business_settings s ON s.business_id = b.id
  JOIN booking_links l ON l.business_id = b.id AND l.is_primary = 1`

const BLOCKING = "('confirmed','pending','completed')"

/**
 * BookFlowRepository over the relational database. Same contract as the local
 * implementation (both run the same test suite); every business-side query is
 * filtered by the caller's business, and public methods resolve the business
 * through its booking link.
 */
export function createSqlRepository({ sql, businessId, events, now = () => new Date(), resetBusiness, onDomainEvent, images, canPreview = () => false, entitled = () => true, staffLimit = () => Number.POSITIVE_INFINITY }: SqlRepositoryOptions): BookFlowRepository {
  const publish = (bizId: ID, topics: DataTopic[]) => events?.publish(bizId, topics)
  const emit = (event: DomainEvent) => onDomainEvent?.(event)

  /* ---------------- loaders ---------------- */

  const loadBusiness = (id: ID): Business | undefined => {
    const row = sql.get<BusinessRow>(`${BUSINESS_SQL} WHERE b.id = ?`, [id])
    if (!row) return undefined
    return toBusiness(row, sql.all<HoursRow>('SELECT weekday, is_open, opens_at, closes_at FROM business_hours WHERE business_id = ?', [id]))
  }
  const requireBusiness = (id: ID) => {
    const b = loadBusiness(id)
    if (!b) throw new BookingError('not_found')
    return b
  }
  /** Any booking link — current or a previous one — resolves to its business. */
  const businessIdBySlug = (slug: string) => sql.get<{ business_id: string }>('SELECT business_id FROM booking_links WHERE slug = ?', [slug])?.business_id
  /** Public lookup: unpublished pages only resolve for callers allowed to preview them. */
  const businessBySlug = (slug: string) => {
    const id = businessIdBySlug(slug)
    const b = id ? loadBusiness(id) : undefined
    return b && (b.publishedAt || canPreview(b.id)) ? b : undefined
  }
  const requireBySlug = (slug: string) => {
    const b = businessBySlug(slug)
    if (!b) throw new BookingError('not_found')
    return b
  }

  /** Team members (removed ones only when needed for history), with personal working hours. */
  const loadStaff = (bizId: ID, { includeDeleted = false } = {}) => {
    const hours = toStaffAvailability(sql.all<StaffHoursRow>('SELECT staff_id, weekday, is_working, starts_at, ends_at FROM staff_hours WHERE business_id = ?', [bizId]))
    return sql
      .all<StaffRow>(
        `SELECT st.*, (SELECT group_concat(service_id) FROM (SELECT service_id FROM staff_services ss WHERE ss.staff_id = st.id ORDER BY service_id)) AS service_ids
         FROM staff st WHERE st.business_id = ?${includeDeleted ? '' : ' AND st.deleted_at IS NULL'} ORDER BY st.sort_order, st.id`,
        [bizId],
      )
      .map((r) => {
        const s = toStaff(r)
        const h = hours.get(s.id)
        return h && Object.keys(h).length === 7 ? { ...s, availability: h } : s
      })
  }
  const loadServices = (bizId: ID, { includeDeleted = false } = {}) =>
    sql.all<ServiceRow>(`SELECT * FROM services WHERE business_id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'} ORDER BY sort_order, id`, [bizId]).map(toService)

  const requirePublished = (b: Business) => {
    if (!b.publishedAt) throw new BookingError('not_published')
  }

  const writeStaffLinks = (bizId: ID, staffId: ID, input: StaffInput) => {
    const valid = new Set(loadServices(bizId).map((s) => s.id))
    if (!input.serviceIds.every((id) => valid.has(id))) throw new BookingError('invalid_input')
    sql.run('DELETE FROM staff_services WHERE staff_id = ?', [staffId])
    for (const svc of input.serviceIds) sql.run('INSERT INTO staff_services (business_id, staff_id, service_id) VALUES (?, ?, ?)', [bizId, staffId, svc])
    sql.run('DELETE FROM staff_hours WHERE staff_id = ?', [staffId])
    if (input.availability) {
      for (let d = 0; d < 7; d++) {
        const h = input.availability[d]
        sql.run('INSERT INTO staff_hours (business_id, staff_id, weekday, is_working, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)', [bizId, staffId, d, h.open ? 1 : 0, h.start, h.end])
      }
    }
  }

  const isReady = (bizId: ID) => {
    const services = loadServices(bizId).filter((s) => s.active)
    return loadStaff(bizId).some((st) => st.serviceIds.some((id) => services.some((s) => s.id === id)))
  }

  /** Appointments that can block time around [from, to). */
  const loadBlocking = (bizId: ID, from: Date, to: Date, staffId?: ID) =>
    sql
      .all<AppointmentRow>(
        `SELECT * FROM appointments WHERE business_id = ? AND status IN ${BLOCKING} AND start_at >= ? AND start_at < ?${staffId ? ' AND staff_id = ?' : ''}`,
        [bizId, subDays(from, 1).toISOString(), addDays(to, 1).toISOString(), ...(staffId ? [staffId] : [])],
      )
      .map(toAppointment)

  const joiner = (bizId: ID) => {
    const staff = new Map(loadStaff(bizId, { includeDeleted: true }).map((s) => [s.id, s]))
    const services = new Map(loadServices(bizId, { includeDeleted: true }).map((s) => [s.id, s]))
    const customers = new Map<ID, Customer>()
    return (rows: Appointment[]): AppointmentView[] => {
      const missing = [...new Set(rows.map((a) => a.customerId).filter((id) => !customers.has(id)))]
      for (let i = 0; i < missing.length; i += 500) {
        const chunk = missing.slice(i, i + 500)
        for (const c of sql.all<CustomerRow>(`SELECT * FROM customers WHERE business_id = ? AND id IN (${chunk.map(() => '?').join(',')})`, [bizId, ...chunk]).map(toCustomer)) customers.set(c.id, c)
      }
      return rows.map((a) => ({ ...a, customer: customers.get(a.customerId)!, staff: staff.get(a.staffId)!, service: services.get(a.serviceId)! }))
    }
  }

  const availabilityContext = (business: Business, serviceId: ID, from: Date, days: number, extra: Partial<AvailabilityContext> = {}): AvailabilityContext => {
    const services = loadServices(business.id)
    const service = services.find((s) => s.id === serviceId)
    if (!service || !service.active) throw new BookingError('invalid_input')
    return {
      business,
      service,
      staff: loadStaff(business.id),
      appointments: loadBlocking(business.id, startOfZonedDay(from, businessZone(business)), addZonedDays(from, days, businessZone(business))),
      servicesById: new Map(services.map((s) => [s.id, s])),
      now: now(),
      ...extra,
    }
  }

  /**
   * Availability for the business's own booking form: no minimum notice or booking-window limit,
   * services hidden from the online menu included. Opening hours and staff hours still apply.
   */
  const staffContext = (business: Business, serviceId: ID, from: Date, days: number, options: { staffId?: ID; ignoreAppointmentId?: ID; includeInactive?: boolean }): AvailabilityContext => {
    const services = loadServices(business.id)
    const service = services.find((s) => s.id === serviceId)
    if (!service) throw new BookingError('invalid_input')
    const zone = businessZone(business)
    return {
      business: { ...business, policies: { ...business.policies, minNoticeHours: 0, maxAdvanceDays: 730 } },
      service,
      staff: loadStaff(business.id),
      appointments: loadBlocking(business.id, startOfZonedDay(from, zone), addZonedDays(from, Math.max(days, 1), zone)),
      servicesById: new Map(services.map((s) => [s.id, s])),
      now: now(),
      staffIds: options.staffId ? [options.staffId] : undefined,
      ignoreAppointmentId: options.ignoreAppointmentId,
    }
  }
  const requireAppointment = (bizId: ID, id: ID) => {
    const row = sql.get<AppointmentRow>('SELECT * FROM appointments WHERE business_id = ? AND id = ?', [bizId, id])
    if (!row) throw new BookingError('not_found')
    return toAppointment(row)
  }
  /** New client (business-entered). Phone numbers are unique per business. */
  const insertCustomer = (bizId: ID, input: CustomerInput, t: string): Customer => {
    validateCustomer(input)
    const c = cleanCustomer(input)
    if (sql.get('SELECT 1 FROM customers WHERE business_id = ? AND phone_digits = ? AND erased_at IS NULL', [bizId, phoneDigits(c.phone)])) throw new BookingError('duplicate')
    const customer: Customer = { businessId: bizId, id: newId('cus'), firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, createdAt: t, tags: c.tags ?? ['New'], marketingOptIn: c.marketingOptIn }
    if (c.notes) customer.notes = c.notes
    sql.run(
      `INSERT INTO customers (id, business_id, first_name, last_name, email, phone, phone_digits, tags, notes, marketing_opt_in, created_at)
       VALUES (:id, :business_id, :first_name, :last_name, :email, :phone, :phone_digits, :tags, :notes, :marketing_opt_in, :created_at)`,
      customerParams(customer),
    )
    if (c.preferredLanguage) {
      sql.run('UPDATE customers SET preferred_language = ? WHERE id = ?', [c.preferredLanguage, customer.id])
      customer.preferredLanguage = c.preferredLanguage
    }
    return customer
  }

  /** Public access to one booking is by its unguessable manage token only (never the short reference). */
  const appointmentByRef = (bizId: ID, token: string) => {
    if (!isManageToken(token)) return undefined
    const row = sql.get<AppointmentRow>('SELECT * FROM appointments WHERE business_id = ? AND manage_token = ?', [bizId, token])
    return row ? toAppointment(row) : undefined
  }
  const changeableByRef = (business: Business, reference: string) => {
    const a = appointmentByRef(business.id, reference)
    if (!a) throw new BookingError('not_found')
    assertChangeable(a, business, now())
    return a
  }

  const saveAppointment = (a: Appointment) => {
    const p = appointmentParams(a, now().toISOString())
    sql.run(
      `UPDATE appointments SET staff_id = :staff_id, start_at = :start_at, end_at = :end_at, status = :status, notes = :notes, reminder_sent = :reminder_sent,
         cancelled_at = :cancelled_at, cancelled_by = :cancelled_by, cancellation_reason = :cancellation_reason,
         rescheduled_at = :rescheduled_at, previous_start_at = :previous_start_at, updated_at = :updated_at
       WHERE business_id = :business_id AND id = :id`,
      {
        staff_id: p.staff_id, start_at: p.start_at, end_at: p.end_at, status: p.status, notes: p.notes, reminder_sent: p.reminder_sent, cancelled_at: p.cancelled_at,
        cancelled_by: p.cancelled_by, cancellation_reason: p.cancellation_reason, rescheduled_at: p.rescheduled_at,
        previous_start_at: p.previous_start_at, updated_at: p.updated_at, business_id: p.business_id, id: p.id,
      },
    )
  }

  const insertAppointment = (a: Appointment) => {
    const p = { ...appointmentParams(a, now().toISOString()), reminders_opt_in: a.remindersOptIn === false ? 0 : 1 }
    sql.run(
      `INSERT INTO appointments (id, business_id, customer_id, staff_id, service_id, start_at, end_at, status, source, price_minor, notes,
         reminder_sent, reference, manage_token, cancelled_at, cancelled_by, cancellation_reason, rescheduled_at, previous_start_at, reminders_opt_in, created_at, updated_at)
       VALUES (:id, :business_id, :customer_id, :staff_id, :service_id, :start_at, :end_at, :status, :source, :price_minor, :notes,
         :reminder_sent, :reference, :manage_token, :cancelled_at, :cancelled_by, :cancellation_reason, :rescheduled_at, :previous_start_at, :reminders_opt_in, :created_at, :updated_at)`,
      p,
    )
  }

  return {
    isPersistent: true,

    /* ---------------- Business (dashboard) ---------------- */

    getBusiness: async () => requireBusiness(businessId()),

    updateBusiness: async (update) => {
      const bizId = businessId()
      const next = sql.transaction(() => {
        const current = requireBusiness(bizId)
        if (update.name !== undefined && normalizeName(update.name).length < 2) throw new BookingError('invalid_input')
        if (update.settings) validateSettings(update.settings)
        if (update.policies) validatePolicies(update.policies)
        if (update.hours) validateHours(update.hours)
        if (update.timezone !== undefined && !isValidTimeZone(update.timezone)) throw new BookingError('invalid_input')
        const merged: Business = { ...current, ...update, updatedAt: now().toISOString() }

        sql.run(
          `UPDATE businesses SET name = :name, description = :description, category = :category, phone = :phone, email = :email,
             address = :address, timezone = :timezone, updated_at = :updated_at WHERE id = :id`,
          { id: bizId, name: merged.name, description: merged.description, category: merged.category, phone: merged.phone, email: merged.email, address: merged.address, timezone: merged.timezone, updated_at: merged.updatedAt },
        )
        sql.run(UPDATE_SETTINGS_SQL, { ...settingsParams(merged), business_id: bizId })
        if (update.hours) {
          for (let d = 0; d < 7; d++) {
            const h = merged.hours[d as 0]
            sql.run(
              `INSERT INTO business_hours (business_id, weekday, is_open, opens_at, closes_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (business_id, weekday) DO UPDATE SET is_open = excluded.is_open, opens_at = excluded.opens_at, closes_at = excluded.closes_at`,
              [bizId, d, h.open ? 1 : 0, h.start, h.end],
            )
          }
        }
        if (update.slug !== undefined && update.slug !== current.slug) {
          const owner = businessIdBySlug(update.slug)
          validateSlug(update.slug, () => owner !== undefined && owner !== bizId)
          // Keep the old link working: it stays as a secondary link of this business.
          sql.run('UPDATE booking_links SET is_primary = 0 WHERE business_id = ?', [bizId])
          if (owner === bizId) sql.run('UPDATE booking_links SET is_primary = 1 WHERE slug = ?', [update.slug])
          else sql.run('INSERT INTO booking_links (id, business_id, slug, is_primary, created_at) VALUES (?, ?, ?, 1, ?)', [newId('lnk'), bizId, update.slug, now().toISOString()])
        }
        return requireBusiness(bizId)
      })
      publish(bizId, ['business'])
      return next
    },

    listStaff: async () => loadStaff(businessId()),
    listServices: async () => loadServices(businessId()),

    updateService: async (service) => {
      validateService(service)
      const bizId = businessId()
      const r = sql.run(
        `UPDATE services SET name = :name, category = :category, description = :description, duration_min = :duration_min,
           buffer_min = :buffer_min, price_minor = :price_minor, active = :active WHERE business_id = :business_id AND id = :id AND deleted_at IS NULL`,
        serviceParams({ ...service, businessId: bizId }),
      )
      if (!r.changes) throw new BookingError('not_found')
      publish(bizId, ['services'])
    },

    createService: async (input) => {
      validateService(input)
      const bizId = businessId()
      const service: Service = { businessId: bizId, id: newId('svc'), ...input, name: input.name.trim(), category: input.category.trim(), description: input.description.trim() }
      const order = sql.get<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM services WHERE business_id = ?', [bizId])!.n
      sql.run(
        `INSERT INTO services (id, business_id, name, category, description, duration_min, buffer_min, price_minor, active, sort_order)
         VALUES (:id, :business_id, :name, :category, :description, :duration_min, :buffer_min, :price_minor, :active, :sort_order)`,
        { ...serviceParams(service), sort_order: Number(order) },
      )
      publish(bizId, ['services'])
      return service
    },

    deleteService: async (id) => {
      const bizId = businessId()
      const r = sql.run('UPDATE services SET deleted_at = ?, active = 0 WHERE business_id = ? AND id = ? AND deleted_at IS NULL', [now().toISOString(), bizId, id])
      if (!r.changes) throw new BookingError('not_found')
      publish(bizId, ['services', 'staff'])
    },

    createStaff: async (input) => {
      validateStaff(input)
      const bizId = businessId()
      const id = newId('stf')
      sql.transaction(() => {
        const count = Number(sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM staff WHERE business_id = ? AND deleted_at IS NULL', [bizId])!.n)
        if (count >= staffLimit(bizId)) throw new BookingError('plan_limit')
        const order = sql.get<{ n: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM staff WHERE business_id = ?', [bizId])!.n
        sql.run('INSERT INTO staff (id, business_id, name, role, color, avatar_initials, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, bizId, normalizeName(input.name), input.role.trim(), input.color, initialsFor(input.name), Number(order)])
        writeStaffLinks(bizId, id, input)
      })
      publish(bizId, ['staff'])
      return loadStaff(bizId).find((s) => s.id === id)!
    },

    updateStaff: async (id, input) => {
      validateStaff(input)
      const bizId = businessId()
      sql.transaction(() => {
        const r = sql.run('UPDATE staff SET name = ?, role = ?, color = ?, avatar_initials = ? WHERE business_id = ? AND id = ? AND deleted_at IS NULL', [normalizeName(input.name), input.role.trim(), input.color, initialsFor(input.name), bizId, id])
        if (!r.changes) throw new BookingError('not_found')
        writeStaffLinks(bizId, id, input)
      })
      publish(bizId, ['staff'])
      return loadStaff(bizId).find((s) => s.id === id)!
    },

    deleteStaff: async (id) => {
      const bizId = businessId()
      sql.transaction(() => {
        const exists = sql.get('SELECT 1 FROM staff WHERE business_id = ? AND id = ? AND deleted_at IS NULL', [bizId, id])
        if (!exists) throw new BookingError('not_found')
        const upcoming = sql.get("SELECT 1 FROM appointments WHERE business_id = ? AND staff_id = ? AND status IN ('confirmed','pending') AND start_at > ?", [bizId, id, now().toISOString()])
        if (upcoming) throw new BookingError('in_use')
        sql.run('UPDATE staff SET deleted_at = ? WHERE id = ?', [now().toISOString(), id])
      })
      publish(bizId, ['staff'])
    },

    setBusinessImage: async (kind, dataUrl) => {
      const bizId = businessId()
      const column = kind === 'logo' ? 'logo_url' : 'cover_url'
      const previous = sql.get<{ url: string | null }>(`SELECT ${column} AS url FROM businesses WHERE id = ?`, [bizId])?.url
      let url: string | null = null
      if (dataUrl !== null) {
        if (!images) throw new BookingError('invalid_image')
        url = images.save(bizId, kind, dataUrl) // validates type, size and content
      }
      sql.run(`UPDATE businesses SET ${column} = ?, updated_at = ? WHERE id = ?`, [url, now().toISOString(), bizId])
      if (previous && previous !== url) images?.remove(previous)
      publish(bizId, ['business'])
      return requireBusiness(bizId)
    },

    setPublished: async (published) => {
      const bizId = businessId()
      if (published && !isReady(bizId)) throw new BookingError('not_ready')
      sql.run('UPDATE businesses SET published_at = ?, updated_at = ? WHERE id = ?', [published ? now().toISOString() : null, now().toISOString(), bizId])
      publish(bizId, ['business'])
      return requireBusiness(bizId)
    },

    completeOnboarding: async () => {
      const bizId = businessId()
      sql.run('UPDATE businesses SET onboarding_completed_at = COALESCE(onboarding_completed_at, ?), updated_at = ? WHERE id = ?', [now().toISOString(), now().toISOString(), bizId])
      publish(bizId, ['business'])
      return requireBusiness(bizId)
    },

    getCustomer: async (id) => {
      const row = sql.get<CustomerRow>('SELECT * FROM customers WHERE business_id = ? AND id = ? AND erased_at IS NULL', [businessId(), id])
      return row ? toCustomer(row) : undefined
    },

    listCustomers: async () => {
      const rows = sql.all<CustomerRow & { total_visits: number; no_shows: number; ltv_minor: number; last_visit: string | null; next_appointment: string | null }>(
        `SELECT c.*,
           COALESCE(SUM(a.status = 'completed'), 0) AS total_visits,
           COALESCE(SUM(a.status = 'no_show'), 0) AS no_shows,
           COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.price_minor END), 0) AS ltv_minor,
           MAX(CASE WHEN a.status = 'completed' THEN a.start_at END) AS last_visit,
           MIN(CASE WHEN a.status IN ('confirmed', 'pending') AND a.start_at > :now THEN a.start_at END) AS next_appointment
         FROM customers c
         LEFT JOIN appointments a ON a.business_id = c.business_id AND a.customer_id = c.id
         WHERE c.business_id = :biz AND c.erased_at IS NULL
         GROUP BY c.id
         ORDER BY c.rowid`,
        { biz: businessId(), now: now().toISOString() },
      )
      return rows.map<CustomerWithStats>((r) => {
        const out: CustomerWithStats = { ...toCustomer(r), totalVisits: Number(r.total_visits), noShows: Number(r.no_shows), lifetimeValue: fromMinor(Number(r.ltv_minor)) }
        if (r.last_visit) out.lastVisit = r.last_visit
        if (r.next_appointment) out.nextAppointment = r.next_appointment
        return out
      })
    },

    listAppointments: async (q: AppointmentQuery = {}) => {
      const bizId = businessId()
      const where = ['business_id = ?']
      const params: (string | number)[] = [bizId]
      if (q.from) (where.push('start_at >= ?'), params.push(q.from.toISOString()))
      if (q.to) (where.push('start_at < ?'), params.push(q.to.toISOString()))
      if (q.staffId) (where.push('staff_id = ?'), params.push(q.staffId))
      if (q.customerId) (where.push('customer_id = ?'), params.push(q.customerId))
      if (q.status?.length) (where.push(`status IN (${q.status.map(() => '?').join(',')})`), params.push(...q.status))
      const rows = sql.all<AppointmentRow>(`SELECT * FROM appointments WHERE ${where.join(' AND ')} ORDER BY start_at, id`, params).map(toAppointment)
      return joiner(bizId)(rows)
    },

    updateAppointmentStatus: async (id, status) => {
      const bizId = businessId()
      sql.transaction(() => {
        const row = sql.get<AppointmentRow>('SELECT * FROM appointments WHERE business_id = ? AND id = ?', [bizId, id])
        if (!row) throw new BookingError('not_found')
        const before = toAppointment(row)
        saveAppointment(applyStatusChange(before, status, now()))
        if (status === 'cancelled' && before.status !== 'cancelled') emit({ type: 'appointment.cancelled', businessId: bizId, appointmentId: id, by: 'business' })
        else if (status !== before.status) emit({ type: 'appointment.status_changed', businessId: bizId, appointmentId: id, status })
      })
      publish(bizId, ['appointments'])
    },

    listAvailabilityOffers: async (appointmentId) => {
      const bizId = businessId()
      const offers = sql.all<OfferRow>('SELECT * FROM availability_offers WHERE business_id = ? AND appointment_id = ? ORDER BY created_at', [bizId, appointmentId])
      return offers.map((o) => toOffer(o, sql.all<RecipientRow>('SELECT * FROM offer_recipients WHERE business_id = ? AND offer_id = ? ORDER BY rowid', [bizId, o.id])))
    },

    saveAvailabilityOffer: async (offer) => {
      const bizId = businessId()
      sql.transaction(() => {
        const existing = sql.get<{ business_id: string }>('SELECT business_id FROM availability_offers WHERE id = ?', [offer.id])
        if (existing && existing.business_id !== bizId) throw new BookingError('not_found')
        sql.run(
          `INSERT INTO availability_offers (id, business_id, appointment_id, channel, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`,
          [offer.id, bizId, offer.appointmentId, offer.channel, offer.createdAt],
        )
        // Delivery status is owned by the server (notification engine): new recipients always start
        // as "queued", and a client can never mark a message sent or delivered.
        if (!['sms', 'whatsapp', 'email'].includes(offer.channel) || !Array.isArray(offer.recipients) || offer.recipients.length > 50) throw new BookingError('invalid_input')
        for (const r of offer.recipients) {
          // The address comes from the client record, never from the request, and only clients
          // who agreed to marketing messages can receive an offer.
          const c = sql.get<CustomerRow>('SELECT * FROM customers WHERE business_id = ? AND id = ?', [bizId, r.customerId])
          if (!c || c.erased_at || c.messaging_opt_out_at || !c.marketing_opt_in) throw new BookingError('opted_out')
          const address = offer.channel === 'email' ? c.email : c.phone
          if (!address) throw new BookingError('no_contact')
          const message = validateMessageBody(r.message)
          sql.run(
            `INSERT INTO offer_recipients (business_id, offer_id, customer_id, address, message, status, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)
             ON CONFLICT (offer_id, customer_id) DO NOTHING`,
            [bizId, offer.id, r.customerId, address, message, now().toISOString()],
          )
        }
        emit({ type: 'smart_fill.offer_saved', businessId: bizId, offerId: offer.id })
      })
      publish(bizId, ['offers'])
    },

    listNotifications: async (appointmentId) =>
      sql
        .all<NotificationRow>('SELECT * FROM notifications WHERE business_id = ? AND appointment_id = ? ORDER BY scheduled_for, created_at', [businessId(), appointmentId])
        .map(toNotification),

    listCustomerNotifications: async (customerId) =>
      sql
        .all<NotificationRow>('SELECT * FROM notifications WHERE business_id = ? AND customer_id = ? ORDER BY scheduled_for DESC, created_at DESC LIMIT 100', [businessId(), customerId])
        .map(toNotification),

    /* ---------------- Appointments (business side) ---------------- */

    getStaffAvailability: async (serviceId, from, days, options = {}) => {
      const business = requireBusiness(businessId())
      return getAvailability(staffContext(business, serviceId, from, days, options), from, Math.min(Math.max(days, 1), 62))
    },

    createAppointment: async (input) => {
      const bizId = businessId()
      const created = sql.transaction(() => {
        const business = requireBusiness(bizId)
        const start = validateBusinessBooking(input, now())
        const ctx = staffContext(business, input.serviceId, start, 1, {})
        if (!ctx.staff.some((s) => s.id === input.staffId && s.serviceIds.includes(ctx.service.id))) throw new BookingError('invalid_input')
        if (hasConflict(ctx, input.staffId, start)) throw new BookingError('slot_unavailable')
        const t = now().toISOString()
        let customerId = input.customerId
        if (customerId) {
          const c = sql.get<CustomerRow>('SELECT * FROM customers WHERE business_id = ? AND id = ?', [bizId, customerId])
          if (!c || c.erased_at) throw new BookingError('not_found')
        } else {
          customerId = insertCustomer(bizId, input.customer!, t).id
        }
        const appointment: Appointment = {
          businessId: bizId,
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
          // Every booking gets a reference and a manage link, so the client can manage it from their messages.
          reference: generateReference((ref) => sql.get('SELECT 1 FROM appointments WHERE reference = ?', [ref]) !== undefined),
          manageToken: newManageToken(),
        }
        const notes = input.notes?.trim()
        if (notes) appointment.notes = notes
        insertAppointment(appointment)
        emit({ type: 'appointment.booked', businessId: bizId, appointmentId: appointment.id, notify: input.notify })
        return appointment
      })
      publish(bizId, ['appointments', 'customers'])
      return joiner(bizId)([created])[0]
    },

    moveAppointment: async (id, change) => {
      const bizId = businessId()
      const moved = sql.transaction(() => {
        const business = requireBusiness(bizId)
        const before = requireAppointment(bizId, id)
        const start = new Date(typeof change?.start === 'string' ? change.start : NaN)
        if (Number.isNaN(start.getTime()) || typeof change.notify !== 'boolean') throw new BookingError('invalid_input')
        if (before.status !== 'confirmed' && before.status !== 'pending') throw new BookingError('not_changeable')
        const staffId = change.staffId ?? before.staffId
        const ctx = staffContext(business, before.serviceId, start, 1, { ignoreAppointmentId: id, includeInactive: true })
        if (!ctx.staff.some((s) => s.id === staffId && s.serviceIds.includes(before.serviceId))) throw new BookingError('invalid_input')
        if (hasConflict(ctx, staffId, start)) throw new BookingError('slot_unavailable')
        const next = applyBusinessMove(before, start, staffId, now())
        saveAppointment(next)
        sql.run("UPDATE appointments SET rescheduled_by = 'business' WHERE id = ?", [id])
        emit({ type: 'appointment.rescheduled', businessId: bizId, appointmentId: id, previousStart: before.start, notify: change.notify })
        return next
      })
      publish(bizId, ['appointments'])
      return joiner(bizId)([moved])[0]
    },

    cancelAppointment: async (id, { notify }) => {
      const bizId = businessId()
      const cancelled = sql.transaction(() => {
        const before = requireAppointment(bizId, id)
        if (before.status === 'cancelled') throw new BookingError('already_cancelled')
        const next = applyCancellation(before, 'business', now())
        saveAppointment(next)
        emit({ type: 'appointment.cancelled', businessId: bizId, appointmentId: id, by: 'business', notify: notify !== false })
        return next
      })
      publish(bizId, ['appointments'])
      return joiner(bizId)([cancelled])[0]
    },

    updateAppointmentNotes: async (id, notes) => {
      const bizId = businessId()
      if (typeof notes !== 'string' || notes.length > 2000) throw new BookingError('invalid_input')
      const r = sql.run('UPDATE appointments SET notes = ?, updated_at = ? WHERE business_id = ? AND id = ?', [notes.trim() || null, now().toISOString(), bizId, id])
      if (!r.changes) throw new BookingError('not_found')
      publish(bizId, ['appointments'])
    },

    sendReminder: async (id) => {
      const bizId = businessId()
      sql.transaction(() => {
        const a = requireAppointment(bizId, id)
        if ((a.status !== 'confirmed' && a.status !== 'pending') || new Date(a.start) <= now()) throw new BookingError('not_changeable')
        const c = sql.get<CustomerRow>('SELECT * FROM customers WHERE business_id = ? AND id = ?', [bizId, a.customerId])!
        if (a.remindersOptIn === false || c.messaging_opt_out_at) throw new BookingError('opted_out')
        if (!c.phone && !c.email) throw new BookingError('no_contact')
        emit({ type: 'appointment.reminder_requested', businessId: bizId, appointmentId: id })
      })
      publish(bizId, ['notifications'])
    },

    /* ---------------- Clients ---------------- */

    createCustomer: async (input) => {
      const bizId = businessId()
      const c = sql.transaction(() => insertCustomer(bizId, input, now().toISOString()))
      publish(bizId, ['customers'])
      return c
    },

    updateCustomer: async (id, input) => {
      validateCustomer(input)
      const bizId = businessId()
      const c = cleanCustomer(input)
      const updated = sql.transaction(() => {
        const existing = sql.get<CustomerRow>('SELECT * FROM customers WHERE business_id = ? AND id = ?', [bizId, id])
        if (!existing || existing.erased_at) throw new BookingError('not_found')
        const clash = sql.get('SELECT 1 FROM customers WHERE business_id = ? AND phone_digits = ? AND id <> ? AND erased_at IS NULL', [bizId, phoneDigits(c.phone), id])
        if (clash) throw new BookingError('duplicate')
        sql.run(
          `UPDATE customers SET first_name = ?, last_name = ?, phone = ?, phone_digits = ?, email = ?, notes = ?, marketing_opt_in = ?,
             preferred_language = COALESCE(?, preferred_language), tags = COALESCE(?, tags), updated_at = ? WHERE business_id = ? AND id = ?`,
          [c.firstName, c.lastName, c.phone, phoneDigits(c.phone), c.email, c.notes ?? null, c.marketingOptIn ? 1 : 0, c.preferredLanguage ?? null, c.tags ? JSON.stringify(c.tags) : null, now().toISOString(), bizId, id],
        )
        return toCustomer(sql.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', [id])!)
      })
      publish(bizId, ['customers', 'appointments'])
      return updated
    },

    setCustomerOptOut: async (id, optedOut) => {
      const bizId = businessId()
      const updated = sql.transaction(() => {
        const r = sql.run('UPDATE customers SET messaging_opt_out_at = ?, updated_at = ? WHERE business_id = ? AND id = ? AND erased_at IS NULL', [optedOut ? now().toISOString() : null, now().toISOString(), bizId, id])
        if (!r.changes) throw new BookingError('not_found')
        if (optedOut) emit({ type: 'customer.opted_out', businessId: bizId, customerId: id })
        return toCustomer(sql.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', [id])!)
      })
      publish(bizId, ['customers'])
      return updated
    },

    eraseCustomer: async (id) => {
      const bizId = businessId()
      sql.transaction(() => {
        const c = sql.get<CustomerRow>('SELECT * FROM customers WHERE business_id = ? AND id = ?', [bizId, id])
        if (!c || c.erased_at) throw new BookingError('not_found')
        const upcoming = sql.get("SELECT 1 FROM appointments WHERE business_id = ? AND customer_id = ? AND status IN ('confirmed','pending') AND start_at > ?", [bizId, id, now().toISOString()])
        if (upcoming) throw new BookingError('in_use')
        // Right to erasure: personal data goes; anonymous visit history stays (revenue, statistics).
        sql.run(
          `UPDATE customers SET first_name = ?, last_name = '', email = '', phone = '', phone_digits = '', notes = NULL, tags = '[]',
             marketing_opt_in = 0, erased_at = ?, updated_at = ? WHERE id = ?`,
          [ERASED_NAME, now().toISOString(), now().toISOString(), id],
        )
        sql.run('UPDATE appointments SET notes = NULL WHERE business_id = ? AND customer_id = ?', [bizId, id])
        sql.run("UPDATE notifications SET recipient = '', body = NULL, subject = NULL WHERE business_id = ? AND customer_id = ? AND status <> 'pending'", [bizId, id])
        sql.run("UPDATE offer_recipients SET address = '', message = '' WHERE business_id = ? AND customer_id = ?", [bizId, id])
        emit({ type: 'customer.erased', businessId: bizId, customerId: id })
      })
      publish(bizId, ['customers', 'appointments'])
    },

    importCustomers: async (rows) => {
      if (!Array.isArray(rows) || rows.length > 5000) throw new BookingError('invalid_input')
      const bizId = businessId()
      const result: ImportResult = { created: 0, duplicates: [], invalid: [] }
      sql.transaction(() => {
        const t = now().toISOString()
        rows.forEach((row, i) => {
          try {
            insertCustomer(bizId, { ...row, tags: row?.tags ?? [] }, t)
            result.created++
          } catch (e) {
            if (e instanceof BookingError && e.code === 'duplicate') result.duplicates.push(i + 1)
            else if (e instanceof BookingError) result.invalid.push(i + 1)
            else throw e
          }
        })
      })
      if (result.created) publish(bizId, ['customers'])
      return result
    },

    sendCustomerMessage: async (id, body) => {
      const bizId = businessId()
      const text = validateMessageBody(body)
      sql.transaction(() => {
        const c = sql.get<CustomerRow>('SELECT * FROM customers WHERE business_id = ? AND id = ?', [bizId, id])
        if (!c || c.erased_at) throw new BookingError('not_found')
        if (c.messaging_opt_out_at) throw new BookingError('opted_out')
        if (!c.phone && !c.email) throw new BookingError('no_contact')
        emit({ type: 'customer.message_requested', businessId: bizId, customerId: id, body: text })
      })
      publish(bizId, ['notifications'])
    },

    /* ---------------- Public booking ---------------- */

    getPublicProfile: async (slug) => {
      const b = businessBySlug(slug)
      if (!b) return undefined
      const profile: PublicBusinessProfile = {
        business: { id: b.id, slug: b.slug, name: b.name, description: b.description, category: b.category, phone: b.phone, address: b.address, hours: b.hours, policies: b.policies, settings: b.settings, timezone: b.timezone, logoUrl: b.logoUrl, coverUrl: b.coverUrl, publishedAt: b.publishedAt },
        services: loadServices(b.id).filter((s) => s.active),
        staff: loadStaff(b.id).map(({ id, name, color, avatarInitials, serviceIds }) => ({ id, name, color, avatarInitials, serviceIds })),
      }
      if (!entitled(b.id)) profile.bookingPaused = true
      return profile
    },

    getAvailability: async (slug, serviceId, from, days, staffId) => {
      const business = requireBySlug(slug)
      return getAvailability(availabilityContext(business, serviceId, from, days, staffId ? { staffIds: [staffId] } : {}), from, days)
    },

    createBooking: async (slug, input) => {
      const business = requireBySlug(slug)
      requirePublished(business) // previews can be browsed but not booked
      if (!entitled(business.id)) throw new BookingError('booking_paused')
      const invalid = validateCustomerInput(input.name, input.phone)
      if (invalid.name || invalid.phone) throw new BookingError('invalid_input')
      const start = new Date(input.start)
      if (Number.isNaN(start.getTime())) throw new BookingError('invalid_input')

      const created = sql.transaction(() => {
        // Re-check inside the write transaction: nobody can take the slot between check and insert.
        const ctx = availabilityContext(business, input.serviceId, start, 1, input.staffId ? { staffIds: [input.staffId] } : {})
        const staffId = pickStaffForSlot(ctx, start)
        if (!staffId) throw new BookingError('slot_unavailable')
        const t = now().toISOString()

        let customerRow = sql.get<CustomerRow>('SELECT * FROM customers WHERE business_id = ? AND phone_digits = ? AND erased_at IS NULL ORDER BY created_at LIMIT 1', [business.id, phoneDigits(input.phone)])
        if (!customerRow) {
          const customer: Customer = { businessId: business.id, id: newId('cus'), ...splitName(input.name), email: '', phone: input.phone.trim(), createdAt: t, tags: ['New'], marketingOptIn: false }
          sql.run(
            `INSERT INTO customers (id, business_id, first_name, last_name, email, phone, phone_digits, tags, notes, marketing_opt_in, created_at)
             VALUES (:id, :business_id, :first_name, :last_name, :email, :phone, :phone_digits, :tags, :notes, :marketing_opt_in, :created_at)`,
            customerParams(customer),
          )
          customerRow = sql.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', [customer.id])!
        }
        // The language they booked in is the language we message them in.
        if (input.locale === 'en' || input.locale === 'he') sql.run('UPDATE customers SET preferred_language = ? WHERE id = ?', [input.locale, customerRow.id])

        const appointment: Appointment = {
          businessId: business.id,
          id: newId('apt'),
          customerId: customerRow.id,
          staffId,
          serviceId: ctx.service.id,
          start: start.toISOString(),
          end: new Date(start.getTime() + ctx.service.durationMin * 60_000).toISOString(),
          status: business.policies.autoConfirm ? 'confirmed' : 'pending',
          source: 'online',
          price: ctx.service.price,
          reminderSent: false,
          reference: generateReference((ref) => sql.get('SELECT 1 FROM appointments WHERE reference = ?', [ref]) !== undefined),
          manageToken: newManageToken(),
        }
        const notes = input.notes?.trim()
        if (notes) appointment.notes = notes
        if (input.remindersOptIn === false) appointment.remindersOptIn = false
        insertAppointment(appointment)
        emit({ type: 'appointment.booked', businessId: business.id, appointmentId: appointment.id })
        return appointment
      })
      publish(business.id, ['appointments', 'customers'])
      return joiner(business.id)([created])[0]
    },

    getBookingByReference: async (slug, reference) => {
      const business = businessBySlug(slug)
      const a = business && appointmentByRef(business.id, reference)
      return a ? joiner(business.id)([a])[0] : undefined
    },

    getRescheduleAvailability: async (slug, reference, from, days) => {
      const business = requireBySlug(slug)
      const a = changeableByRef(business, reference)
      return getAvailability(availabilityContext(business, a.serviceId, from, days, { staffIds: [a.staffId], ignoreAppointmentId: a.id }), from, days)
    },

    rescheduleBooking: async (slug, reference, start) => {
      const business = requireBySlug(slug)
      const newStart = new Date(start)
      const moved = sql.transaction(() => {
        const a = changeableByRef(business, reference)
        const ctx = availabilityContext(business, a.serviceId, newStart, 1, { staffIds: [a.staffId], ignoreAppointmentId: a.id })
        if (!pickStaffForSlot(ctx, newStart)) throw new BookingError('slot_unavailable')
        const next = applyReschedule(a, newStart, now())
        saveAppointment(next)
        sql.run("UPDATE appointments SET rescheduled_by = 'customer' WHERE id = ?", [a.id])
        emit({ type: 'appointment.rescheduled', businessId: business.id, appointmentId: a.id, previousStart: a.start })
        return next
      })
      publish(business.id, ['appointments'])
      return joiner(business.id)([moved])[0]
    },

    cancelBooking: async (slug, reference, reason) => {
      const business = requireBySlug(slug)
      const cancelled = sql.transaction(() => {
        const next = applyCancellation(changeableByRef(business, reference), 'customer', now(), reason)
        saveAppointment(next)
        emit({ type: 'appointment.cancelled', businessId: business.id, appointmentId: next.id, by: 'customer' })
        return next
      })
      publish(business.id, ['appointments'])
      return joiner(business.id)([cancelled])[0]
    },

    /* ---------------- Data lifecycle ---------------- */

    onChange: (listener) => events?.subscribe(businessId(), listener) ?? (() => {}),

    resetDemoData: async () => {
      if (!resetBusiness) throw new BookingError('not_found')
      const bizId = businessId()
      resetBusiness(bizId)
      publish(bizId, ['business', 'staff', 'services', 'customers', 'appointments', 'offers'])
    },
  }
}
