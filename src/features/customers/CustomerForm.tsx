import { useState } from 'react'
import type { Customer, CustomerTag, LanguageCode } from '@/domain/types'
import { CUSTOMER_TAGS } from '@/domain/bookingRules'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Drawer } from '@/components/ui/Drawer'
import { Field, Input, inputClass } from '@/components/ui/Input'
import { TagBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { repo } from '@/data/repositories'
import type { CustomerInput } from '@/data/repositories/types'
import { LOCALE_CODES, LOCALES, useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { useErrorText } from '@/features/appointments/useErrorText'

/** Add a client, or edit one (`customer` given). */
export function CustomerForm({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved?: (c: Customer) => void }) {
  const { t } = useI18n()
  const c = t.manage.client
  const toast = useToast()
  const errorText = useErrorText()
  const [form, setForm] = useState<CustomerInput>(() => ({
    firstName: customer?.firstName ?? '',
    lastName: customer?.lastName ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    notes: customer?.notes ?? '',
    marketingOptIn: customer?.marketingOptIn ?? false,
    preferredLanguage: customer?.preferredLanguage,
    tags: customer?.tags ?? ['New'],
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const set = <K extends keyof CustomerInput>(k: K, v: CustomerInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const toggleTag = (tag: CustomerTag) => set('tags', form.tags?.includes(tag) ? form.tags.filter((x) => x !== tag) : [...(form.tags ?? []), tag])
  const valid = form.firstName.trim().length > 0 && form.phone.replace(/\D/g, '').length >= 7

  const save = async () => {
    setSaving(true)
    setError(undefined)
    try {
      const input = { ...form, notes: form.notes?.trim() || undefined }
      const saved = customer ? await repo.updateCustomer(customer.id, input) : await repo.createCustomer(input)
      toast(customer ? c.saved : c.added)
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={customer ? c.editTitle : c.addTitle}
      footer={
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>{t.services.editor.cancel}</Button>
            <Button className="flex-1" disabled={!valid || saving} onClick={save}>{saving ? c.saving : c.save}</Button>
          </div>
        </div>
      }
    >
      <form className="space-y-5" onSubmit={(e) => (e.preventDefault(), save())}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={c.firstName}><Input name="firstName" dir="auto" autoComplete="off" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
          <Field label={c.lastName}><Input name="lastName" dir="auto" autoComplete="off" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
        </div>
        <Field label={c.phone}><Input name="phone" type="tel" dir="ltr" className="text-start rtl:text-end" autoComplete="off" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={c.email}><Input name="email" type="email" dir="ltr" className="text-start rtl:text-end" autoComplete="off" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label={c.language}>
          <select name="language" className={inputClass} value={form.preferredLanguage ?? ''} onChange={(e) => set('preferredLanguage', (e.target.value || undefined) as LanguageCode | undefined)}>
            <option value="">{c.languageAuto}</option>
            {LOCALE_CODES.map((l) => <option key={l} value={l}>{LOCALES[l].nativeName}</option>)}
          </select>
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{c.tags}</legend>
          <div className="flex flex-wrap gap-2">
            {CUSTOMER_TAGS.map((tag) => (
              <button key={tag} type="button" aria-pressed={!!form.tags?.includes(tag)} onClick={() => toggleTag(tag)} className={cn('rounded-full ring-2 ring-offset-1 transition', form.tags?.includes(tag) ? 'ring-brand-500' : 'opacity-60 ring-transparent')}>
                <TagBadge tag={tag} />
              </button>
            ))}
          </div>
        </fieldset>
        <Field label={c.notes} hint={c.notesHint}>
          <textarea name="notes" rows={3} dir="auto" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} className={cn(inputClass, 'h-auto py-2')} />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
          <Checkbox checked={form.marketingOptIn} onChange={() => set('marketingOptIn', !form.marketingOptIn)} label={c.marketing} className="mt-0.5" />
          <span onClick={() => set('marketingOptIn', !form.marketingOptIn)}>
            <span className="block text-sm font-medium text-slate-900">{c.marketing}</span>
            <span className="block text-xs text-slate-500">{c.marketingHint}</span>
          </span>
        </label>
        <button type="submit" hidden />
      </form>
    </Drawer>
  )
}
