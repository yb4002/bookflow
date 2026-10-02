import { BookingError } from '@/data/repositories'
import { useI18n } from '@/i18n'

/** Translated, user-facing text for a failed repository call. */
export function useErrorText() {
  const { t } = useI18n()
  const e = t.manage.errors
  return (err: unknown): string => {
    if (err instanceof BookingError && err.code in e) return e[err.code as keyof typeof e]
    return e.generic
  }
}
