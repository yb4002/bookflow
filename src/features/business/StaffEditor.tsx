import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Service, StaffColor, StaffMember, WeeklyHours } from '@/domain/types'
import { BookingError, repo } from '@/data/repositories'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Drawer } from '@/components/ui/Drawer'
import { Field, Input } from '@/components/ui/Input'
import { Segmented } from '@/components/ui/Segmented'
import { useToast } from '@/components/ui/Toast'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { staffColor } from '@/lib/staffColors'
import { HoursEditor } from './HoursEditor'

const COLORS: StaffColor[] = ['indigo', 'teal', 'amber', 'rose']

interface Draft {
  id?: string
  name: string
  role: string
  color: StaffColor
  serviceIds: string[]
  availability?: WeeklyHours
}

/** Add / edit a team member: services they perform and their working hours. */
export function StaffEditor({ draft: initial, services, businessHours, onClose, onSaved }: { draft: Draft | null; services: Service[]; businessHours: WeeklyHours; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const s = t.business.staff
  const toast = useToast()
  const [draft, setDraft] = useState<Draft | null>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    setDraft(initial)
    setError(undefined)
  }, [initial])
  if (!initial || !draft) return null

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v })
  const toggleService = (id: string) => set('serviceIds', draft.serviceIds.includes(id) ? draft.serviceIds.filter((x) => x !== id) : [...draft.serviceIds, id])
  const valid = draft.name.trim().length >= 2

  const save = async () => {
    setSaving(true)
    setError(undefined)
    try {
      const input = { name: draft.name, role: draft.role, color: draft.color, serviceIds: draft.serviceIds, availability: draft.availability }
      if (draft.id) await repo.updateStaff(draft.id, input)
      else await repo.createStaff(input)
      toast(s.saved)
      onSaved()
    } catch (e) {
      setError(e instanceof BookingError && e.code === 'plan_limit' ? t.billing.planLimit : t.toasts.saveFailed)
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    setSaving(true)
    setError(undefined)
    try {
      await repo.deleteStaff(draft.id!)
      toast(s.removed)
      onSaved()
    } catch (e) {
      setError(e instanceof BookingError && e.code === 'in_use' ? s.inUse : t.toasts.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={draft.id ? s.editTitle : s.addTitle}
      footer={
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>{t.services.editor.cancel}</Button>
            <Button className="flex-1" disabled={!valid || saving} onClick={save}>{saving ? s.saving : s.save}</Button>
          </div>
          {draft.id && (
            <Button variant="ghost" size="sm" className="w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700" disabled={saving} onClick={remove}>
              <Trash2 className="size-3.5" /> {s.remove}
            </Button>
          )}
        </div>
      }
    >
      <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
        <Field label={s.name}><Input name="staffName" dir="auto" value={draft.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label={s.role}><Input name="staffRole" dir="auto" placeholder={s.rolePlaceholder} value={draft.role} onChange={(e) => set('role', e.target.value)} /></Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{s.color}</legend>
          <div className="flex gap-2" role="radiogroup" aria-label={s.color}>
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={draft.color === c} aria-label={c} onClick={() => set('color', c)}
                className={cn('size-8 rounded-full ring-2 ring-offset-2 transition', staffColor[c].dot, draft.color === c ? 'ring-slate-900' : 'ring-transparent')} />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{s.services}</legend>
          {services.length === 0 ? (
            <p className="text-sm text-slate-500">{s.noServices}</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {services.map((svc) => (
                <li key={svc.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                    <Checkbox checked={draft.serviceIds.includes(svc.id)} onChange={() => toggleService(svc.id)} label={svc.name} />
                    <span dir="auto" className="text-sm text-slate-800" onClick={() => toggleService(svc.id)}>{svc.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{s.hours}</legend>
          <Segmented
            value={draft.availability ? 'custom' : 'business'}
            onChange={(v) => set('availability', v === 'custom' ? structuredClone(businessHours) : undefined)}
            options={[{ value: 'business', label: s.sameAsBusiness }, { value: 'custom', label: s.custom }]}
          />
          {draft.availability && (
            <div className="-mx-5 mt-3 border-y border-slate-100">
              <HoursEditor value={draft.availability} onChange={(v) => set('availability', v)} idPrefix={`${draft.name || s.name}: `} />
            </div>
          )}
        </fieldset>
      </form>
    </Drawer>
  )
}

/** Opens the staff editor for a new or existing member. */
export function useStaffEditor(services: Service[] | undefined, businessHours: WeeklyHours | undefined, onChanged?: () => void) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const element =
    services && businessHours ? (
      <StaffEditor
        draft={draft}
        services={services}
        businessHours={businessHours}
        onClose={() => setDraft(null)}
        onSaved={() => {
          setDraft(null)
          onChanged?.()
        }}
      />
    ) : null
  return {
    element,
    openNew: (preset: Partial<Draft> = {}) => setDraft({ name: '', role: '', color: COLORS[0], serviceIds: services?.filter((x) => x.active).map((x) => x.id) ?? [], ...preset }),
    openEdit: (m: StaffMember) => setDraft({ id: m.id, name: m.name, role: m.role, color: m.color, serviceIds: [...m.serviceIds], availability: m.availability }),
  }
}
