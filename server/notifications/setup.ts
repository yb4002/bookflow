import type { MessageChannel } from '../../src/domain/types'
import { ProviderRegistry, type NotificationProvider } from './provider'
import { DevProvider } from './providers/devProvider'
import { ResendProvider } from './providers/resend'
import { TwilioProvider } from './providers/twilio'

export type ChannelStatus = 'live' | 'simulated' | 'off'
export type MessagingStatus = Record<MessageChannel, ChannelStatus>

export interface MessagingConfig {
  twilio?: { accountSid?: string; authToken?: string; messagingServiceSid?: string; smsFrom?: string; whatsappFrom?: string; statusCallbackUrl?: string }
  resend?: { apiKey?: string; from?: string; replyTo?: string }
  /** Channels without a real provider are simulated (dev/demo) instead of failing. */
  simulateMissing: boolean
  log?: boolean
}

/**
 * Builds the provider registry from configuration. Real providers come first; a simulated
 * (development) provider only fills channels that have none, and only when allowed — in
 * production an unconfigured channel fails visibly instead of pretending to send.
 */
export function createProviders(cfg: MessagingConfig): { registry: ProviderRegistry; status: MessagingStatus } {
  const real: NotificationProvider[] = []
  const t = cfg.twilio
  if (t?.accountSid && t.authToken && (t.messagingServiceSid || t.smsFrom || t.whatsappFrom)) {
    real.push(new TwilioProvider({ accountSid: t.accountSid, authToken: t.authToken, messagingServiceSid: t.messagingServiceSid, smsFrom: t.smsFrom, whatsappFrom: t.whatsappFrom, statusCallbackUrl: t.statusCallbackUrl }))
  }
  const r = cfg.resend
  if (r?.apiKey && r.from) real.push(new ResendProvider({ apiKey: r.apiKey, from: r.from, replyTo: r.replyTo }))

  const status = {} as MessagingStatus
  for (const ch of ['sms', 'whatsapp', 'email'] as const) status[ch] = real.some((p) => p.channels.includes(ch)) ? 'live' : cfg.simulateMissing ? 'simulated' : 'off'
  const providers = cfg.simulateMissing ? [...real, new DevProvider({ log: cfg.log })] : real
  return { registry: new ProviderRegistry(providers), status }
}
