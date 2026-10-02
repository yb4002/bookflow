import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, CreditCard, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { api } from '@/data/api/client'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { daysUntil, useBilling, type PlanId } from './useBilling'

const PLAN_STAFF: Record<PlanId, number | null> = { solo: 1, team: 8, business: null }

/** Settings → Plan & billing. Payments happen on Stripe's hosted pages (Checkout / Billing Portal). */
export function BillingTab() {
  const { t, f, fmt, plural, locale } = useI18n()
  const b = t.billing
  const { state, reload } = useBilling()
  const [params, setParams] = useSearchParams()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const checkout = params.get('checkout')

  // Back from Stripe Checkout: the webhook may take a moment — refresh a few times.
  useEffect(() => {
    if (checkout !== 'success') return
    const timers = [2000, 5000, 10000].map((ms) => setTimeout(() => void reload(), ms))
    return () => timers.forEach(clearTimeout)
  }, [checkout, reload])

  const go = async (key: string, path: string, body: Record<string, unknown> = {}) => {
    setBusy(key)
    setError(undefined)
    try {
      const { url } = await api<{ url: string }>('POST', path, body)
      window.location.assign(url)
    } catch {
      setError(b.unavailable)
      setBusy(undefined)
    }
  }

  if (!state) return <Skeleton className="h-64" />

  const days = daysUntil(state.trialEndsAt)
  const statusLine = (() => {
    switch (state.status) {
      case 'trialing':
        return state.entitled ? fmt(b.status.trialing, { days: plural(t.common.daysCount, days), date: f.dateMedium(state.trialEndsAt!) }) : b.status.trialOver
      case 'active':
        if (state.cancelAtPeriodEnd && state.currentPeriodEnd) return fmt(b.status.cancelAt, { date: f.dateMedium(state.currentPeriodEnd) })
        return state.currentPeriodEnd ? fmt(b.status.active, { date: f.dateMedium(state.currentPeriodEnd) }) : b.status.activeNoDate
      default:
        return b.status[state.status]
    }
  })()
  const warn = !state.entitled || state.status === 'past_due'

  return (
    <div className="space-y-4">
      {checkout === 'success' && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-200">{b.success}</p>}
      {checkout === 'cancelled' && (
        <p role="status" className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200">
          {b.cancelled}
          <button type="button" className="text-xs font-semibold text-slate-500" onClick={() => setParams({ tab: 'billing' }, { replace: true })}>✕</button>
        </p>
      )}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}

      <Card className="p-5">
        <p className="text-xs font-medium text-slate-500">{b.current}</p>
        <p className="mt-1 text-xl font-bold text-slate-900">{b.planNames[state.plan]}</p>
        <p data-testid="billing-status" className={cn('mt-1 text-sm', warn ? 'font-medium text-amber-700' : 'text-slate-600')}>
          {state.enabled ? statusLine : b.disabled}
        </p>
        {state.enabled && state.hasPaymentMethod && (
          <Button variant="secondary" className="mt-4" disabled={!!busy} onClick={() => go('portal', '/app/billing/portal')}>
            <CreditCard className="size-4" /> {busy === 'portal' ? b.redirecting : b.manage} <ExternalLink className="size-3.5 opacity-60" />
          </Button>
        )}
      </Card>

      {state.enabled && state.purchasable.length > 0 && (
        <Card>
          <CardHeader title={b.title} description={b.subtitle} />
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            {state.purchasable.map((plan) => {
              const current = plan === state.plan && (state.status === 'active' || state.status === 'past_due')
              const features = t.landing.pricing.plans[plan === 'solo' ? 'solo' : 'team'].features
              return (
                <div key={plan} className={cn('rounded-xl p-4 ring-1', current ? 'bg-brand-50 ring-brand-200' : 'bg-white ring-slate-200')}>
                  <p className="font-semibold text-slate-900">{b.planNames[plan]}</p>
                  <p className="text-xs text-slate-500">{PLAN_STAFF[plan] ? plural(b.staffLimit, PLAN_STAFF[plan]!) : b.unlimited}</p>
                  <ul className="mt-3 space-y-1.5">
                    {features.map((feat) => <li key={feat} className="flex gap-2 text-sm text-slate-700"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {feat}</li>)}
                  </ul>
                  {!current && (
                    <Button className="mt-4 w-full" disabled={!!busy} onClick={() => (state.hasPaymentMethod ? go('portal', '/app/billing/portal') : go(plan, '/app/billing/checkout', { plan, locale }))}>
                      {busy === plan ? b.redirecting : fmt(state.hasPaymentMethod ? b.switchTo : b.choose, { plan: b.planNames[plan] })}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
          <p className="px-5 pb-5 text-xs text-slate-500">{b.contact}</p>
        </Card>
      )}
    </div>
  )
}
