import { createHmac, timingSafeEqual } from 'node:crypto'
import type { MessageChannel } from '../../../src/domain/types'
import type { NotificationProvider, OutboundMessage, SendResult } from '../provider'
import { callProvider, type Fetch } from './http'

export interface TwilioConfig {
  accountSid: string
  authToken: string
  /** Messaging Service (recommended: sender pool, opt-out handling) — or a single `smsFrom` number. */
  messagingServiceSid?: string
  smsFrom?: string
  /** WhatsApp-enabled sender in E.164 (enables the WhatsApp channel). */
  whatsappFrom?: string
  /** Public URL Twilio posts delivery statuses to (…/api/webhooks/twilio/status). */
  statusCallbackUrl?: string
  fetch?: Fetch
  timeoutMs?: number
}

/**
 * Twilio Programmable Messaging for SMS and WhatsApp (REST API, no SDK).
 * Recipients must already be E.164 (the engine converts them). Note: business-initiated
 * WhatsApp messages outside a 24-hour conversation window need pre-approved templates —
 * see the README ("WhatsApp").
 */
export class TwilioProvider implements NotificationProvider {
  readonly name = 'twilio'
  readonly channels: readonly MessageChannel[]
  private readonly fetchImpl: Fetch
  private readonly url: string

  constructor(private readonly config: TwilioConfig) {
    if (!config.messagingServiceSid && !config.smsFrom && !config.whatsappFrom) throw new Error('Twilio needs TWILIO_MESSAGING_SERVICE_SID, TWILIO_SMS_FROM or TWILIO_WHATSAPP_FROM')
    const channels: MessageChannel[] = []
    if (config.messagingServiceSid || config.smsFrom) channels.push('sms')
    if (config.whatsappFrom) channels.push('whatsapp')
    this.channels = channels
    this.fetchImpl = config.fetch ?? fetch
    this.url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`
  }

  async send(m: OutboundMessage): Promise<SendResult> {
    const form = new URLSearchParams({ Body: m.body })
    if (m.channel === 'whatsapp') {
      form.set('To', `whatsapp:${m.to}`)
      form.set('From', `whatsapp:${this.config.whatsappFrom}`)
    } else {
      form.set('To', m.to)
      if (this.config.messagingServiceSid) form.set('MessagingServiceSid', this.config.messagingServiceSid)
      else form.set('From', this.config.smsFrom!)
    }
    if (this.config.statusCallbackUrl) form.set('StatusCallback', this.config.statusCallbackUrl)
    return callProvider(
      this.fetchImpl,
      this.url,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
      this.config.timeoutMs ?? 10_000,
      (json) => (typeof json.sid === 'string' ? json.sid : undefined),
    )
  }
}

/**
 * Validates `X-Twilio-Signature`: base64(HMAC-SHA1(authToken, url + sorted(key + value)...)).
 * `url` must be exactly the public URL Twilio called (scheme, host, path and query).
 */
export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature) return false
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('')
  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest('base64')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Twilio MessageStatus → our receipt status (null = intermediate state, ignore). */
export function twilioReceiptStatus(status: string | undefined): 'delivered' | 'failed' | null {
  if (status === 'delivered' || status === 'read') return 'delivered'
  if (status === 'failed' || status === 'undelivered') return 'failed'
  return null
}

/** Carrier-standard opt-out / opt-in keywords (plus common Hebrew ones). */
export const OPT_OUT_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke', 'הסר', 'הסרה', 'עצור', 'די'])
export const OPT_IN_WORDS = new Set(['start', 'unstop', 'yes', 'subscribe', 'הצטרף'])
export const keyword = (body: string) => body.trim().toLowerCase().replace(/[.!\s]+$/g, '')
