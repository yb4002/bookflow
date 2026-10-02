/**
 * Supported locales. To add a language:
 *   1. add an entry here,
 *   2. create `locales/<code>.ts` typed as `Messages`,
 *   3. register it in `locales/index.ts`.
 */
export interface LocaleConfig {
  code: string
  /** English name, for developers/logs. */
  name: string
  /** Name in its own language, shown in the switcher. */
  nativeName: string
  /** Compact label for tight spaces. */
  short: string
  dir: 'ltr' | 'rtl'
  /** BCP 47 tag passed to Intl formatters. */
  intl: string
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1
  /**
   * ISO 4217 currency used for all money display in this locale.
   * Display only — amounts are not converted. When multi-currency arrives this
   * should come from the business settings instead of the UI language.
   */
  currency: string
}

export const LOCALES = {
  en: { code: 'en', name: 'English', nativeName: 'English', short: 'EN', dir: 'ltr', intl: 'en-US', weekStartsOn: 1, currency: 'USD' },
  he: { code: 'he', name: 'Hebrew', nativeName: 'עברית', short: 'עב', dir: 'rtl', intl: 'he-IL', weekStartsOn: 0, currency: 'ILS' },
} as const satisfies Record<string, LocaleConfig>

export type Locale = keyof typeof LOCALES

export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_CODES = Object.keys(LOCALES) as Locale[]
export const STORAGE_KEY = 'bookflow.locale'

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && v in LOCALES
