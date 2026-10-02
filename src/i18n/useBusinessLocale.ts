import { useEffect } from 'react'
import type { BusinessSettings } from '@/domain/types'
import { isValidTimeZone } from '@/domain/time'
import { isLocale } from './config'
import { useI18n } from './useI18n'

/**
 * Applies a business's language & currency settings while its pages are shown:
 * - currency: a fixed business currency overrides the language default ("auto" = follow language);
 * - default language (public pages only): used unless the visitor picked a language themselves.
 * - time zone: dates/times display in the business's zone.
 * The overrides are removed again when the business's pages unmount.
 */
export function useBusinessLocale(settings: BusinessSettings | undefined, { applyDefaultLanguage = false, timeZone }: { applyDefaultLanguage?: boolean; timeZone?: string } = {}) {
  const { setCurrencyOverride, setTimeZone, setLocale, hasExplicitLocale } = useI18n()
  const currency = settings?.currency
  const defaultLanguage = settings?.defaultLanguage

  useEffect(() => {
    setCurrencyOverride(currency && currency !== 'auto' ? currency : null)
    return () => setCurrencyOverride(null)
  }, [currency, setCurrencyOverride])

  // Dates and times are shown in the business's time zone (its opening hours are local to it).
  useEffect(() => {
    if (!timeZone) return
    setTimeZone(isValidTimeZone(timeZone) ? timeZone : null)
    return () => setTimeZone(null)
  }, [timeZone, setTimeZone])

  useEffect(() => {
    if (applyDefaultLanguage && isLocale(defaultLanguage) && !hasExplicitLocale()) setLocale(defaultLanguage, { persist: false })
  }, [applyDefaultLanguage, defaultLanguage, hasExplicitLocale, setLocale])
}
