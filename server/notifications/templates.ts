import { LOCALES } from '../../src/i18n/config'
import { createFormatters } from '../../src/i18n/formatters'
import { catalogs } from '../../src/i18n/locales'
import type { LanguageCode, NotificationKind } from '../../src/domain/types'

/**
 * Customer-facing message templates (en/he). Short enough for SMS, with an email
 * subject. Dates/times use the same formatters as the app UI. Bidi isolation marks
 * are deliberately NOT used — these strings leave BookFlow.
 */
export interface MessageFacts {
  businessName: string
  businessPhone: string
  customerFirstName: string
  serviceName: string
  staffName: string
  start: Date
  previousStart?: Date
  manageUrl: string
  bookUrl: string
  cancelledBy?: 'customer' | 'business'
}

export interface RenderedMessage {
  subject: string
  body: string
}

type Template = (f: MessageFacts, fmt: ReturnType<typeof createFormatters>) => RenderedMessage
const when = (fmt: ReturnType<typeof createFormatters>, d: Date) => `${fmt.dateLong(d)} · ${fmt.time(d)}`

const en: Record<Exclude<NotificationKind, 'smart_fill_offer' | 'message'>, Template> = {
  confirmation: (f, fmt) => ({
    subject: `Booking confirmed — ${f.businessName}`,
    body: `Hi ${f.customerFirstName}, you're booked at ${f.businessName}: ${f.serviceName} with ${f.staffName} on ${when(fmt, f.start)}. Manage or cancel: ${f.manageUrl}`,
  }),
  reminder: (f, fmt) => ({
    subject: `Reminder: ${f.serviceName} at ${f.businessName}`,
    body: `Reminder: ${f.serviceName} with ${f.staffName} at ${f.businessName}, ${when(fmt, f.start)}. Need to change it? ${f.manageUrl}`,
  }),
  reschedule: (f, fmt) => ({
    subject: `Appointment moved — ${f.businessName}`,
    body: `Your ${f.serviceName} at ${f.businessName} is now on ${when(fmt, f.start)}${f.previousStart ? ` (was ${when(fmt, f.previousStart)})` : ''}. Details: ${f.manageUrl}`,
  }),
  cancellation: (f, fmt) =>
    f.cancelledBy === 'business'
      ? {
          subject: `Appointment cancelled — ${f.businessName}`,
          body: `Sorry ${f.customerFirstName}, ${f.businessName} had to cancel your ${f.serviceName} on ${when(fmt, f.start)}. Book a new time: ${f.bookUrl} or call ${f.businessPhone}.`,
        }
      : {
          subject: `Cancellation confirmed — ${f.businessName}`,
          body: `Your ${f.serviceName} at ${f.businessName} on ${when(fmt, f.start)} is cancelled. Book again anytime: ${f.bookUrl}`,
        },
}

const he: typeof en = {
  confirmation: (f, fmt) => ({
    subject: `התור אושר — ${f.businessName}`,
    body: `היי ${f.customerFirstName}, התור שלכם ב-${f.businessName} נקבע: ${f.serviceName} אצל ${f.staffName}, ${when(fmt, f.start)}. לניהול או ביטול: ${f.manageUrl}`,
  }),
  reminder: (f, fmt) => ({
    subject: `תזכורת: ${f.serviceName} ב-${f.businessName}`,
    body: `תזכורת: ${f.serviceName} אצל ${f.staffName} ב-${f.businessName}, ${when(fmt, f.start)}. צריכים לשנות? ${f.manageUrl}`,
  }),
  reschedule: (f, fmt) => ({
    subject: `התור הועבר — ${f.businessName}`,
    body: `התור שלכם ל-${f.serviceName} ב-${f.businessName} הועבר ל${when(fmt, f.start)}${f.previousStart ? ` (במקום ${when(fmt, f.previousStart)})` : ''}. פרטים: ${f.manageUrl}`,
  }),
  cancellation: (f, fmt) =>
    f.cancelledBy === 'business'
      ? {
          subject: `התור בוטל — ${f.businessName}`,
          body: `מצטערים ${f.customerFirstName}, ${f.businessName} נאלצו לבטל את התור ל-${f.serviceName} ב${when(fmt, f.start)}. לקביעת מועד חדש: ${f.bookUrl} או בטלפון ${f.businessPhone}.`,
        }
      : {
          subject: `הביטול אושר — ${f.businessName}`,
          body: `התור שלכם ל-${f.serviceName} ב-${f.businessName}, ${when(fmt, f.start)}, בוטל. אפשר לקבוע שוב בכל עת: ${f.bookUrl}`,
        },
}

const templates: Record<LanguageCode, typeof en> = { en, he }
const formatterCache = new Map<string, ReturnType<typeof createFormatters>>()
/** Formatters per language + business time zone (times in messages are the business's local time). */
const formattersFor = (locale: LanguageCode, timeZone: string) => {
  const key = `${locale}|${timeZone}`
  let f = formatterCache.get(key)
  if (!f) formatterCache.set(key, (f = createFormatters(LOCALES[locale], catalogs[locale], timeZone)))
  return f
}

export function renderMessage(kind: Exclude<NotificationKind, 'smart_fill_offer' | 'message'>, locale: LanguageCode, facts: MessageFacts, timeZone: string): RenderedMessage {
  return templates[locale][kind](facts, formattersFor(locale, timeZone))
}
