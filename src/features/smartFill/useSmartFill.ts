import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDays, subDays } from 'date-fns'
import { businessZone } from '@/domain/time'
import type { AvailabilityOffer, DeliveryStatus, ID, MessageChannel } from '@/domain/types'
import { repo } from '@/data/repositories'
import { useQuery } from '@/hooks/useQuery'
import { useI18n } from '@/i18n'
import { onOfferChange, sendAvailabilityOffer } from '@/services/availabilityOffers'
import { findFillOpportunities, rankCandidates } from './matching'
import { addressFor, renderAvailabilityMessage } from './message'

const DEFAULT_SELECTION = 3

/**
 * All Smart Fill state for the dashboard card: open cancelled slots, the one being
 * worked on, its ranked clients, selection and sent offers.
 */
export function useSmartFill() {
  const { t, f } = useI18n()
  const { data, loading } = useQuery(async () => {
    const now = new Date()
    const [business, customers, history] = await Promise.all([
      repo.getBusiness(),
      repo.listCustomers(),
      repo.listAppointments({ from: subDays(now, 150), to: addDays(now, 21) }),
    ])
    return { business, customers, history, opportunities: findFillOpportunities(history, now), now }
  }, [], { refreshOn: ['appointments', 'customers'] })

  const opportunities = useMemo(() => data?.opportunities ?? [], [data])
  const [activeId, setActiveId] = useState<ID>()
  const opportunity = opportunities.find((o) => o.appointment.id === activeId) ?? opportunities[0] ?? null
  const slotId = opportunity?.appointment.id

  const ranking = useMemo(
    () => (data && opportunity ? rankCandidates(opportunity, data.customers, data.history, data.now, businessZone(data.business)) : null),
    [data, opportunity],
  )
  const candidates = useMemo(() => ranking?.candidates ?? [], [ranking])

  // Offers already sent for the active slot.
  const [offers, setOffers] = useState<AvailabilityOffer[]>([])
  const [offersFor, setOffersFor] = useState<ID>()
  useEffect(() => {
    if (!slotId) return
    let cancelled = false
    repo.listAvailabilityOffers(slotId).then((o) => {
      if (cancelled) return
      setOffers(o)
      setOffersFor(slotId)
    })
    return () => {
      cancelled = true
    }
  }, [slotId])

  // Live delivery updates from the offer service.
  useEffect(
    () =>
      onOfferChange((offer) => {
        if (offer.appointmentId !== slotId) return
        setOffers((prev) => (prev.some((o) => o.id === offer.id) ? prev.map((o) => (o.id === offer.id ? offer : o)) : [...prev, offer]))
      }),
    [slotId],
  )

  /** Latest delivery status per contacted client (for the active slot). */
  const contacted = useMemo(() => {
    const m = new Map<ID, DeliveryStatus>()
    if (offersFor === slotId) for (const o of offers) for (const r of o.recipients) m.set(r.customerId, r.status)
    return m
  }, [offers, offersFor, slotId])

  // Pre-select the strongest matches not yet contacted — once per slot, after its offers load.
  const [selected, setSelected] = useState<Set<ID>>(new Set())
  const [preselectedFor, setPreselectedFor] = useState<ID>()
  useEffect(() => {
    if (!slotId || offersFor !== slotId || preselectedFor === slotId) return
    setSelected(new Set(candidates.filter((c) => !contacted.has(c.customer.id)).slice(0, DEFAULT_SELECTION).map((c) => c.customer.id)))
    setPreselectedFor(slotId)
  }, [slotId, offersFor, preselectedFor, candidates, contacted])

  const toggle = useCallback((id: ID) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const clear = useCallback(() => setSelected(new Set()), [])

  const selectedCandidates = candidates.filter((c) => selected.has(c.customer.id) && !contacted.has(c.customer.id))

  const previewMessage = useCallback(
    (customerIndex = 0) => {
      const c = selectedCandidates[customerIndex] ?? candidates[0]
      return data?.business && opportunity && c ? renderAvailabilityMessage(t, f, data.business, opportunity, c.customer, true) : ''
    },
    [selectedCandidates, candidates, data?.business, opportunity, t, f],
  )

  const [sending, setSending] = useState(false)
  const send = useCallback(
    async (channel: MessageChannel) => {
      if (!opportunity || !data?.business || !selectedCandidates.length) return null
      setSending(true)
      try {
        // Contacted clients drop out of `selectedCandidates` automatically.
        return await sendAvailabilityOffer({
          appointmentId: opportunity.appointment.id,
          channel,
          // Clients without an address on this channel (e.g. no email) are skipped.
          recipients: selectedCandidates
            .filter((c) => !!addressFor(c.customer, channel))
            .map((c) => ({
              customerId: c.customer.id,
              address: addressFor(c.customer, channel),
              message: renderAvailabilityMessage(t, f, data.business, opportunity, c.customer),
            })),
        })
      } finally {
        setSending(false)
      }
    },
    [opportunity, data?.business, selectedCandidates, t, f],
  )

  return {
    loading: loading && !data,
    business: data?.business,
    opportunities,
    opportunity,
    selectOpportunity: setActiveId,
    candidates,
    excludedCount: ranking?.excludedCount ?? 0,
    offers,
    contacted,
    selected,
    selectedCandidates,
    toggle,
    clear,
    previewMessage,
    send,
    sending,
  }
}
