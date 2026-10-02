import type { Sql } from '../db/sqlite'
import { isPlanId, PAST_DUE_GRACE_DAYS, PLANS, type PlanId, type SubscriptionStatus } from './plans'
import { StripeError, verifyStripeSignature, type StripeClient } from './stripe'

export interface BillingOptions {
  sql: Sql
  now: () => Date
  /** Absent = billing not configured: every business has full access (pilot mode). */
  stripe?: StripeClient
  webhookSecret?: string
  prices: Partial<Record<PlanId, string>>
  trialDays: number
  publicBaseUrl: string
}

export interface BillingState {
  /** Billing is configured on this server (Stripe). */
  enabled: boolean
  plan: PlanId
  status: SubscriptionStatus
  trialEndsAt?: string
  currentPeriodEnd?: string
  cancelAtPeriodEnd: boolean
  /** May the business take online bookings? */
  entitled: boolean
  maxStaff: number | null
  /** Plans the owner can buy here. */
  purchasable: PlanId[]
  hasPaymentMethod: boolean
}

interface Row {
  business_id: string
  plan: PlanId
  status: SubscriptionStatus
  trial_ends_at: string | null
  current_period_end: string | null
  cancel_at_period_end: number
  provider_customer_id: string | null
  provider_subscription_id: string | null
  updated_at: string
}

export class BillingError extends Error {
  constructor(public code: 'billing_disabled' | 'invalid_plan' | 'no_customer' | 'provider_error' | 'invalid_signature') {
    super(code)
    this.name = 'BillingError'
  }
}

const STRIPE_STATUS: Record<string, SubscriptionStatus> = {
  trialing: 'trialing', active: 'active', past_due: 'past_due', canceled: 'canceled', incomplete: 'incomplete',
  incomplete_expired: 'canceled', unpaid: 'unpaid', paused: 'unpaid',
}

/**
 * Subscriptions. The payment provider is the source of truth; its webhooks update the mirror in
 * `subscriptions`. Rules here only decide what a business may use:
 * - comped/active: everything; trialing: until the trial ends;
 * - past_due: a grace period, then online booking pauses; canceled/unpaid/incomplete: paused.
 * Dashboard access and existing bookings are never taken hostage — only new online bookings
 * pause, and adding team members beyond the plan is refused.
 */
export function createBilling(opts: BillingOptions) {
  const { sql, now } = opts
  const enabled = !!opts.stripe
  const row = (businessId: string) => sql.get<Row>('SELECT * FROM subscriptions WHERE business_id = ?', [businessId])
  const priceToPlan = (priceId: string | undefined) => (Object.entries(opts.prices).find(([, p]) => p && p === priceId)?.[0] as PlanId | undefined)
  const iso = (sec: unknown) => (typeof sec === 'number' ? new Date(sec * 1000).toISOString() : null)

  /** A new business starts a free trial (no card needed). */
  const startTrial = (businessId: string, plan: PlanId = 'team') => {
    const t = now()
    sql.run(
      `INSERT INTO subscriptions (business_id, plan, status, trial_ends_at, updated_at) VALUES (?, ?, 'trialing', ?, ?)
       ON CONFLICT (business_id) DO NOTHING`,
      [businessId, plan, new Date(t.getTime() + opts.trialDays * 86_400_000).toISOString(), t.toISOString()],
    )
  }

  const entitledRow = (r: Row | undefined) => {
    if (!enabled || !r) return true
    const t = now().toISOString()
    switch (r.status) {
      case 'comped':
      case 'active':
        return true
      case 'trialing':
        return (r.trial_ends_at ?? r.current_period_end ?? '') > t || (!!r.provider_subscription_id && (r.current_period_end ?? '') > t)
      case 'past_due':
        return new Date(Date.parse(r.updated_at) + PAST_DUE_GRACE_DAYS * 86_400_000).toISOString() > t
      default:
        return false
    }
  }

  const state = (businessId: string): BillingState => {
    const r = row(businessId)
    const plan = r?.plan ?? 'business'
    return {
      enabled,
      plan,
      status: r?.status ?? 'comped',
      trialEndsAt: r?.trial_ends_at ?? undefined,
      currentPeriodEnd: r?.current_period_end ?? undefined,
      cancelAtPeriodEnd: !!r?.cancel_at_period_end,
      entitled: entitledRow(r),
      maxStaff: enabled && Number.isFinite(PLANS[plan].maxStaff) ? PLANS[plan].maxStaff : null,
      purchasable: enabled ? (['solo', 'team'] as PlanId[]).filter((p) => !!opts.prices[p]) : [],
      hasPaymentMethod: !!r?.provider_subscription_id,
    }
  }

  /** Applies a verified provider event (idempotent per event id). */
  const applyEvent = (event: { id: string; type: string; data: { object: Record<string, unknown> } }) => {
    const seen = sql.get('SELECT 1 FROM billing_events WHERE id = ?', [event.id])
    if (seen) return 'duplicate'
    const o = event.data.object
    sql.transaction(() => {
      sql.run('INSERT INTO billing_events (id, type, received_at) VALUES (?, ?, ?)', [event.id, event.type, now().toISOString()])
      if (event.type === 'checkout.session.completed') {
        const businessId = o.client_reference_id as string | undefined
        if (businessId && row(businessId)) {
          sql.run('UPDATE subscriptions SET provider_customer_id = COALESCE(?, provider_customer_id), provider_subscription_id = COALESCE(?, provider_subscription_id), updated_at = ? WHERE business_id = ?', [
            (o.customer as string) ?? null, (o.subscription as string) ?? null, now().toISOString(), businessId,
          ])
        }
      }
      if (event.type.startsWith('customer.subscription.')) {
        const metaBiz = (o.metadata as Record<string, string> | undefined)?.business_id
        const r = (metaBiz && row(metaBiz)) || sql.get<Row>('SELECT * FROM subscriptions WHERE provider_customer_id = ?', [o.customer as string])
        if (!r) return
        const item = ((o.items as { data?: { price?: { id?: string }; current_period_end?: number }[] } | undefined)?.data ?? [])[0]
        const plan = priceToPlan(item?.price?.id) ?? r.plan
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : (STRIPE_STATUS[o.status as string] ?? r.status)
        sql.run(
          `UPDATE subscriptions SET plan = ?, status = ?, provider_customer_id = COALESCE(?, provider_customer_id), provider_subscription_id = ?,
             current_period_end = ?, trial_ends_at = COALESCE(?, trial_ends_at), cancel_at_period_end = ?, updated_at = ? WHERE business_id = ?`,
          [
            plan, status, (o.customer as string) ?? null, o.id as string,
            iso(o.current_period_end ?? item?.current_period_end), iso(o.trial_end), o.cancel_at_period_end ? 1 : 0, now().toISOString(), r.business_id,
          ],
        )
      }
    })
    return 'applied'
  }

  return {
    enabled,
    startTrial,
    state,
    isEntitled: (businessId: string) => entitledRow(row(businessId)),
    staffLimit: (businessId: string) => (enabled ? PLANS[row(businessId)?.plan ?? 'business'].maxStaff : Number.POSITIVE_INFINITY),

    /** Stripe Checkout for a plan; any remaining free trial carries over. */
    async checkout(businessId: string, plan: unknown, owner: { email: string; name: string }, locale: string): Promise<string> {
      if (!opts.stripe) throw new BillingError('billing_disabled')
      if (!isPlanId(plan) || !PLANS[plan].selfServe || !opts.prices[plan]) throw new BillingError('invalid_plan')
      const r = row(businessId)
      let customerId = r?.provider_customer_id
      try {
        if (!customerId) {
          const biz = sql.get<{ name: string }>('SELECT name FROM businesses WHERE id = ?', [businessId])!
          customerId = (await opts.stripe.createCustomer({ email: owner.email, name: biz.name, businessId })).id
          sql.run('UPDATE subscriptions SET provider_customer_id = ?, updated_at = ? WHERE business_id = ?', [customerId, now().toISOString(), businessId])
        }
        const trialEndMs = r?.status === 'trialing' && r.trial_ends_at ? Date.parse(r.trial_ends_at) : 0
        const session = await opts.stripe.createCheckoutSession({
          customerId,
          priceId: opts.prices[plan]!,
          businessId,
          successUrl: `${opts.publicBaseUrl}/app/services?tab=billing&checkout=success`,
          cancelUrl: `${opts.publicBaseUrl}/app/services?tab=billing&checkout=cancelled`,
          // Stripe requires a trial end at least 48 hours out.
          trialEnd: trialEndMs > now().getTime() + 49 * 3_600_000 ? Math.floor(trialEndMs / 1000) : undefined,
          locale,
        })
        return session.url
      } catch (e) {
        if (e instanceof StripeError) throw new BillingError('provider_error')
        throw e
      }
    },

    /** Stripe Billing Portal: card, invoices, plan changes, cancellation. */
    async portal(businessId: string): Promise<string> {
      if (!opts.stripe) throw new BillingError('billing_disabled')
      const customerId = row(businessId)?.provider_customer_id
      if (!customerId) throw new BillingError('no_customer')
      try {
        return (await opts.stripe.createPortalSession({ customerId, returnUrl: `${opts.publicBaseUrl}/app/services?tab=billing` })).url
      } catch (e) {
        if (e instanceof StripeError) throw new BillingError('provider_error')
        throw e
      }
    },

    /** Verifies and applies a webhook delivery. */
    handleWebhook(rawBody: string, signature: string | undefined) {
      if (!opts.webhookSecret || !verifyStripeSignature(opts.webhookSecret, signature, rawBody, now().getTime())) throw new BillingError('invalid_signature')
      return applyEvent(JSON.parse(rawBody))
    },
  }
}
export type Billing = ReturnType<typeof createBilling>
