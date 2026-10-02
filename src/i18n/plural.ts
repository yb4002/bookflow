/** A message that varies by CLDR plural category. `other` is always required. */
export interface Plural {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

/** Marks a message as plural so catalogs share one precise type. */
export const plural = (forms: Plural): Plural => forms

export type Vars = Record<string, string | number>

const FSI = '\u2068' // First Strong Isolate
const PDI = '\u2069' // Pop Directional Isolate

/**
 * Replaces `{name}` placeholders. Unknown placeholders are left intact.
 *
 * With `isolate`, each value is wrapped in Unicode bidi isolates so mixed-direction
 * content stays intact — e.g. a Latin staff name next to a number inside Hebrew
 * text ("Priya · 1 ש׳ פנוי") is not reordered. Same approach as Mozilla Fluent.
 */
export function interpolate(template: string, vars: Vars = {}, isolate: boolean | ((value: string) => boolean) = false): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => {
    if (!(key in vars)) return m
    const value = String(vars[key])
    const wrap = typeof isolate === 'function' ? isolate(value) : isolate
    return wrap ? FSI + value + PDI : value
  })
}

const RTL_SCRIPT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
/**
 * When a value needs isolation: always inside right-to-left text (numbers and Latin
 * names would otherwise be reordered); in left-to-right text only if the value itself
 * contains right-to-left script (e.g. a Hebrew client name in the English UI).
 * Keeps English output free of invisible control characters.
 */
export const isolationFor = (dir: 'ltr' | 'rtl') => (dir === 'rtl' ? () => true : (value: string) => RTL_SCRIPT.test(value))
