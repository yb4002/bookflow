import { useState, type FormEvent } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field, Input, inputClass } from '@/components/ui/Input'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'

export interface CustomerDetails {
  name: string
  phone: string
  notes: string
  remindersOptIn: boolean
}

export const validateDetails = (d: CustomerDetails) => ({
  name: d.name.trim().replace(/\s+/g, ' ').length < 2,
  phone: d.phone.replace(/\D/g, '').length < 7 || /[^\d\s()+\-.]/.test(d.phone),
})

interface Props {
  value: CustomerDetails
  onChange: (v: CustomerDetails) => void
  cancellationHours: number
  submitting: boolean
  error?: string
  onSubmit: () => void
}

export function DetailsStep({ value, onChange, cancellationHours, submitting, error, onSubmit }: Props) {
  const { t, fmt } = useI18n()
  const s = t.booking.details
  const [touched, setTouched] = useState(false)
  const errors = validateDetails(value)
  const set = <K extends keyof CustomerDetails>(k: K, v: CustomerDetails[K]) => onChange({ ...value, [k]: v })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!errors.name && !errors.phone) onSubmit()
  }

  return (
    <section aria-labelledby="step-details">
      <h2 id="step-details" className="text-lg font-semibold text-slate-900">{s.title}</h2>
      <form className="mt-4 space-y-4" onSubmit={submit} noValidate>
        <Field label={s.name}>
          <Input
            autoComplete="name"
            dir="auto"
            value={value.name}
            placeholder={s.namePlaceholder}
            onChange={(e) => set('name', e.target.value)}
            aria-invalid={touched && errors.name}
            className={cn('h-12 text-base', touched && errors.name && 'ring-rose-400')}
          />
          {touched && errors.name && <p className="mt-1 text-xs text-rose-600">{s.errors.name}</p>}
        </Field>
        <Field label={s.phone} hint={s.phoneHint}>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            value={value.phone}
            placeholder={s.phonePlaceholder}
            onChange={(e) => set('phone', e.target.value)}
            aria-invalid={touched && errors.phone}
            className={cn('h-12 text-base rtl:text-right', touched && errors.phone && 'ring-rose-400')}
          />
          {touched && errors.phone && <p className="mt-1 text-xs text-rose-600">{s.errors.phone}</p>}
        </Field>
        <Field label={s.notes}>
          <textarea rows={2} dir="auto" value={value.notes} onChange={(e) => set('notes', e.target.value)} className={cn(inputClass, 'h-auto py-2 text-base')} />
        </Field>

        <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-700">
          <Checkbox checked={value.remindersOptIn} onChange={() => set('remindersOptIn', !value.remindersOptIn)} label={s.reminders} />
          <span onClick={() => set('remindersOptIn', !value.remindersOptIn)}>{s.reminders}</span>
        </label>

        <p className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900 ring-1 ring-emerald-200/70">
          <ShieldCheck className="size-4 shrink-0 text-emerald-600" />
          {fmt(s.policy, { hours: cancellationHours })}
        </p>

        {error && (
          <div role="alert" className="flex gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? s.confirming : s.confirm}
        </Button>
      </form>
    </section>
  )
}
