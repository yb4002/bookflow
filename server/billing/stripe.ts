import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Minimal Stripe REST client (no SDK): form-encoded requests with nested keys, idempotency
 * keys on every write, typed errors. Only what BookFlow uses: customers, Checkout, Billing Portal.
 */
export class StripeError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'StripeError'
  }
}

/** { a: { b: [1, 2] } } → a[b][0]=1&a[b][1]=2 */
export function formEncode(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' && item !== null ? formEncode(item as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))))
    else if (typeof v === 'object') formEncode(v as Record<string, unknown>, key, out)
    else out.append(key, String(v))
  }
  return out
}

export function createStripeClient(secretKey: string, fetchImpl: typeof fetch = fetch) {
  const call = async <T,>(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> => {
    const body = formEncode(params).toString()
    const res = await fetchImpl(`https://api.stripe.com/v1${path}${method === 'GET' && body ? `?${body}` : ''}`, {
      method,
      headers: {
        authorization: `Bearer ${secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        'stripe-version': '2024-06-20',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: method === 'POST' ? body : undefined,
    })
    const json = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string; type?: string } }
    if (!res.ok) throw new StripeError(res.status, json.error?.code ?? json.error?.type ?? 'stripe_error', json.error?.message ?? `Stripe ${res.status}`)
    return json
  }
  return {
    createCustomer: (p: { email: string; name: string; businessId: string }) =>
      call<{ id: string }>('POST', '/customers', { email: p.email, name: p.name, metadata: { business_id: p.businessId } }, `customer-${p.businessId}`),
    createCheckoutSession: (p: { customerId: string; priceId: string; businessId: string; successUrl: string; cancelUrl: string; trialEnd?: number; locale?: string }) =>
      call<{ id: string; url: string }>('POST', '/checkout/sessions', {
        mode: 'subscription',
        customer: p.customerId,
        client_reference_id: p.businessId,
        line_items: [{ price: p.priceId, quantity: 1 }],
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
        allow_promotion_codes: true,
        locale: p.locale === 'he' ? 'auto' : p.locale,
        subscription_data: { metadata: { business_id: p.businessId }, ...(p.trialEnd ? { trial_end: p.trialEnd } : {}) },
      }),
    createPortalSession: (p: { customerId: string; returnUrl: string }) => call<{ url: string }>('POST', '/billing_portal/sessions', { customer: p.customerId, return_url: p.returnUrl }),
  }
}
export type StripeClient = ReturnType<typeof createStripeClient>

/**
 * Verifies `Stripe-Signature: t=…,v1=…[,v1=…]`: HMAC-SHA256 of `${t}.${rawBody}` with the
 * endpoint secret; rejects timestamps older than `toleranceSec` (replay protection).
 */
export function verifyStripeSignature(secret: string, header: string | undefined, rawBody: string, nowMs = Date.now(), toleranceSec = 300): boolean {
  if (!header) return false
  const parts = header.split(',').map((p) => p.split('=') as [string, string])
  const t = Number(parts.find(([k]) => k === 't')?.[1])
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > toleranceSec) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'))
  return parts.some(([k, v]) => {
    if (k !== 'v1' || !v) return false
    const given = Buffer.from(v)
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}
