import type { MessageChannel } from '../../../src/domain/types'
import type { DeliveryReceipt, NotificationProvider, OutboundMessage, SendResult } from '../provider'

export interface DevOutboxEntry extends OutboundMessage {
  providerMessageId: string
  acceptedAt: string
}

export interface DevProviderOptions {
  /** Simulated delivery-receipt delay; `null` = no automatic receipts (call deliverAll() in tests). */
  deliveryDelayMs?: number | null
  /** Print each message to the console (development). */
  log?: boolean
  now?: () => Date
}

/**
 * Development / mock provider for every channel. Nothing leaves the machine:
 * messages are kept in an in-memory outbox that tests and the dev API can inspect.
 * Behaves like a real provider: honours idempotency keys, emits delivery receipts,
 * and can simulate failures:
 *   - recipients containing "invalid" (or phone numbers starting +999) → permanent failure
 *   - failNext(n) → the next n sends fail transiently (timeouts, rate limits)
 */
export class DevProvider implements NotificationProvider {
  readonly name = 'dev'
  readonly channels: readonly MessageChannel[] = ['sms', 'whatsapp', 'email']
  readonly outbox: DevOutboxEntry[] = []
  private byKey = new Map<string, DevOutboxEntry>()
  private receiptListeners = new Set<(r: DeliveryReceipt) => void>()
  private pendingReceipts: string[] = []
  private transientFailures = 0
  private seq = 0

  constructor(private readonly options: DevProviderOptions = {}) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const existing = this.byKey.get(message.idempotencyKey)
    if (existing) return { ok: true, providerMessageId: existing.providerMessageId } // idempotent retry
    if (this.transientFailures > 0) {
      this.transientFailures--
      return { ok: false, retryable: true, error: 'dev: simulated timeout' }
    }
    if (/invalid/i.test(message.to) || message.to.replace(/[^\d+]/g, '').startsWith('+999')) {
      return { ok: false, retryable: false, error: 'dev: invalid recipient' }
    }
    const entry: DevOutboxEntry = { ...message, providerMessageId: `dev_${++this.seq}`, acceptedAt: (this.options.now?.() ?? new Date()).toISOString() }
    this.outbox.push(entry)
    this.byKey.set(message.idempotencyKey, entry)
    if (this.options.log) console.log(`[notify:dev] ${message.channel} → ${message.to} (${message.locale}): ${message.body.replace(/\s+/g, ' ').slice(0, 120)}`)

    const delay = this.options.deliveryDelayMs === undefined ? 1500 : this.options.deliveryDelayMs
    if (delay === null) this.pendingReceipts.push(entry.providerMessageId)
    else setTimeout(() => this.emitReceipt(entry.providerMessageId), delay)
    return { ok: true, providerMessageId: entry.providerMessageId }
  }

  onReceipt(listener: (r: DeliveryReceipt) => void) {
    this.receiptListeners.add(listener)
    return () => {
      this.receiptListeners.delete(listener)
    }
  }

  /* ---- test helpers ---- */
  failNext(count: number) {
    this.transientFailures = count
  }
  deliverAll() {
    const ids = this.pendingReceipts.splice(0)
    ids.forEach((id) => this.emitReceipt(id))
  }
  clear() {
    this.outbox.length = 0
    this.byKey.clear()
    this.pendingReceipts.length = 0
    this.transientFailures = 0
  }

  private emitReceipt(providerMessageId: string) {
    const receipt: DeliveryReceipt = { providerMessageId, status: 'delivered', at: (this.options.now?.() ?? new Date()).toISOString() }
    this.receiptListeners.forEach((l) => l(receipt))
  }
}
