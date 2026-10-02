import { newManageToken } from '../../src/domain/bookingRules'
import { buildDemoDataset, type Dataset } from '../../src/data/seed/demo'
import type { ID } from '../../src/domain/types'
import { appointmentParams, customerParams, serviceParams, settingsParams, UPDATE_SETTINGS_SQL } from '../repositories/mappers'
import type { Sql } from './sqlite'

export interface SeedUser {
  email: string
  name: string
  passwordHash: string
  businessId: ID
  role: 'owner' | 'staff'
}

/** Writes a domain dataset (as produced by buildDemoDataset) into the relational tables. */
export function insertDataset(sql: Sql, ds: Dataset) {
  sql.transaction(() => {
    for (const b of ds.businesses) {
      sql.run(
        `INSERT INTO businesses (id, name, description, category, timezone, phone, email, address, logo_url, cover_url, published_at, onboarding_completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [b.id, b.name, b.description, b.category, b.timezone, b.phone, b.email, b.address, b.logoUrl ?? null, b.coverUrl ?? null, b.publishedAt ?? null, b.onboardingCompletedAt ?? null, b.createdAt, b.updatedAt],
      )
      sql.run(
        `INSERT INTO business_settings (business_id, default_language, currency, min_notice_hours, max_advance_days, cancellation_window_hours,
           require_deposit, deposit_percent, auto_confirm, reminder_hours_before, waitlist_enabled, notification_channel, phone_country, updated_at)
         VALUES (:business_id, :default_language, :currency, :min_notice_hours, :max_advance_days, :cancellation_window_hours,
           :require_deposit, :deposit_percent, :auto_confirm, :reminder_hours_before, :waitlist_enabled, :notification_channel, :phone_country, :updated_at)`,
        { business_id: b.id, ...settingsParams(b) },
      )
      for (let d = 0; d < 7; d++) {
        const h = b.hours[d as 0]
        sql.run('INSERT INTO business_hours (business_id, weekday, is_open, opens_at, closes_at) VALUES (?, ?, ?, ?, ?)', [b.id, d, h.open ? 1 : 0, h.start, h.end])
      }
      sql.run('INSERT INTO booking_links (id, business_id, slug, is_primary, created_at) VALUES (?, ?, ?, 1, ?)', [`lnk_${b.id}`, b.id, b.slug, b.createdAt])
    }
    insertOperational(sql, ds)
  })
}

/** Staff, services, customers and appointments (everything "Restore demo data" replaces). */
function insertOperational(sql: Sql, ds: Dataset) {
  ds.staff.forEach((s, i) => {
    sql.run('INSERT INTO staff (id, business_id, name, role, color, avatar_initials, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)', [s.id, s.businessId, s.name, s.role, s.color, s.avatarInitials, i])
  })
  ds.services.forEach((s, i) => {
    sql.run(
      `INSERT INTO services (id, business_id, name, category, description, duration_min, buffer_min, price_minor, active, sort_order)
       VALUES (:id, :business_id, :name, :category, :description, :duration_min, :buffer_min, :price_minor, :active, :sort_order)`,
      { ...serviceParams(s), sort_order: i },
    )
  })
  for (const s of ds.staff) for (const svc of s.serviceIds) sql.run('INSERT INTO staff_services (business_id, staff_id, service_id) VALUES (?, ?, ?)', [s.businessId, s.id, svc])
  for (const c of ds.customers) {
    sql.run(
      `INSERT INTO customers (id, business_id, first_name, last_name, email, phone, phone_digits, tags, notes, marketing_opt_in, created_at)
       VALUES (:id, :business_id, :first_name, :last_name, :email, :phone, :phone_digits, :tags, :notes, :marketing_opt_in, :created_at)`,
      customerParams(c),
    )
  }
  const insert = `INSERT INTO appointments (id, business_id, customer_id, staff_id, service_id, start_at, end_at, status, source, price_minor, notes,
      reminder_sent, reference, manage_token, cancelled_at, cancelled_by, cancellation_reason, rescheduled_at, previous_start_at, created_at, updated_at)
    VALUES (:id, :business_id, :customer_id, :staff_id, :service_id, :start_at, :end_at, :status, :source, :price_minor, :notes,
      :reminder_sent, :reference, :manage_token, :cancelled_at, :cancelled_by, :cancellation_reason, :rescheduled_at, :previous_start_at, :created_at, :updated_at)`
  for (const a of ds.appointments) sql.run(insert, { ...appointmentParams(a, a.cancelledAt ?? a.start), manage_token: a.manageToken ?? newManageToken() })
}

export function insertUsers(sql: Sql, users: SeedUser[], now: Date) {
  sql.transaction(() => {
    for (const u of users) {
      const existing = sql.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [u.email])
      const id = existing?.id ?? `usr_${u.email.split('@')[0].replace(/\W/g, '')}_${u.businessId}`
      if (!existing) sql.run('INSERT INTO users (id, email, name, password_hash, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?)', [id, u.email, u.name, u.passwordHash, now.toISOString(), now.toISOString()])
      sql.run('INSERT OR IGNORE INTO memberships (user_id, business_id, role, created_at) VALUES (?, ?, ?, ?)', [id, u.businessId, u.role, now.toISOString()])
    }
  })
}

/** Gives a dataset globally unique ids (SQL ids are global; the demo generator reuses short ids). */
export function prefixDataset(ds: Dataset, prefix: string): Dataset {
  const p = (id: string) => `${prefix}${id}`
  return {
    businesses: ds.businesses,
    staff: ds.staff.map((s) => ({ ...s, id: p(s.id), serviceIds: s.serviceIds.map(p) })),
    services: ds.services.map((s) => ({ ...s, id: p(s.id) })),
    customers: ds.customers.map((c) => ({ ...c, id: p(c.id) })),
    appointments: ds.appointments.map((a) => ({ ...a, id: p(a.id), customerId: p(a.customerId), staffId: p(a.staffId), serviceId: p(a.serviceId) })),
  }
}

/* ---------------- Demo tenants ---------------- */

export const DEMO = {
  luna: { businessId: 'biz_1', ownerEmail: 'maya@lunahair.studio', ownerName: 'Maya Cohen' },
  glow: { businessId: 'biz_glow', ownerEmail: 'lena@glowlab.studio', ownerName: 'Lena Rossi' },
} as const

export function demoDatasets(now: Date): Dataset[] {
  const luna = prefixDataset(buildDemoDataset(now, DEMO.luna.businessId), 'luna_')
  const glowBase = buildDemoDataset(now, DEMO.glow.businessId)
  glowBase.businesses[0] = {
    ...glowBase.businesses[0],
    slug: 'glow-lab',
    name: 'Glow Lab',
    category: 'Hair & color studio',
    description: 'Color specialists in a bright, friendly space.',
    phone: '(555) 301-7744',
    email: 'hello@glowlab.studio',
    address: '41 Grand St, Brooklyn, NY',
  }
  glowBase.staff = glowBase.staff.map((s, i) => ({ ...s, name: ['Lena Rossi', 'Omar Haddad', 'Tali Ben-Ami'][i], avatarInitials: ['LR', 'OH', 'TB'][i] }))
  // A smaller client book keeps the second tenant clearly different.
  const keep = new Set(glowBase.customers.slice(0, 60).map((c) => c.id))
  glowBase.customers = glowBase.customers.filter((c) => keep.has(c.id))
  glowBase.appointments = glowBase.appointments.filter((a) => keep.has(a.customerId))
  return [luna, prefixDataset(glowBase, 'glow_')]
}

export function demoUsers(passwordHash: string): SeedUser[] {
  return [
    { email: DEMO.luna.ownerEmail, name: DEMO.luna.ownerName, passwordHash, businessId: DEMO.luna.businessId, role: 'owner' },
    { email: DEMO.glow.ownerEmail, name: DEMO.glow.ownerName, passwordHash, businessId: DEMO.glow.businessId, role: 'owner' },
  ]
}

/** Seeds both demo tenants and their owners when the database has no businesses yet. */
export function seedDemoIfEmpty(sql: Sql, now: Date, passwordHash: string): boolean {
  const count = sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM businesses')!.n
  if (Number(count) > 0) return false
  for (const ds of demoDatasets(now)) insertDataset(sql, ds)
  insertUsers(sql, demoUsers(passwordHash), now)
  return true
}

/** Replaces one business's operational data and settings with a fresh demo copy (keeps users and sessions). */
export function resetBusinessData(sql: Sql, businessId: ID, now: Date) {
  const ds = demoDatasets(now).find((d) => d.businesses[0].id === businessId)
  if (!ds) throw new Error(`No demo data for ${businessId}`)
  const b = ds.businesses[0]
  sql.transaction(() => {
    for (const table of ['notifications', 'offer_recipients', 'availability_offers', 'appointments', 'customers', 'staff_hours', 'staff_services', 'services', 'staff', 'business_hours']) {
      sql.run(`DELETE FROM ${table} WHERE business_id = ?`, [businessId])
    }
    sql.run(`UPDATE businesses SET name = ?, description = ?, category = ?, phone = ?, email = ?, address = ?, updated_at = ? WHERE id = ?`, [b.name, b.description, b.category, b.phone, b.email, b.address, now.toISOString(), b.id])
    sql.run(UPDATE_SETTINGS_SQL, { ...settingsParams(b), business_id: b.id })
    for (let d = 0; d < 7; d++) {
      const h = b.hours[d as 0]
      sql.run('INSERT INTO business_hours (business_id, weekday, is_open, opens_at, closes_at) VALUES (?, ?, ?, ?, ?)', [b.id, d, h.open ? 1 : 0, h.start, h.end])
    }
    sql.run('DELETE FROM booking_links WHERE business_id = ?', [b.id])
    sql.run('INSERT INTO booking_links (id, business_id, slug, is_primary, created_at) VALUES (?, ?, ?, 1, ?)', [`lnk_${b.id}`, b.id, b.slug, now.toISOString()])
    insertOperational(sql, ds)
  })
}
