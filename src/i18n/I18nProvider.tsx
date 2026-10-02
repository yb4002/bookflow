import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_LOCALE, isLocale, LOCALES, STORAGE_KEY, type Locale } from './config'
import { createFormatters, type Formatters } from './formatters'
import { catalogs, type Messages } from './locales'
import { interpolate, isolationFor, type Plural, type Vars } from './plural'
import { getPageTitle } from './useDocumentTitle'

export interface I18nContextValue {
  locale: Locale
  dir: 'ltr' | 'rtl'
  config: (typeof LOCALES)[Locale]
  /** Typed message catalog for the active locale. */
  t: Messages
  /** Locale-aware formatters (dates, numbers, currency, durations). */
  f: Formatters
  /** Fill `{placeholders}` in a message (values bidi-isolated where direction could clash). */
  fmt: (template: string, vars?: Vars) => string
  /** Pick the plural form for `count` and fill placeholders (`{count}` is provided). */
  plural: (forms: Plural, count: number, vars?: Vars) => string
  /** Change language. `persist: false` applies it without recording it as the user's choice. */
  setLocale: (locale: Locale, options?: { persist?: boolean }) => void
  /** True when the viewer explicitly picked a language (menu or `?lang=` link). */
  hasExplicitLocale: () => boolean
  /** Business-chosen display currency; `null` = the language's default currency. */
  setCurrencyOverride: (currency: string | null) => void
  /** IANA zone used for all date math and display (the business's zone, else the viewer's). */
  zone: string
  /** Sets the business time zone; `null` = the viewer's own zone. */
  setTimeZone: (zone: string | null) => void
}

export const I18nContext = createContext<I18nContextValue | null>(null)

function readStored(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isLocale(v) ? v : null
  } catch {
    return null
  }
}

/** `?lang=he` in the URL wins (handy for sharing/testing), then the saved choice, then the default. */
export function resolveInitialLocale(): Locale {
  const fromUrl = new URLSearchParams(window.location.search).get('lang')
  if (isLocale(fromUrl)) return fromUrl
  return readStored() ?? DEFAULT_LOCALE
}

/** Sets `<html lang dir>` — the single source of truth for text direction. */
export function applyDocumentLocale(locale: Locale) {
  const el = document.documentElement
  el.lang = locale
  el.dir = LOCALES[locale].dir
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = resolveInitialLocale()
    applyDocumentLocale(initial)
    // A `?lang=` link is an explicit choice: remember it, so it survives navigation and reloads.
    try {
      if (isLocale(new URLSearchParams(window.location.search).get('lang'))) localStorage.setItem(STORAGE_KEY, initial)
    } catch {
      /* storage unavailable */
    }
    return initial
  })

  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null)
  const [timeZone, setTimeZone] = useState<string | null>(null)

  const setLocale = useCallback((next: Locale, options: { persist?: boolean } = {}) => {
    setLocaleState(next)
    if (options.persist === false) return
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage unavailable (private mode) — the choice lasts for this session */
    }
  }, [])

  const hasExplicitLocale = useCallback(() => readStored() !== null || isLocale(new URLSearchParams(window.location.search).get('lang')), [])

  useEffect(() => {
    applyDocumentLocale(locale)
    // Effects run child-first, so a page title set via useDocumentTitle is already in place here.
    document.title = getPageTitle() ?? catalogs[locale].meta.title
  }, [locale])

  const value = useMemo<I18nContextValue>(() => {
    const config = LOCALES[locale]
    const t = catalogs[locale]
    const f = createFormatters(currencyOverride ? { ...config, currency: currencyOverride } : config, t, timeZone ?? undefined)
    const rules = new Intl.PluralRules(config.intl)
    const isolate = isolationFor(config.dir)
    return {
      locale,
      dir: config.dir,
      config,
      t,
      f,
      fmt: (template, vars) => interpolate(template, vars, isolate),
      plural: (forms, count, vars) =>
        interpolate(forms[rules.select(count) as keyof Plural] ?? forms.other, { count: f.number(count), ...vars }, isolate),
      setLocale,
      hasExplicitLocale,
      setCurrencyOverride,
      zone: f.timeZone,
      setTimeZone,
    }
  }, [locale, setLocale, hasExplicitLocale, currencyOverride, timeZone])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
