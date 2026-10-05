import { addMinutes, isBefore, subDays } from 'date-fns'
import { addZonedDays, atWallTime, businessZone, zonedWeekday } from '@/domain/time'
import type {
  Appointment,
  AppointmentStatus,
  BookingSource,
  Business,
  Customer,
  CustomerTag,
  ID,
  Service,
  StaffMember,
} from '@/domain/types'
import { createRng } from './random'

/**
 * Demo tenant ("Luna Hair Studio") used to seed a fresh database.
 * Pure and deterministic for a given `now`: the same seed always yields the same
 * business, so tests and demos are reproducible. Real tenants never go through here.
 */

export const DEMO_BUSINESS_ID = 'biz_1'

export interface Dataset {
  businesses: Business[]
  staff: StaffMember[]
  services: Service[]
  customers: Customer[]
  appointments: Appointment[]
}

function demoBusiness(now: Date, businessId: ID): Business {
  const ts = now.toISOString()
  return {
    id: businessId,
    slug: 'luna-hair',
    name: 'Luna Hair Studio',
    description: 'A calm, light-filled studio for precision cuts, lived-in color and smoothing treatments. Book your next visit in under a minute.',
    category: 'Hair salon',
    timezone: 'America/New_York',
    phone: '(555) 214-8890',
    email: 'hello@lunahair.studio',
    address: '218 Mercer St, Brooklyn, NY',
    hours: {
      0: { open: false, start: '10:00', end: '16:00' },
      1: { open: true, start: '09:00', end: '18:00' },
      2: { open: true, start: '09:00', end: '18:00' },
      3: { open: true, start: '09:00', end: '20:00' },
      4: { open: true, start: '09:00', end: '20:00' },
      5: { open: true, start: '09:00', end: '18:00' },
      6: { open: true, start: '10:00', end: '16:00' },
    },
    policies: {
      minNoticeHours: 2,
      maxAdvanceDays: 60,
      cancellationWindowHours: 24,
      requireDeposit: false,
      depositPercent: 20,
      autoConfirm: true,
      reminderHoursBefore: [24, 2],
      waitlistEnabled: true,
      notificationChannel: 'sms',
    },
    settings: { defaultLanguage: 'en', currency: 'auto', phoneCountry: 'US' },
    publishedAt: ts,
    onboardingCompletedAt: ts,
    createdAt: ts,
    updatedAt: ts,
  }
}

function demoStaff(businessId: ID): StaffMember[] {
  return [
    { businessId, id: 'stf_1', name: 'Maya Cohen', role: 'Owner · Senior stylist', color: 'indigo', avatarInitials: 'MC', serviceIds: ['svc_1', 'svc_2', 'svc_3', 'svc_4', 'svc_5', 'svc_7'] },
    { businessId, id: 'stf_2', name: 'Jordan Reyes', role: 'Colorist', color: 'teal', avatarInitials: 'JR', serviceIds: ['svc_3', 'svc_4', 'svc_5', 'svc_6'] },
    { businessId, id: 'stf_3', name: 'Priya Shah', role: 'Stylist', color: 'amber', avatarInitials: 'PS', serviceIds: ['svc_1', 'svc_2', 'svc_7', 'svc_8'] },
  ]
}

function demoServices(businessId: ID): Service[] {
  return [
    { businessId, id: 'svc_1', name: "Women's haircut", category: 'Cuts', durationMin: 60, price: 85, bufferMin: 10, active: true, description: 'Consultation, wash, precision cut and blow-dry.' },
    { businessId, id: 'svc_2', name: "Men's haircut", category: 'Cuts', durationMin: 30, price: 45, bufferMin: 5, active: true, description: 'Clipper and scissor cut with a hot-towel finish.' },
    { businessId, id: 'svc_3', name: 'Root touch-up', category: 'Color', durationMin: 90, price: 110, bufferMin: 10, active: true, description: 'Single-process color on regrowth up to 1.5 inches.' },
    { businessId, id: 'svc_4', name: 'Balayage', category: 'Color', durationMin: 180, price: 260, bufferMin: 15, active: true, description: 'Hand-painted highlights with toner and blow-dry.' },
    { businessId, id: 'svc_5', name: 'Gloss & tone', category: 'Color', durationMin: 45, price: 65, bufferMin: 5, active: true, description: 'Refresh shine and correct brassiness.' },
    { businessId, id: 'svc_6', name: 'Color correction', category: 'Color', durationMin: 240, price: 380, bufferMin: 15, active: false, description: 'By consultation only. Deposit required.' },
    { businessId, id: 'svc_7', name: 'Blow-dry & style', category: 'Styling', durationMin: 45, price: 55, bufferMin: 5, active: true, description: 'Wash and a smooth or voluminous finish.' },
    { businessId, id: 'svc_8', name: 'Keratin treatment', category: 'Treatments', durationMin: 150, price: 240, bufferMin: 15, active: true, description: 'Smoothing treatment that lasts up to 12 weeks.' },
  ]
}

const FIRST = ['Emma', 'Olivia', 'Ava', 'Sophia', 'Liam', 'Noah', 'Mia', 'Isabella', 'Lucas', 'Amelia', 'Ethan', 'Harper', 'Chloe', 'Daniel', 'Zoe', 'Grace', 'Leo', 'Nora', 'Aria', 'Samuel', 'Hannah', 'Ella', 'Maya', 'Julian', 'Layla', 'Owen', 'Ruby', 'Isaac', 'Lily', 'Henry', 'Stella', 'Jack', 'Violet', 'Mason', 'Hazel', 'Caleb', 'Aurora', 'Wyatt', 'Nina', 'Adam']
const LAST = ['Johnson', 'Martinez', 'Kim', 'Nguyen', 'Brown', 'Garcia', 'Patel', 'Lee', 'Walker', 'Rossi', 'Cohen', 'Anderson', 'Thompson', 'Silva', 'Clarke', 'Murphy', 'Park', 'Bennett', 'Russo', 'Levi', 'Foster', 'Hayes', 'Ortiz', 'Price', 'Moreno', 'Wright']
const NOTES = [
  'Prefers a quiet appointment — no small talk.',
  'Allergic to PPD. Use ammonia-free color only.',
  'Always books with Maya. Likes Saturday mornings.',
  'Sensitive scalp — lukewarm water.',
  'Referred by Emma Johnson.',
  'Running late is common — text 30 min before.',
]
const CUSTOMER_COUNT = 240

/** Behaviour profile driving the appointment generator (not stored). */
interface CustomerProfile {
  ageDays: number
  lapsedDays: number
}

function demoCustomers(now: Date, businessId: ID) {
  const rng = createRng(7)
  const profiles: CustomerProfile[] = []
  const customers: Customer[] = Array.from({ length: CUSTOMER_COUNT }, (_, i) => {
    const firstName = FIRST[i % FIRST.length]
    const lastName = LAST[(i * 7 + 3) % LAST.length]
    // Most clients are long-standing; ~8% joined in the last month.
    const ageDays = i % 12 === 5 ? rng.int(3, 28) : rng.int(90, 900)
    const lapsedDays = i >= 12 && i % 7 === 3 ? rng.int(70, 110) : 0
    profiles.push({ ageDays, lapsedDays })

    const tags: CustomerTag[] = []
    if (i < 6) tags.push('VIP')
    else if (ageDays < 30) tags.push('New')
    else if (i < 30 && !lapsedDays) tags.push('Regular')
    if (lapsedDays) tags.push('At risk')

    return {
      businessId,
      id: `cus_${i + 1}`,
      firstName,
      lastName,
      email: `${firstName}.${lastName}`.toLowerCase() + '@' + rng.pick(['gmail.com', 'outlook.com', 'icloud.com', 'yahoo.com']),
      phone: `(555) ${rng.int(200, 989)}-${String(rng.int(0, 9999)).padStart(4, '0')}`,
      createdAt: subDays(now, ageDays).toISOString(),
      tags,
      notes: i % 5 === 0 ? NOTES[(i / 5) % NOTES.length] : undefined,
      marketingOptIn: rng.chance(0.7),
    }
  })
  return { customers, profiles }
}

/** A realistic book of appointments from 120 days ago to 21 days ahead of `now`. */
function demoAppointments(now: Date, business: Business, staff: StaffMember[], services: Service[], customers: Customer[], profiles: CustomerProfile[]): Appointment[] {
  const rng = createRng(1234)
  // Built in the business's own time zone, so "9:00" is 9:00 at the salon wherever this runs.
  const zone = businessZone(business)
  const out: Appointment[] = []
  let n = 1

  const pickCustomer = (dayOffset: number) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      // Skewed toward low indexes: a few regulars book far more than everyone else.
      const i = Math.floor(Math.pow(rng.next(), 1.35) * customers.length)
      const p = profiles[i]
      if (-dayOffset > p.ageDays) continue // not a client yet
      if (p.lapsedDays && dayOffset > -p.lapsedDays) continue // churned recently
      return customers[i]
    }
    return customers[0]
  }

  for (let d = -120; d <= 21; d++) {
    const day = addZonedDays(now, d, zone)
    const hours = business.hours[zonedWeekday(day, zone)]
    if (!hours.open) continue
    const close = atWallTime(day, hours.end, zone)
    // Future days are less full than past days — realistic booking curve.
    const fill = d < 0 ? 0.78 : d === 0 ? 0.72 : Math.max(0.2, 0.65 - d * 0.025)

    for (const member of staff) {
      let cursor = atWallTime(day, hours.start, zone)
      const offered = services.filter((s) => s.active && member.serviceIds.includes(s.id))
      while (true) {
        const service = rng.pick(offered)
        const end = addMinutes(cursor, service.durationMin)
        if (!isBefore(end, addMinutes(close, 1))) break
        if (rng.chance(fill)) {
          const past = isBefore(end, now)
          let status: AppointmentStatus
          if (past) {
            const r = rng.next()
            status = r < 0.06 ? 'no_show' : r < 0.12 ? 'cancelled' : 'completed'
          } else {
            const r = rng.next()
            status = r < 0.05 ? 'cancelled' : r < 0.18 ? 'pending' : 'confirmed'
          }
          out.push({
            businessId: business.id,
            id: `apt_${n++}`,
            customerId: pickCustomer(d).id,
            staffId: member.id,
            serviceId: service.id,
            start: cursor.toISOString(),
            end: end.toISOString(),
            status,
            source: rng.pick<BookingSource>(['online', 'online', 'online', 'phone', 'walk_in', 'instagram']),
            price: service.price,
            reminderSent: !past && d <= 1,
          })
          cursor = addMinutes(end, service.bufferMin)
        } else {
          cursor = addMinutes(cursor, 30)
        }
      }
    }
  }

  // A fresh, realistic cancellation for Smart Fill: the first longer upcoming
  // appointment ≥ 3 h away, cancelled by the business 18 minutes ago.
  const target = out.find((a) => {
    const start = new Date(a.start).getTime()
    return a.status === 'confirmed' && start >= now.getTime() + 3 * 3_600_000 && new Date(a.end).getTime() - start >= 3_600_000
  })
  if (target) {
    target.status = 'cancelled'
    target.cancelledAt = new Date(now.getTime() - 18 * 60_000).toISOString()
    target.cancelledBy = 'business'
  }
  return out
}

export function buildDemoDataset(now: Date = new Date(), businessId: ID = DEMO_BUSINESS_ID): Dataset {
  const business = demoBusiness(now, businessId)
  const staff = demoStaff(businessId)
  const services = demoServices(businessId)
  const { customers, profiles } = demoCustomers(now, businessId)
  const appointments = demoAppointments(now, business, staff, services, customers, profiles)
  return { businesses: [business], staff, services, customers, appointments }
}
