import { isSameZonedDay, zonedDayDiff, zonedHour, zonedWeekday, type TimeZone } from '@/domain/time'
import type { AppointmentView, CustomerWithStats } from '@/domain/types'

/**
 * Smart Fill matching engine — pure, deterministic, explainable.
 * Every point of score is backed by a structured `MatchReason` that the UI
 * translates, so businesses can see *why* a client was suggested.
 * The same functions can later run server-side unchanged.
 */

export type DayPeriod = 'morning' | 'afternoon' | 'evening'

export type MatchReason =
  | { type: 'service'; serviceName: string; count: number }
  | { type: 'category'; category: string }
  | { type: 'staff'; staffName: string; strong: boolean }
  | { type: 'timeOfDay'; period: DayPeriod }
  | { type: 'weekday'; weekday: number }
  | { type: 'due'; daysSince: number }
  | { type: 'reliable' }
  | { type: 'vip' }
  | { type: 'winBack' }
  | { type: 'noShows'; count: number }

export interface FillCandidate {
  customer: CustomerWithStats
  /** 0–1, for display as "92% match". */
  match: number
  reasons: MatchReason[]
  lastVisit?: string
}

export interface FillOpportunity {
  /** The cancelled appointment whose slot is open. */
  appointment: AppointmentView
  cancelledAt: string
}

export interface RankResult {
  candidates: FillCandidate[]
  /** Clients with relevant history left out (no messaging consent or already booked that day). */
  excludedCount: number
}

/** Morning / afternoon / evening of an instant, on the business's clock. */
export const dayPeriod = (d: Date | string, zone: TimeZone): DayPeriod => {
  const h = zonedHour(d, zone)
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

const ACTIVE = new Set(['confirmed', 'pending'])

/**
 * Every fillable cancellation, most urgent (soonest) first: upcoming, cancelled with a
 * timestamp (customer or business cancellations), and the slot not re-booked for that staff member.
 */
export function findFillOpportunities(appts: AppointmentView[], now = new Date()): FillOpportunity[] {
  const cancelled = appts
    .filter((a) => a.status === 'cancelled' && a.cancelledAt && new Date(a.start) > now)
    .sort((a, b) => a.start.localeCompare(b.start))

  return cancelled
    .filter((a) => {
      const s = new Date(a.start).getTime()
      const e = new Date(a.end).getTime()
      return !appts.some(
        (o) => o.id !== a.id && o.staffId === a.staffId && ACTIVE.has(o.status) && new Date(o.start).getTime() < e && new Date(o.end).getTime() > s,
      )
    })
    .map((a) => ({ appointment: a, cancelledAt: a.cancelledAt! }))
}

/** The single most urgent opportunity (kept for callers that only need one). */
export const findFillOpportunity = (appts: AppointmentView[], now = new Date()) => findFillOpportunities(appts, now)[0] ?? null

/** Ranks clients for an open slot. `history` should cover the last few months plus upcoming bookings. */
export function rankCandidates(
  opportunity: FillOpportunity,
  customers: CustomerWithStats[],
  history: AppointmentView[],
  now = new Date(),
  zone: TimeZone,
  limit = 6,
): RankResult {
  const slot = opportunity.appointment
  const slotStart = new Date(slot.start)
  const slotPeriod = dayPeriod(slotStart, zone)
  const slotWeekday = zonedWeekday(slotStart, zone)
  const byCustomer = new Map<string, AppointmentView[]>()
  for (const a of history) {
    const list = byCustomer.get(a.customerId)
    if (list) list.push(a)
    else byCustomer.set(a.customerId, [a])
  }

  let excludedCount = 0
  const scored: (FillCandidate & { score: number })[] = []

  for (const customer of customers) {
    if (customer.id === slot.customerId) continue
    const appts = byCustomer.get(customer.id) ?? []
    const visits = appts.filter((a) => a.status === 'completed').sort((a, b) => b.start.localeCompare(a.start))
    const sameService = visits.filter((a) => a.serviceId === slot.serviceId)
    const sameCategory = visits.filter((a) => a.service.category === slot.service.category)
    if (!sameCategory.length && !customer.tags.includes('VIP')) continue // no relevant history

    const bookedThatDay = appts.some((a) => ACTIVE.has(a.status) && isSameZonedDay(a.start, slotStart, zone))
    if (!customer.marketingOptIn || customer.messagingOptOut || bookedThatDay) {
      excludedCount++
      continue
    }

    const reasons: MatchReason[] = []
    let score = 0

    if (sameService.length) {
      score += 35 + Math.min(15, (sameService.length - 1) * 5)
      reasons.push({ type: 'service', serviceName: slot.service.name, count: sameService.length })
    } else if (sameCategory.length) {
      score += 18
      reasons.push({ type: 'category', category: slot.service.category })
    }

    const withStaff = visits.filter((a) => a.staffId === slot.staffId).length
    if (withStaff && visits.length) {
      const strong = withStaff / visits.length >= 0.5
      score += strong ? 20 : 8
      reasons.push({ type: 'staff', staffName: slot.staff.name.split(' ')[0], strong })
    }

    if (visits.length >= 2) {
      const inPeriod = visits.filter((a) => dayPeriod(a.start, zone) === slotPeriod).length
      if (inPeriod / visits.length >= 0.5) {
        score += 12
        reasons.push({ type: 'timeOfDay', period: slotPeriod })
      }
      const onWeekday = visits.filter((a) => zonedWeekday(a.start, zone) === slotWeekday).length
      if (onWeekday / visits.length >= 0.4) {
        score += 8
        reasons.push({ type: 'weekday', weekday: slotWeekday })
      }
    }

    const lastRelevant = (sameService[0] ?? sameCategory[0])?.start
    if (lastRelevant) {
      const daysSince = zonedDayDiff(lastRelevant, now, zone)
      const relevant = sameService.length >= 2 ? sameService : sameCategory
      const cadence =
        relevant.length >= 2
          ? zonedDayDiff(relevant[relevant.length - 1].start, relevant[0].start, zone) / (relevant.length - 1)
          : 42
      if (daysSince >= Math.max(14, cadence * 0.8)) {
        score += 18
        reasons.push({ type: 'due', daysSince })
      }
    }

    if (customer.tags.includes('VIP')) {
      score += 10
      reasons.push({ type: 'vip' })
    }
    if (customer.tags.includes('At risk')) {
      score += 6
      reasons.push({ type: 'winBack' })
    }

    if (customer.noShows > 0) {
      score -= 15 * customer.noShows
      reasons.push({ type: 'noShows', count: customer.noShows })
    } else if (visits.length >= 3) {
      score += 8
      reasons.push({ type: 'reliable' })
    }

    if (score < 25) continue
    scored.push({ customer, score, reasons, lastVisit: visits[0]?.start, match: 0 })
  }

  scored.sort((a, b) => b.score - a.score || a.customer.lastName.localeCompare(b.customer.lastName))
  const candidates = scored.slice(0, limit).map(({ score, ...c }) => ({
    ...c,
    match: Math.max(0.4, Math.min(0.98, score / 105)),
    // Positive reasons first; warnings last.
    reasons: [...c.reasons].sort((a, b) => Number(a.type === 'noShows') - Number(b.type === 'noShows')),
  }))
  return { candidates, excludedCount }
}
