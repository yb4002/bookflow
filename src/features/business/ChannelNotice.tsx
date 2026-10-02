import { useEffect, useState } from 'react'
import { AlertTriangle, FlaskConical } from 'lucide-react'
import type { MessageChannel } from '@/domain/types'
import { api } from '@/data/api/client'
import { useI18n } from '@/i18n'

type Status = Record<MessageChannel, 'live' | 'simulated' | 'off'>
let cached: Promise<Status> | null = null
/** Which channels really send on this server (cached for the session). */
export function useMessagingStatus() {
  const [status, setStatus] = useState<Status>()
  useEffect(() => {
    cached ??= api<Status>('GET', '/app/messaging').catch(() => ({ sms: 'live', whatsapp: 'live', email: 'live' }) as Status)
    void cached.then(setStatus)
  }, [])
  return status
}

/** Warns when the chosen channel won't really deliver (not connected, or simulated in demo). */
export function ChannelNotice({ channel }: { channel: MessageChannel }) {
  const { t } = useI18n()
  const status = useMessagingStatus()?.[channel]
  if (!status || status === 'live') return null
  const off = status === 'off'
  return (
    <p data-testid="channel-notice" className={`mt-2 flex gap-1.5 text-xs ${off ? 'text-amber-700' : 'text-slate-500'}`}>
      {off ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <FlaskConical className="mt-0.5 size-3.5 shrink-0" />}
      {off ? t.messaging.off : t.messaging.simulated}
    </p>
  )
}
