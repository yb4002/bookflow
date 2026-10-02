import type { AppointmentStatus, CustomerTag } from '@/domain/types'
import { useI18n } from '@/i18n'
import { Badge, type BadgeTone } from './Badge'

const statusTone: Record<AppointmentStatus, BadgeTone> = {
  confirmed: 'green',
  pending: 'amber',
  completed: 'neutral',
  cancelled: 'red',
  no_show: 'red',
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { t } = useI18n()
  return <Badge tone={statusTone[status]} dot>{t.status[status]}</Badge>
}

const tagTone: Record<CustomerTag, BadgeTone> = { VIP: 'violet', New: 'blue', Regular: 'neutral', 'At risk': 'amber' }

export function TagBadge({ tag }: { tag: CustomerTag }) {
  const { t } = useI18n()
  return <Badge tone={tagTone[tag]}>{t.tags[tag]}</Badge>
}
