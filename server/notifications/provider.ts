import type { LanguageCode, MessageChannel } from '../../src/domain/types'

/**
 * The provider boundary. Twilio (SMS), WhatsApp Business, SES/Postmark (email)…
 * each implement this — the engine and the business logic never change.
 */
export interface OutboundMessage {
  /** Stable per logical message (the notification id). Providers that support it must de-duplicate on it. */
  idempotencyKey: string
  channel: MessageChannel
  /** E.164-ish phone number or email address. */
  to: string
  subject?: string
  body: string
  locale: LanguageCode
}

export type SendResult =
  | { ok: true; providerMessageId: string }
  /** `retryable`: transient (timeout, rate limit, 5xx) vs permanent (invalid number, blocked). */
  | { ok: false; retryable: boolean; error: string }

export interface DeliveryReceipt {
  providerMessageId: string
  status: 'delivered' | 'failed'
  at: string
  error?: string
}

export interface NotificationProvider {
  readonly name: string
  readonly channels: readonly MessageChannel[]
  send(message: OutboundMessage): Promise<SendResult>
  /** Asynchronous delivery receipts (webhooks in real providers). Optional. */
  onReceipt?(listener: (receipt: DeliveryReceipt) => void): () => void
}

/** Chooses the provider for a channel. One provider may serve several channels. */
export class ProviderRegistry {
  private byChannel = new Map<MessageChannel, NotificationProvider>()
  constructor(readonly providers: NotificationProvider[]) {
    for (const p of providers) for (const ch of p.channels) if (!this.byChannel.has(ch)) this.byChannel.set(ch, p)
  }
  for(channel: MessageChannel): NotificationProvider | undefined {
    return this.byChannel.get(channel)
  }
}
