import { useMemo } from 'react'
import { inputClass } from '@/components/ui/Input'

const FALLBACK = ['UTC', 'Asia/Jerusalem', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Australia/Sydney']

/** Every IANA time zone the browser knows (falls back to a short list on older browsers). */
export function TimezoneSelect({ value, onChange, id }: { value: string; onChange: (tz: string) => void; id?: string }) {
  const zones = useMemo(() => {
    const all = (Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? FALLBACK
    return all.includes(value) ? all : [value, ...all]
  }, [value])
  return (
    <select id={id} name="timezone" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} dir="ltr">
      {zones.map((z) => <option key={z} value={z}>{z.replaceAll('_', ' ')}</option>)}
    </select>
  )
}
