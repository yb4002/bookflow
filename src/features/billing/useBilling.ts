import { useCallback, useEffect, useState } from 'react'
import { api } from '@/data/api/client'
import { repo } from '@/data/repositories'

export type PlanId = 'solo' | 'team' | 'business'
export interface BillingState {
  enabled: boolean
  plan: PlanId
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid' | 'comped'
  trialEndsAt?: string
  currentPeriodEnd?: string
  cancelAtPeriodEnd: boolean
  entitled: boolean
  maxStaff: number | null
  purchasable: PlanId[]
  hasPaymentMethod: boolean
}

/** The business's subscription state (refreshes when business data changes). */
export function useBilling() {
  const [state, setState] = useState<BillingState>()
  const load = useCallback(() => api<BillingState>('GET', '/app/billing').then(setState, () => undefined), [])
  useEffect(() => {
    void load()
    return repo.onChange((topics) => topics.includes('business') && void load())
  }, [load])
  return { state, reload: load }
}

/** Whole days left until `iso` (rounded up; 0 when past). */
export const daysUntil = (iso: string | undefined, now = Date.now()) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 86_400_000)) : 0)
