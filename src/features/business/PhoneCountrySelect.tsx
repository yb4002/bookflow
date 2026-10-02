import { useMemo } from 'react'
import { PHONE_COUNTRIES, type PhoneCountry } from '@/domain/phone'
import { inputClass } from '@/components/ui/Input'
import { useI18n } from '@/i18n'

/** Country whose local phone format clients use ("052…" → +972…). Names are localized by the browser. */
export function PhoneCountrySelect({ value, onChange }: { value: PhoneCountry; onChange: (c: PhoneCountry) => void }) {
  const { locale } = useI18n()
  const options = useMemo(() => {
    const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([locale], { type: 'region' }) : null
    return (Object.keys(PHONE_COUNTRIES) as PhoneCountry[])
      .map((code) => ({ code, label: `${names?.of(code) ?? code} (+${PHONE_COUNTRIES[code].cc})` }))
      .sort((a, b) => a.label.localeCompare(b.label, locale))
  }, [locale])
  return (
    <select name="phoneCountry" className={inputClass} value={value} onChange={(e) => onChange(e.target.value as PhoneCountry)}>
      {options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
    </select>
  )
}
