import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createBilling } from './billing/service'
import { createStripeClient, formEncode, verifyStripeSignature } from './billing/stripe'
import { DEMO } from './db/seed'
import { addUser, client, PASSWORD, setup, signup } from './testHarness'

const WHSEC = 'whsec_test_secret'
const sign = (body: string, t = Math.floor(Date.now() / 1000), secret = WHSEC) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`

/** A fake Stripe API that records requests. */
function fakeStripe() {
  const calls: { url: string; body: URLSearchParams; headers: Record<string, string> }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: new URLSearchParams(String(init.body ?? '')), headers: init.headers as Record<string, string> })
    if (url.endsWith('/customers')) return Response.json({ id: 'cus_123' })
    if (url.endsWith('/checkout/sessions')) return Response.json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' })
    if (url.endsWith('/billing_portal/sessions')) return Response.json({ url: 'https://billing.stripe.com/p/session_1' })
    return Response.json({ error: { message: 'nope' } }, { status: 400 })
  }) as typeof fetch
  return { calls, client: createStripeClient('sk_test_123', fetchImpl) }
}

function billingSetup() {
  const stripe = fakeStripe()
  let billing!: ReturnType<typeof createBilling>
  const env = setup(({ sql, now }) => {
    // Same database and clock as the app.
    billing = createBilling({ sql, now, stripe: stripe.client, webhookSecret: WHSEC, prices: { solo: 'price_solo', team: 'price_team' }, trialDays: 14, publicBaseUrl: 'https://app.example' })
    return { billing }
  })
  return { ...env, stripe, billing }
}

describe('Stripe helpers', () => {
  it('form-encodes nested parameters like Stripe expects', () => {
    expect(formEncode({ line_items: [{ price: 'p', quantity: 1 }], metadata: { business_id: 'b' }, skip: undefined }).toString()).toBe(
      'line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Bbusiness_id%5D=b',
    )
  })
  it('verifies webhook signatures and rejects tampering and replays', () => {
    const body = '{"id":"evt_1"}'
    expect(verifyStripeSignature(WHSEC, sign(body), body)).toBe(true)
    expect(verifyStripeSignature(WHSEC, sign(body), body.replace('1', '2'))).toBe(false)
    expect(verifyStripeSignature(WHSEC, sign(body, Math.floor(Date.now() / 1000) - 3600), body)).toBe(false)
    expect(verifyStripeSignature(WHSEC, sign(body, undefined, 'whsec_other'), body)).toBe(false)
    expect(verifyStripeSignature(WHSEC, undefined, body)).toBe(false)
  })
})

describe('subscriptions', () => {
  it('without billing configured every business has full access', async () => {
    const { app } = setup()
    const owner = client(app)
    await signup(owner)
    expect((await owner.get('/api/app/billing')).json).toMatchObject({ enabled: false, entitled: true })
    expect((await owner.post('/api/app/billing/checkout', { plan: 'team' })).status).toBe(404)
  })

  it('a new business gets a 14-day trial; afterwards online booking pauses until it subscribes', async () => {
    const { app, advance, stripe, now } = billingSetup()
    const owner = client(app)
    await signup(owner)
    const trial = (await owner.get('/api/app/billing')).json
    expect(trial).toMatchObject({ enabled: true, plan: 'team', status: 'trialing', entitled: true, maxStaff: 8, purchasable: ['solo', 'team'] })
    expect(Date.parse(trial.trialEndsAt) - now().getTime()).toBe(14 * 86_400_000)

    // Make the business bookable
    const svc = (await owner.post('/api/app/services', { name: 'Cut', category: 'Cuts', description: '', durationMin: 30, bufferMin: 0, price: 40, active: true })).json
    await owner.post('/api/app/staff', { name: 'Dana Levi', role: 'Owner', color: 'indigo', serviceIds: [svc.id] })
    await owner.post('/api/app/business/publish', { published: true })
    const slug = (await owner.get('/api/app/business')).json.slug

    // Checkout carries the remaining trial over
    const checkout = await owner.post('/api/app/billing/checkout', { plan: 'team', locale: 'en' })
    expect(checkout.json.url).toBe('https://checkout.stripe.com/c/pay/cs_1')
    const session = stripe.calls.find((c) => c.url.endsWith('/checkout/sessions'))!
    expect(session.body.get('line_items[0][price]')).toBe('price_team')
    expect(session.body.get('customer')).toBe('cus_123')
    expect(session.body.get('mode')).toBe('subscription')
    expect(Number(session.body.get('subscription_data[trial_end]'))).toBe(Math.floor(Date.parse(trial.trialEndsAt) / 1000))
    expect(stripe.calls[0].headers.authorization).toBe('Bearer sk_test_123')
    expect(stripe.calls[0].headers['idempotency-key']).toMatch(/^customer-biz_/)
    expect((await owner.post('/api/app/billing/checkout', { plan: 'business' })).json.error.code).toBe('invalid_plan')

    // Trial runs out without subscribing
    advance(15 * 86_400_000)
    expect((await owner.get('/api/app/billing')).json.entitled).toBe(false)
    const anon = client(app)
    expect((await anon.get(`/api/public/${slug}`)).json.bookingPaused).toBe(true)
    const day = (await anon.get(`/api/public/${slug}/availability?serviceId=${svc.id}&days=14`)).json as { slots: { start: string; available: boolean }[] }[]
    const slot = day.flatMap((d) => d.slots).find((s) => s.available)!
    const paused = await anon.post(`/api/public/${slug}/bookings`, { serviceId: svc.id, start: slot.start, name: 'Client One', phone: '(555) 123-4567', remindersOptIn: true })
    expect(paused.json.error.code).toBe('booking_paused')
    // The dashboard keeps working
    expect((await owner.get('/api/app/appointments')).status).toBe(200)
  })

  it('applies signed Stripe webhooks once, and enforces the plan', async () => {
    const { app, billing, now } = billingSetup()
    // Signed with the app's clock (the webhook rejects stale timestamps).
    const at = () => Math.floor(now().getTime() / 1000)
    const owner = client(app)
    const created = await signup(owner)
    const businessId = created.json.business.id
    const event = (id: string, type: string, object: Record<string, unknown>) => JSON.stringify({ id, type, data: { object } })

    const completed = event('evt_1', 'checkout.session.completed', { client_reference_id: businessId, customer: 'cus_123', subscription: 'sub_1' })
    expect((await app.request('/api/webhooks/stripe', { method: 'POST', body: completed, headers: { 'stripe-signature': sign(completed, at()) } })).status).toBe(200)
    const periodEnd = at() + 30 * 86400
    const active = event('evt_2', 'customer.subscription.updated', { id: 'sub_1', customer: 'cus_123', status: 'active', current_period_end: periodEnd, cancel_at_period_end: false, items: { data: [{ price: { id: 'price_solo' } }] }, metadata: { business_id: businessId } })
    const res = await app.request('/api/webhooks/stripe', { method: 'POST', body: active, headers: { 'stripe-signature': sign(active, at()) } })
    expect(await res.json()).toEqual({ received: true, result: 'applied' })
    expect(billing.state(businessId)).toMatchObject({ plan: 'solo', status: 'active', entitled: true, maxStaff: 1, hasPaymentMethod: true, currentPeriodEnd: new Date(periodEnd * 1000).toISOString() })
    // Replays and forgeries change nothing
    expect(await (await app.request('/api/webhooks/stripe', { method: 'POST', body: active, headers: { 'stripe-signature': sign(active, at()) } })).json()).toEqual({ received: true, result: 'duplicate' })
    const forged = event('evt_3', 'customer.subscription.deleted', { id: 'sub_1', customer: 'cus_123', status: 'canceled', metadata: { business_id: businessId } })
    expect((await app.request('/api/webhooks/stripe', { method: 'POST', body: forged, headers: { 'stripe-signature': sign(forged, at(), 'whsec_wrong') } })).status).toBe(403)
    expect(billing.state(businessId).status).toBe('active')

    // Solo = one team member
    const svc = (await owner.post('/api/app/services', { name: 'Cut', category: '', description: '', durationMin: 30, bufferMin: 0, price: 40, active: true })).json
    expect((await owner.post('/api/app/staff', { name: 'Dana Levi', role: '', color: 'indigo', serviceIds: [svc.id] })).status).toBe(201)
    expect((await owner.post('/api/app/staff', { name: 'Second Person', role: '', color: 'teal', serviceIds: [svc.id] })).json.error.code).toBe('plan_limit')

    // Billing portal for the owner only
    expect((await owner.post('/api/app/billing/portal')).json.url).toBe('https://billing.stripe.com/p/session_1')

    // Cancellation (signed) pauses online booking
    const deleted = event('evt_4', 'customer.subscription.deleted', { id: 'sub_1', customer: 'cus_123', status: 'canceled', items: { data: [{ price: { id: 'price_solo' } }] } })
    await app.request('/api/webhooks/stripe', { method: 'POST', body: deleted, headers: { 'stripe-signature': sign(deleted, at()) } })
    expect(billing.state(businessId)).toMatchObject({ status: 'canceled', entitled: false })
  })

  it('only owners manage billing; seeded/older businesses are complimentary', async () => {
    const { app, sql } = billingSetup()
    addUser(sql, { email: 'staff@lunahair.studio', name: 'Staff User', businessId: DEMO.luna.businessId, role: 'staff' })
    const staff = client(app)
    await staff.post('/api/auth/login', { email: 'staff@lunahair.studio', password: PASSWORD })
    expect((await staff.get('/api/app/billing')).json).toMatchObject({ status: 'comped', entitled: true })
    expect((await staff.post('/api/app/billing/checkout', { plan: 'team' })).status).toBe(403)
    expect((await staff.post('/api/app/billing/portal')).status).toBe(403)
  })
})
