import { useState } from 'react'
import { Mail, MessageCircle, MessageSquare, Send, type LucideIcon } from 'lucide-react'
import type { MessageChannel } from '@/domain/types'
import { Ltr } from '@/components/i18n/Ltr'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { ChannelNotice } from '@/features/business/ChannelNotice'
import { fullName, initials } from '@/lib/format'
import type { FillCandidate, FillOpportunity } from './matching'
import { addressFor } from './message'

const channels: { id: MessageChannel; icon: LucideIcon }[] = [
  { id: 'whatsapp', icon: MessageCircle },
  { id: 'sms', icon: MessageSquare },
  { id: 'email', icon: Mail },
]

const bubble: Record<MessageChannel, string> = {
  whatsapp: 'bg-emerald-50 ring-emerald-200/70',
  sms: 'bg-slate-100 ring-slate-200',
  email: 'bg-white ring-slate-200',
}

interface Props {
  open: boolean
  onClose: () => void
  opportunity: FillOpportunity
  recipients: FillCandidate[]
  preview: string
  sending: boolean
  onSend: (channel: MessageChannel) => void
}

export function SendAvailabilityDrawer({ open, onClose, opportunity, recipients, preview, sending, onSend }: Props) {
  const { t, f, fmt, plural } = useI18n()
  const s = t.smartFill
  const [channel, setChannel] = useState<MessageChannel>('whatsapp')
  const a = opportunity.appointment

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={s.drawer.title}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={sending}>{s.drawer.cancel}</Button>
          <Button className="flex-[2]" onClick={() => onSend(channel)} disabled={sending || !recipients.length}>
            <Send className="size-4 rtl:-scale-x-100" />
            {sending ? s.drawer.sending : plural(s.actions.sendTo, recipients.length)}
          </Button>
        </div>
      }
    >
      {/* Slot summary */}
      <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100">
        <p className="text-sm font-semibold text-slate-900">{a.service.name}</p>
        <p className="mt-0.5 text-sm text-slate-600">
          <bdi>{f.friendlyDate(a.start)}</bdi> · <bdi>{f.timeRange(a.start, a.end)}</bdi> · <bdi>{fmt(s.slot.withStaff, { staff: a.staff.name.split(' ')[0] })}</bdi>
        </p>
      </div>

      {/* Channel */}
      <p className="mt-6 text-xs font-semibold tracking-wide text-slate-500 uppercase">{s.drawer.channel}</p>
      <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label={s.drawer.channel}>
        {channels.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={channel === id}
            onClick={() => setChannel(id)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-xs font-semibold ring-1 transition',
              channel === id ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-500' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
            )}
          >
            <Icon className="size-5" />
            {s.drawer.channels[id]}
          </button>
        ))}
      </div>
      <ChannelNotice channel={channel} />

      {/* Preview */}
      <p className="mt-6 text-xs font-semibold tracking-wide text-slate-500 uppercase">{s.drawer.preview}</p>
      <div className={cn('mt-2 rounded-2xl rounded-ss-sm p-4 text-sm leading-relaxed whitespace-pre-line text-slate-800 ring-1', bubble[channel])}>
        {preview}
      </div>
      <p className="mt-2 text-xs text-slate-500">{s.drawer.personalized}</p>

      {/* Recipients */}
      <p className="mt-6 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {s.drawer.recipients} · {f.number(recipients.length)}
      </p>
      <ul className="mt-2 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
        {recipients.map((c) => (
          <li key={c.customer.id} className="flex items-center gap-3 px-3 py-2.5">
            <Avatar label={initials(c.customer)} seed={c.customer.id} />
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate text-sm font-medium text-slate-900 rtl:text-right">{fullName(c.customer)}</p>
              <p className="truncate text-xs text-slate-500"><Ltr>{addressFor(c.customer, channel)}</Ltr></p>
            </div>
          </li>
        ))}
      </ul>
    </Drawer>
  )
}
