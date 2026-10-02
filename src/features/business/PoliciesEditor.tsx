import type { ReactNode } from 'react'
import type { BookingPolicies } from '@/domain/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input, inputClass } from '@/components/ui/Input'
import { Switch } from '@/components/ui/Switch'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { ChannelNotice } from './ChannelNotice'

function Row({ title, body, control }: { title: string; body: string; control: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-md">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{body}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </li>
  )
}

/** Booking rules + no-show protection, as two cards. Controlled; `footer` goes under the second card. */
export function PoliciesEditor({ value: p, onChange, footer }: { value: BookingPolicies; onChange: (v: BookingPolicies) => void; footer?: ReactNode }) {
  const { t, f, fmt } = useI18n()
  const s = t.services.policies
  const set = <K extends keyof BookingPolicies>(k: K, v: BookingPolicies[K]) => onChange({ ...p, [k]: v })
  const num = (k: 'minNoticeHours' | 'maxAdvanceDays' | 'cancellationWindowHours', suffix: string) => (
    <div className="flex items-center gap-2">
      <Input type="number" min={0} value={p[k]} onChange={(e) => set(k, Math.max(0, Number(e.target.value)))} className="h-9 w-20 text-end" aria-label={suffix} />
      <span className="text-sm text-slate-500">{suffix}</span>
    </div>
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={s.rulesTitle} description={s.rulesSubtitle} />
        <ul className="mt-2 divide-y divide-slate-100">
          <Row title={s.minNotice.title} body={s.minNotice.body} control={num('minNoticeHours', s.units.hours)} />
          <Row title={s.window.title} body={s.window.body} control={num('maxAdvanceDays', s.units.days)} />
          <Row title={s.autoConfirm.title} body={s.autoConfirm.body} control={<Switch checked={p.autoConfirm} onChange={(v) => set('autoConfirm', v)} label={s.autoConfirm.title} />} />
        </ul>
      </Card>
      <Card>
        <CardHeader title={s.protectionTitle} description={s.protectionSubtitle} />
        <ul className="mt-2 divide-y divide-slate-100">
          <Row title={s.cancellation.title} body={s.cancellation.body} control={num('cancellationWindowHours', s.units.hoursBefore)} />
          <Row
            title={s.reminders.title}
            body={s.reminders.body}
            control={
              <div className="flex gap-1.5">
                {[48, 24, 2].map((h) => {
                  const on = p.reminderHoursBefore.includes(h)
                  return (
                    <button key={h} type="button" aria-pressed={on} onClick={() => set('reminderHoursBefore', on ? p.reminderHoursBefore.filter((x) => x !== h) : [...p.reminderHoursBefore, h].sort((a, b) => b - a))}
                      className={cn('rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition', on ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-white text-slate-500 ring-slate-200')}>
                      {fmt(s.reminderChip, { h: f.number(h) })}
                    </button>
                  )
                })}
              </div>
            }
          />
          <Row
            title={s.channel.title}
            body={s.channel.body}
            control={
              <div className="max-w-64">
                <select name="notificationChannel" value={p.notificationChannel} onChange={(e) => set('notificationChannel', e.target.value as BookingPolicies['notificationChannel'])} className={cn(inputClass, 'h-9 w-auto min-w-44')} aria-label={s.channel.title}>
                  <option value="sms">{s.channel.sms}</option>
                  <option value="whatsapp">{s.channel.whatsapp}</option>
                  <option value="email">{s.channel.email}</option>
                </select>
                <ChannelNotice channel={p.notificationChannel} />
              </div>
            }
          />
        </ul>
        {footer}
      </Card>
    </div>
  )
}
