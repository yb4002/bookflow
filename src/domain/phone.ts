/**
 * Phone numbers → E.164 ("+972525550101"), which SMS/WhatsApp providers require.
 * Clients type numbers the local way ("052-555-0101", "(555) 010-2030"); the business's
 * phone country says how to read them. Numbers typed with a "+" or "00" prefix are kept as-is.
 */

export type PhoneCountry = 'IL' | 'US' | 'CA' | 'GB' | 'DE' | 'FR' | 'ES' | 'IT' | 'NL' | 'AU'

interface Rule {
  /** Country calling code. */
  cc: string
  /** National (trunk) prefix dropped before the calling code, e.g. 0 in Israel. */
  trunk?: string
  /** Valid national significant number lengths. */
  lengths: number[]
}

export const PHONE_COUNTRIES: Record<PhoneCountry, Rule> = {
  IL: { cc: '972', trunk: '0', lengths: [8, 9] },
  US: { cc: '1', trunk: '1', lengths: [10] },
  CA: { cc: '1', trunk: '1', lengths: [10] },
  GB: { cc: '44', trunk: '0', lengths: [9, 10] },
  DE: { cc: '49', trunk: '0', lengths: [6, 7, 8, 9, 10, 11] },
  FR: { cc: '33', trunk: '0', lengths: [9] },
  ES: { cc: '34', lengths: [9] },
  IT: { cc: '39', lengths: [6, 7, 8, 9, 10, 11] },
  NL: { cc: '31', trunk: '0', lengths: [9] },
  AU: { cc: '61', trunk: '0', lengths: [9] },
}

export const isPhoneCountry = (v: unknown): v is PhoneCountry => typeof v === 'string' && v in PHONE_COUNTRIES

/** Returns the E.164 form, or null when the number can't be a valid phone number. */
export function toE164(raw: string, country: PhoneCountry): string | null {
  const trimmed = raw.trim()
  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  if (digits.startsWith('00')) {
    digits = digits.slice(2)
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }
  const rule = PHONE_COUNTRIES[country]
  if (rule.trunk && digits.startsWith(rule.trunk) && rule.lengths.includes(digits.length - rule.trunk.length)) digits = digits.slice(rule.trunk.length)
  // Already includes the calling code without "+" (e.g. "972 52…")?
  if (digits.startsWith(rule.cc) && rule.lengths.includes(digits.length - rule.cc.length)) return `+${digits}`
  return rule.lengths.includes(digits.length) ? `+${rule.cc}${digits}` : null
}

/** Default phone country for a new business. */
export const defaultPhoneCountry = (locale: string, timezone: string): PhoneCountry => {
  if (locale === 'he' || timezone === 'Asia/Jerusalem' || timezone === 'Asia/Tel_Aviv') return 'IL'
  if (timezone.startsWith('Europe/London')) return 'GB'
  if (timezone.startsWith('Australia/')) return 'AU'
  return 'US'
}
