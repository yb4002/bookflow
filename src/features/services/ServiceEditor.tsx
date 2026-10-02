import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Service } from '@/domain/types'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { Field, Input, inputClass } from '@/components/ui/Input'
import { Switch } from '@/components/ui/Switch'
import { useI18n } from '@/i18n'

/** Draft for a new service (no id yet). */
export const blankService = (): Service => ({ businessId: '', id: '', name: '', category: '', description: '', durationMin: 60, bufferMin: 0, price: 0, active: true })

/** Create or edit a service. A service without an id is new. */
export function ServiceEditor({ service, onClose, onSave, onDelete }: { service: Service | null; onClose: () => void; onSave: (s: Service) => Promise<void>; onDelete?: (s: Service) => Promise<void> }) {
  const { t, f, fmt } = useI18n()
  const e = t.services.editor
  const [draft, setDraft] = useState<Service | null>(service)
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(service), [service])
  if (!service || !draft) return null

  const isNew = !service.id
  const set = <K extends keyof Service>(k: K, v: Service[K]) => setDraft({ ...draft, [k]: v })
  const valid = draft.name.trim().length > 0 && draft.durationMin >= 5 && draft.price >= 0
  const run = async (fn: () => Promise<void>) => {
    setSaving(true)
    try {
      await fn()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={isNew ? t.business.services.addTitle : e.title}
      footer={
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>{e.cancel}</Button>
            <Button className="flex-1" disabled={!valid || saving} onClick={() => run(() => onSave(draft))}>
              {saving ? e.saving : e.save}
            </Button>
          </div>
          {!isNew && onDelete && (
            <Button variant="ghost" size="sm" className="w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700" disabled={saving} onClick={() => run(() => onDelete(service))}>
              <Trash2 className="size-3.5" /> {t.business.services.remove}
            </Button>
          )}
        </div>
      }
    >
      <form className="space-y-5" onSubmit={(ev) => ev.preventDefault()}>
        <Field label={e.name}><Input name="serviceName" dir="auto" value={draft.name} onChange={(ev) => set('name', ev.target.value)} /></Field>
        <Field label={e.category}><Input name="serviceCategory" dir="auto" value={draft.category} onChange={(ev) => set('category', ev.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={e.duration}><Input name="serviceDuration" type="number" min={5} step={5} value={draft.durationMin} onChange={(ev) => set('durationMin', Number(ev.target.value))} /></Field>
          <Field label={fmt(e.price, { currency: f.currencySymbol })}><Input name="servicePrice" type="number" min={0} value={draft.price} onChange={(ev) => set('price', Number(ev.target.value))} /></Field>
        </div>
        <Field label={e.buffer} hint={e.bufferHint}>
          <Input type="number" min={0} step={5} value={draft.bufferMin} onChange={(ev) => set('bufferMin', Number(ev.target.value))} />
        </Field>
        <Field label={e.description} hint={e.descriptionHint}>
          <textarea rows={3} dir="auto" className={`${inputClass} h-auto py-2`} value={draft.description} onChange={(ev) => set('description', ev.target.value)} />
        </Field>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
          <div>
            <p className="text-sm font-medium text-slate-900">{e.bookable}</p>
            <p className="text-xs text-slate-500">{e.bookableHint}</p>
          </div>
          <Switch checked={draft.active} onChange={(v) => set('active', v)} label={e.bookable} />
        </div>
      </form>
    </Drawer>
  )
}
