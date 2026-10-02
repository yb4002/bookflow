/**
 * Locale-independent helpers only. Anything that depends on the language
 * (dates, numbers, currency, durations) lives in `useI18n().f`.
 */
export const fullName = (c: { firstName: string; lastName: string }) => [c.firstName, c.lastName].filter(Boolean).join(' ')
/** Handles single-word names (e.g. bookings made with just a first name). */
export const initials = (c: { firstName: string; lastName: string }) => `${c.firstName[0] ?? ''}${c.lastName[0] ?? ''}`.toUpperCase()
