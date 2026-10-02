import type { Locale } from '../config'
import en, { type Messages } from './en'
import he from './he'

export type { Messages }

/** Message catalogs by locale. Register new languages here. */
export const catalogs: Record<Locale, Messages> = { en, he }
