/** Plans as advertised on the pricing page. Prices live in the payment provider (Stripe). */
export type PlanId = 'solo' | 'team' | 'business'
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid' | 'comped'

export interface PlanDef {
  id: PlanId
  /** Most team members (staff calendars) a business on this plan can have. */
  maxStaff: number
  /** Self-service checkout (Business is arranged with sales). */
  selfServe: boolean
}

export const PLANS: Record<PlanId, PlanDef> = {
  solo: { id: 'solo', maxStaff: 1, selfServe: true },
  team: { id: 'team', maxStaff: 8, selfServe: true },
  business: { id: 'business', maxStaff: Number.POSITIVE_INFINITY, selfServe: false },
}
export const isPlanId = (v: unknown): v is PlanId => v === 'solo' || v === 'team' || v === 'business'

/** Days a business keeps full service after a payment problem, before online booking pauses. */
export const PAST_DUE_GRACE_DAYS = 7
