import { useState } from 'react'
import { CalendarCheck, CalendarX2, Send, Sparkles } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { fullName, initials } from '@/lib/format'
import { staffColor } from '@/lib/staffColors'
import { DeliveryBadge } from './DeliveryBadge'
import type { FillCandidate, FillOpportunity } from './matching'
import { ReasonChip } from './ReasonChip'
import { SendAvailabilityDrawer } from './SendAvailabilityDrawer'
import { useSmartFill } from './useSmartFill'

/**
 * Smart Fill — turns a cancellation into a booking by offering the freed slot
 * to the best-matching clients. Self-contained: drop it anywhere.
 */
export function SmartFillCard() {
  const { t, f, plural } = useI18n()
  const s = t.smartFill
  const toast = useToast()
  const sf = useSmartFill()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleSend = async (channel: Parameters<typeof sf.send>[0]) => {
    const offer = await sf.send(channel)
    if (offer) {
      setDrawerOpen(false)
      toast(plural(s.sent.toast, offer.recipients.length))
    }
  }

  return (
    <Card id="smart-fill" className="scroll-mt-20 overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-sm">
          <Sparkles className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{s.title}</h3>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 ring-1 ring-brand-100">{s.badge}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{s.subtitle}</p>
        </div>
      </div>

      {sf.loading ? (
        <div className="grid gap-4 p-5 lg:grid-cols-5">
          <Skeleton className="h-56 lg:col-span-2" />
          <div className="space-y-2 lg:col-span-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        </div>
      ) : !sf.opportunity ? (
        <EmptyState icon={CalendarCheck} title={s.empty.title} description={s.empty.body} />
      ) : (
        <>
        {sf.opportunities.length > 1 && (
          <div className="scrollbar-none flex items-center gap-2 overflow-x-auto border-b border-slate-100 px-5 py-2.5" role="tablist" aria-label={plural(s.slot.openSlots, sf.opportunities.length)}>
            <span className="shrink-0 text-xs font-semibold text-slate-500">{plural(s.slot.openSlots, sf.opportunities.length)}</span>
            {sf.opportunities.map((o) => {
              const active = o.appointment.id === sf.opportunity?.appointment.id
              return (
                <button
                  key={o.appointment.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => sf.selectOpportunity(o.appointment.id)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap ring-1 transition',
                    active ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
                  )}
                >
                  {f.friendlyDate(o.appointment.start)} · {f.time(o.appointment.start)} · <bdi>{o.appointment.service.name}</bdi>
                </button>
              )
            })}
          </div>
        )}
        <div className="grid lg:grid-cols-5">
          <SlotPanel opportunity={sf.opportunity} contactedCount={sf.contacted.size} />

          {/* Candidates */}
          <div className="flex min-w-0 flex-col lg:col-span-3">
            <div className="px-5 pt-4">
              <h4 className="text-sm font-semibold text-slate-900">{s.candidates.title}</h4>
              <p className="mt-0.5 text-xs text-slate-500">{s.candidates.subtitle}</p>
            </div>

            {sf.candidates.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-500">{s.candidates.none}</p>
            ) : (
              <ul className="mt-2 flex-1 divide-y divide-slate-100 px-2">
                {sf.candidates.map((c) => (
                  <CandidateRow
                    key={c.customer.id}
                    candidate={c}
                    selected={sf.selected.has(c.customer.id)}
                    status={sf.contacted.get(c.customer.id)}
                    onToggle={() => sf.toggle(c.customer.id)}
                  />
                ))}
              </ul>
            )}

            {sf.excludedCount > 0 && (
              <p className="px-5 pt-1 pb-3 text-[11px] text-slate-400">{plural(s.candidates.excluded, sf.excludedCount)}</p>
            )}

            {/* Action bar */}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium text-slate-700">{plural(s.actions.selected, sf.selectedCandidates.length)}</span>
                {sf.selectedCandidates.length > 0 && (
                  <button type="button" onClick={sf.clear} className="text-xs font-semibold text-slate-500 hover:text-slate-800">{s.actions.clear}</button>
                )}
              </div>
              <Button onClick={() => setDrawerOpen(true)} disabled={!sf.selectedCandidates.length} className="max-sm:w-full">
                <Send className="size-4 rtl:-scale-x-100" />
                {sf.contacted.size ? s.actions.offerMore : s.actions.send}
              </Button>
            </div>
          </div>

          <SendAvailabilityDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            opportunity={sf.opportunity}
            recipients={sf.selectedCandidates}
            preview={sf.previewMessage()}
            sending={sf.sending}
            onSend={handleSend}
          />
        </div>
        </>
      )}
    </Card>
  )
}

function SlotPanel({ opportunity, contactedCount }: { opportunity: FillOpportunity; contactedCount: number }) {
  const { t, f, fmt, plural } = useI18n()
  const s = t.smartFill
  const a = opportunity.appointment
  return (
    <div className="border-b border-slate-100 bg-gradient-to-b from-brand-50/70 to-white p-5 lg:col-span-2 lg:border-e lg:border-b-0">
      <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-600/15">
        <CalendarX2 className="size-3.5" />
        {fmt(s.slot.cancelled, { ago: f.relative(opportunity.cancelledAt) })}
      </span>

      <p className="mt-4 text-sm font-medium text-slate-500">{f.friendlyDate(a.start)}</p>
      <p className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{f.timeRange(a.start, a.end)}</p>
      <p className="mt-1 text-sm text-slate-700">
        {/* Each value isolated so a Latin service name never captures the Hebrew duration's digits. */}
        <bdi className="font-semibold">{a.service.name}</bdi> · <bdi>{f.duration(a.service.durationMin)}</bdi>
      </p>

      <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
        <span className={cn('flex size-6 items-center justify-center rounded-full text-[10px] font-semibold', staffColor[a.staff.color].soft)}>{a.staff.avatarInitials}</span>
        {fmt(s.slot.withStaff, { staff: a.staff.name })}
      </div>

      <div className="mt-5 flex items-end justify-between gap-3 border-t border-brand-100/70 pt-4">
        <div>
          <p className="text-xs text-slate-500">{s.slot.atStake}</p>
          <p className="text-xl font-bold text-slate-900 tabular-nums">{f.money(a.price)}</p>
        </div>
        <div className="text-end text-[11px] text-slate-400">
          <p>{fmt(s.slot.cancelledBy, { name: fullName(a.customer) })}</p>
          {a.cancellationReason && <p className="mt-0.5 text-slate-500">{fmt(s.slot.reason, { reason: t.cancellationReasons[a.cancellationReason] })}</p>}
        </div>
      </div>

      {contactedCount > 0 && (
        <div className="mt-4 flex gap-2.5 rounded-lg bg-white p-3 ring-1 ring-emerald-200">
          <span className="relative mt-1.5 flex size-2 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{plural(s.sent.title, contactedCount)}</p>
            <p className="text-xs text-slate-500">{s.sent.body}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function CandidateRow({ candidate, selected, status, onToggle }: { candidate: FillCandidate; selected: boolean; status?: Parameters<typeof DeliveryBadge>[0]['status']; onToggle: () => void }) {
  const { t, f, fmt, plural } = useI18n()
  const s = t.smartFill.candidates
  const c = candidate.customer
  const contacted = status !== undefined
  const name = fullName(c)

  return (
    <li>
      <div
        onClick={contacted ? undefined : onToggle}
        className={cn(
          'flex gap-3 rounded-lg px-3 py-3 transition-colors',
          !contacted && 'cursor-pointer hover:bg-slate-50',
          selected && !contacted && 'bg-brand-50/50 hover:bg-brand-50/70',
        )}
      >
        <div className="pt-2.5">
          {contacted ? <span className="block size-5" /> : <Checkbox checked={selected} onChange={onToggle} label={fmt(s.selectAria, { name })} />}
        </div>
        <Avatar label={initials(c)} seed={c.id} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p dir="auto" className="truncate text-sm font-semibold text-slate-900 rtl:text-right">{name}</p>
              <p className="text-xs text-slate-500">
                {plural(t.common.visits, c.totalVisits)}
                {candidate.lastVisit && <> · {fmt(s.lastVisit, { date: f.friendlyDate(candidate.lastVisit) })}</>}
              </p>
            </div>
            {contacted ? (
              <DeliveryBadge status={status} />
            ) : (
              <span className="shrink-0 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-100 tabular-nums">
                {fmt(s.match, { percent: f.percent(candidate.match) })}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {candidate.reasons.slice(0, 4).map((r, i) => <ReasonChip key={i} reason={r} />)}
          </div>
        </div>
      </div>
    </li>
  )
}
