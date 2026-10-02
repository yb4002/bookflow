import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NotificationProvider, OutboundMessage, SendResult } from '../provider'
import { callProvider, type Fetch } from './http'

export interface ResendConfig {
  apiKey: string
  /** Verified sender, e.g. "BookFlow <bookings@mail.yourdomain.com>". */
  from: string
  replyTo?: string
  fetch?: Fetch
  timeoutMs?: number
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
/** Plain, accessible HTML version of a text message (links clickable, RTL for Hebrew). */
export function emailHtml(body: string, locale: string): string {
  const dir = locale === 'he' ? 'rtl' : 'ltr'
  const linked = escapeHtml(body).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
  return `<!doctype html><html lang="${locale}" dir="${dir}"><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f172a"><p>${linked.replace(/\n/g, '<br>')}</p></body></html>`
}

/** Resend transactional email (HTTPS API). Uses the notification id as the Idempotency-Key. */
export class ResendProvider implements NotificationProvider {
  readonly name = 'resend'
  readonly channels = ['email'] as const
  private readonly fetchImpl: Fetch
  constructor(private readonly config: ResendConfig) {
    this.fetchImpl = config.fetch ?? fetch
  }

  async send(m: OutboundMessage): Promise<SendResult> {
    return callProvider(
      this.fetchImpl,
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json', 'idempotency-key': m.idempotencyKey.slice(0, 256) },
        body: JSON.stringify({
          from: this.config.from,
          to: [m.to],
          subject: m.subject ?? 'BookFlow',
          text: m.body,
          html: emailHtml(m.body, m.locale),
          ...(this.config.replyTo ? { reply_to: this.config.replyTo } : {}),
        }),
      },
      this.config.timeoutMs ?? 10_000,
      (json) => (typeof json.id === 'string' ? json.id : undefined),
    )
  }
}

/**
 * Verifies a Resend (Svix) webhook: HMAC-SHA256 over `${id}.${timestamp}.${body}` with the
 * base64 secret after "whsec_"; the header may carry several "v1,<sig>" values. Rejects
 * timestamps more than 5 minutes off (replay protection).
 */
export function verifyResendSignature(secret: string, headers: { id?: string; timestamp?: string; signature?: string }, body: string, now = Date.now()): boolean {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = Buffer.from(createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64'))
  return signature.split(' ').some((part) => {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) return false
    const given = Buffer.from(sig)
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

/** Resend event type → our receipt status (null = ignore). Complaints are handled as opt-outs. */
export function resendReceiptStatus(type: string | undefined): 'delivered' | 'failed' | null {
  if (type === 'email.delivered') return 'delivered'
  if (type === 'email.bounced' || type === 'email.failed') return 'failed'
  return null
}
