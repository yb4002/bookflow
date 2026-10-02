import type { AvailabilityOffer, ID, MessageChannel, OfferRecipient } from '@/domain/types'
import { repo } from '@/data/repositories'
import { getActiveBusinessId } from '@/data/session'

/**
 * Smart Fill (client side): records an availability offer. Sending happens on the
 * server — the notification engine delivers each message through the configured
 * provider and owns the delivery statuses. This module relays status changes
 * (pushed by the server's live-update stream) to the UI.
 */

export interface OfferDraft {
  appointmentId: ID
  channel: MessageChannel
  recipients: { customerId: ID; address: string; message: string }[]
}

type Listener = (offer: AvailabilityOffer) => void
const listeners = new Set<Listener>()
/** Appointments with offers sent from this tab — refreshed when the server reports progress. */
const watched = new Set<ID>()
let unsubscribe: (() => void) | null = null

const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

async function refresh(appointmentId: ID) {
  for (const offer of await repo.listAvailabilityOffers(appointmentId)) listeners.forEach((l) => l(offer))
}

function watch(appointmentId: ID) {
  watched.add(appointmentId)
  unsubscribe ??= repo.onChange((topics) => {
    if (topics.includes('offers')) watched.forEach((id) => void refresh(id))
  })
}

export async function sendAvailabilityOffer(draft: OfferDraft): Promise<AvailabilityOffer> {
  const now = new Date().toISOString()
  const offer: AvailabilityOffer = {
    businessId: getActiveBusinessId(), // the server uses the signed-in business regardless
    id: uid('ofr'),
    appointmentId: draft.appointmentId,
    channel: draft.channel,
    createdAt: now,
    recipients: draft.recipients.map<OfferRecipient>((r) => ({ ...r, status: 'queued', updatedAt: now })),
  }
  watch(draft.appointmentId)
  await repo.saveAvailabilityOffer(offer)
  await refresh(draft.appointmentId)
  return offer
}

/** Subscribe to offer changes (new offers and delivery updates). */
export function onOfferChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
