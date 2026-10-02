import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Drawer } from '@/components/ui/Drawer'
import { repo } from '@/data/repositories'
import type { CustomerInput, ImportResult } from '@/data/repositories/types'
import { useI18n } from '@/i18n'
import { parseCsv } from '@/lib/csv'

type Field = 'firstName' | 'lastName' | 'name' | 'phone' | 'email' | 'notes'
/** Header names we recognise (lower-case, English and Hebrew). */
const HEADERS: Record<Field, string[]> = {
  firstName: ['first name', 'firstname', 'first', 'given name', 'שם פרטי'],
  lastName: ['last name', 'lastname', 'last', 'surname', 'family name', 'שם משפחה'],
  name: ['name', 'full name', 'client', 'customer', 'client name', 'customer name', 'שם', 'שם מלא', 'שם הלקוח', 'לקוח'],
  phone: ['phone', 'mobile', 'cell', 'tel', 'telephone', 'phone number', 'mobile phone', 'טלפון', 'נייד', 'פלאפון', 'מספר טלפון', 'טלפון נייד'],
  email: ['email', 'e-mail', 'mail', 'email address', 'אימייל', 'מייל', 'דוא"ל', 'דואל', 'דואר אלקטרוני'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'הערות', 'הערה'],
}
const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ')

/** Maps header positions to fields. */
function detect(headers: string[]) {
  const map: Partial<Record<Field, number>> = {}
  headers.forEach((h, i) => {
    const n = norm(h)
    for (const f of Object.keys(HEADERS) as Field[]) if (map[f] === undefined && HEADERS[f].includes(n)) map[f] = i
  })
  return map
}

/** Rows → client inputs (full names are split at the first space). */
function toInputs(rows: string[][], map: Partial<Record<Field, number>>, consent: boolean): CustomerInput[] {
  const at = (r: string[], f: Field) => (map[f] === undefined ? '' : (r[map[f]!] ?? '').trim())
  return rows.map((r) => {
    let first = at(r, 'firstName')
    let last = at(r, 'lastName')
    if (!first && !last) {
      const [f, ...rest] = at(r, 'name').split(/\s+/)
      first = f ?? ''
      last = rest.join(' ')
    }
    const notes = at(r, 'notes')
    return { firstName: first, lastName: last, phone: at(r, 'phone'), email: at(r, 'email'), marketingOptIn: consent, ...(notes ? { notes } : {}) }
  })
}

export function ImportCustomers({ onClose }: { onClose: () => void }) {
  const { t, fmt, plural, f } = useI18n()
  const s = t.importClients
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; rows: string[][] }>()
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult>()
  const [error, setError] = useState<string>()

  const parsed = useMemo(() => {
    if (!file) return null
    const [headers = [], ...rows] = file.rows
    const map = detect(headers)
    return { headers, rows, map }
  }, [file])
  const problem = parsed && (parsed.map.phone === undefined ? s.noPhone : parsed.map.name === undefined && parsed.map.firstName === undefined ? s.noName : parsed.rows.length > 5000 ? s.tooMany : null)

  const pick = async (fl?: File) => {
    if (!fl) return
    setResult(undefined)
    setError(undefined)
    setFile({ name: fl.name, rows: parseCsv(await fl.text()) })
  }
  const run = async () => {
    if (!parsed || problem) return
    setBusy(true)
    setError(undefined)
    try {
      setResult(await repo.importCustomers(toInputs(parsed.rows, parsed.map, consent)))
    } catch {
      setError(t.manage.errors.generic)
    } finally {
      setBusy(false)
    }
  }
  // Row numbers in the spreadsheet (the header is row 1).
  const sheetRows = (rows: number[]) => rows.slice(0, 20).map((r) => f.number(r + 1)).join(', ') + (rows.length > 20 ? '…' : '')

  return (
    <Drawer
      open
      onClose={onClose}
      title={s.title}
      footer={
        result ? (
          <Button className="w-full" onClick={onClose}>{t.common.close}</Button>
        ) : (
          <Button className="w-full" size="lg" disabled={!parsed || !!problem || !parsed.rows.length || busy} onClick={run}>
            {busy ? s.importing : fmt(s.import, { count: f.number(parsed?.rows.length ?? 0) })}
          </Button>
        )
      }
    >
      {result ? (
        <div role="status" className="space-y-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-emerald-700"><CheckCircle2 className="size-5" /> {plural(s.done, result.created)}</p>
          {result.duplicates.length > 0 && <p className="text-slate-600">{plural(s.duplicates, result.duplicates.length)}</p>}
          {result.invalid.length > 0 && <p className="text-slate-600">{fmt(s.invalid, { rows: sheetRows(result.invalid) })}</p>}
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-slate-600">{s.intro}</p>
          <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" className="sr-only" aria-label={s.choose} onChange={(e) => void pick(e.target.files?.[0])} />
          <Button variant="secondary" onClick={() => input.current?.click()}><FileUp className="size-4" /> {s.choose}</Button>
          {parsed && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-900">{plural(s.found, parsed.rows.length, { file: file!.name })}</p>
              {problem ? (
                <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">{problem}</p>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{s.columns}</p>
                    <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="import-columns">
                      {(Object.keys(parsed.map) as Field[]).map((fld) => (
                        <li key={fld} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                          {s.fields[fld]} ← <span dir="auto">{parsed.headers[parsed.map[fld]!]}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
                    <Checkbox checked={consent} onChange={() => setConsent(!consent)} label={s.consent} className="mt-0.5" />
                    <span onClick={() => setConsent(!consent)}>
                      <span className="block text-sm font-medium text-slate-900">{s.consent}</span>
                      <span className="block text-xs text-slate-500">{s.consentHint}</span>
                    </span>
                  </label>
                </>
              )}
            </div>
          )}
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
        </div>
      )}
    </Drawer>
  )
}
