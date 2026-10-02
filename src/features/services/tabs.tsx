import { useEffect, useState, type FormEvent } from 'react'
import { Clock, ExternalLink, EyeOff, Globe, Pencil, Plus } from 'lucide-react'
import type { Business, BusinessSettings, BookingPolicies, LanguageCode, Service, StaffMember } from '@/domain/types'
import { BookingError, repo, type BookingErrorCode, type BusinessUpdate } from '@/data/repositories'
import { ApiError } from '@/data/api/client'
import { Ltr } from '@/components/i18n/Ltr'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field, Input, inputClass } from '@/components/ui/Input'
import { Switch } from '@/components/ui/Switch'
import { useToast } from '@/components/ui/Toast'
import { LOCALE_CODES, LOCALES, useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { staffColor } from '@/lib/staffColors'
import { bookingPath } from '@/features/booking/paths'
import { ApplyMondayButton, HoursEditor } from '@/features/business/HoursEditor'
import { ImageUpload } from '@/features/business/ImageUpload'
import { PoliciesEditor } from '@/features/business/PoliciesEditor'
import { useStaffEditor } from '@/features/business/StaffEditor'
import { TimezoneSelect } from '@/features/business/TimezoneSelect'
import { TeamAccess } from '@/features/business/TeamAccess'
import { useAuth } from '@/auth/AuthProvider'
import { PhoneCountrySelect } from '@/features/business/PhoneCountrySelect'

/* ---------------- Services ---------------- */

export function ServicesTab({ services, onEdit, onToggle, onAdd }: { services: Service[]; onEdit: (s: Service) => void; onToggle: (s: Service) => void; onAdd: () => void }) {
  const { t, f, fmt, plural } = useI18n()
  const l = t.services.list
  const categories = [...new Set(services.map((s) => s.category))]
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={onAdd}><Plus className="size-4" /> {l.add}</Button>
      </div>
      {categories.map((cat) => (
        <Card key={cat} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-900">{cat}</h3>
            <span className="text-xs text-slate-500">{plural(l.count, services.filter((s) => s.category === cat).length)}</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {services.filter((s) => s.category === cat).map((s) => (
              <li key={s.id} className="flex items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn('font-medium', s.active ? 'text-slate-900' : 'text-slate-400')}>{s.name}</p>
                    {!s.active && <Badge>{l.hidden}</Badge>}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">{s.description}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-500 sm:hidden"><Clock className="size-3" /> {f.duration(s.durationMin)} · {f.money(s.price)}</p>
                </div>
                <div className="hidden w-24 text-sm text-slate-600 sm:block"><Clock className="me-1 inline size-3.5 text-slate-400" />{f.duration(s.durationMin)}</div>
                <div className="hidden w-16 text-end text-sm font-semibold text-slate-900 tabular-nums sm:block">{f.money(s.price)}</div>
                <Switch checked={s.active} onChange={() => onToggle(s)} label={fmt(l.bookableAria, { name: s.name })} />
                <button onClick={() => onEdit(s)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={fmt(l.editAria, { name: s.name })}>
                  <Pencil className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}

/* ---------------- Team ---------------- */

export function TeamTab({ staff, services, business }: { staff: StaffMember[]; services: Service[]; business: Business }) {
  const { t, plural } = useI18n()
  const editor = useStaffEditor(services, business.hours)
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => editor.openNew()}><Plus className="size-4" /> {t.business.staff.add}</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {staff.map((m) => (
          <Card key={m.id} className="p-5">
            <div className="flex items-center gap-3">
              <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-full text-base font-semibold', staffColor[m.color].soft)}>{m.avatarInitials}</span>
              <div className="min-w-0 flex-1">
                <p dir="auto" className="truncate font-semibold text-slate-900 rtl:text-right">{m.name}</p>
                <p dir="auto" className="truncate text-sm text-slate-500 rtl:text-right">{m.role}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => editor.openEdit(m)} aria-label={`${t.business.staff.edit} ${m.name}`}><Pencil className="size-4" /></Button>
            </div>
            <p className="mt-5 text-xs font-medium text-slate-500">{plural(t.services.team.performs, m.serviceIds.length)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.serviceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean).map((s) => <Badge key={s!.id}>{s!.name}</Badge>)}
            </div>
            <p className="mt-3 text-xs text-slate-500">{m.availability ? t.business.staff.worksCustom : t.business.staff.worksAll}</p>
          </Card>
        ))}
      </div>
      {editor.element}
      <TeamAccess staff={staff} />
    </div>
  )
}

/* ---------------- Hours ---------------- */

/** Saves business settings through the repository with consistent feedback. */
function useSaveBusiness() {
  const toast = useToast()
  const { t } = useI18n()
  const [saving, setSaving] = useState(false)
  const save = async (update: BusinessUpdate, successMessage: string): Promise<BookingErrorCode | null> => {
    setSaving(true)
    try {
      await repo.updateBusiness(update)
      toast(successMessage)
      return null
    } catch (e) {
      toast(t.toasts.saveFailed)
      return e instanceof BookingError ? e.code : 'invalid_input'
    } finally {
      setSaving(false)
    }
  }
  return { save, saving }
}

export function HoursTab({ business }: { business: Business }) {
  const { t } = useI18n()
  const s = t.services.hours
  const { save, saving } = useSaveBusiness()
  const [hours, setHours] = useState(business.hours)
  useEffect(() => setHours(business.hours), [business])
  return (
    <Card>
      <CardHeader title={s.title} description={s.subtitle} action={<ApplyMondayButton value={hours} onChange={setHours} />} />
      <div className="mt-3"><HoursEditor value={hours} onChange={setHours} /></div>
      <div className="flex justify-end border-t border-slate-100 p-4">
        <Button disabled={saving} onClick={() => save({ hours }, t.toasts.hoursSaved)}>{s.save}</Button>
      </div>
    </Card>
  )
}

/* ---------------- Policies ---------------- */

export function PoliciesTab({ business }: { business: Business }) {
  const { t } = useI18n()
  const { save, saving } = useSaveBusiness()
  const [p, setP] = useState<BookingPolicies>(business.policies)
  useEffect(() => setP(business.policies), [business])
  return (
    <PoliciesEditor
      value={p}
      onChange={setP}
      footer={
        <div className="flex justify-end border-t border-slate-100 p-4">
          <Button disabled={saving} onClick={() => save({ policies: p }, t.toasts.policiesSaved)}>{t.services.policies.save}</Button>
        </div>
      }
    />
  )
}

/* ---------------- Profile ---------------- */

type ProfileForm = Pick<Business, 'name' | 'category' | 'description' | 'phone' | 'email' | 'address' | 'slug' | 'timezone'> & BusinessSettings

const toForm = (b: Business): ProfileForm => ({
  name: b.name,
  category: b.category,
  description: b.description,
  phone: b.phone,
  email: b.email,
  address: b.address,
  slug: b.slug,
  timezone: b.timezone,
  defaultLanguage: b.settings.defaultLanguage,
  currency: b.settings.currency,
  phoneCountry: b.settings.phoneCountry ?? 'US',
})

export function ProfileTab({ business }: { business: Business }) {
  const { t } = useI18n()
  const { me } = useAuth()
  const s = t.services.profile
  const toast = useToast()
  const { save, saving } = useSaveBusiness()
  const [form, setForm] = useState<ProfileForm>(() => toForm(business))
  const [slugError, setSlugError] = useState<string>()
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  useEffect(() => setForm(toForm(business)), [business])
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSlugError(undefined)
    const { defaultLanguage, currency, phoneCountry, ...profile } = form
    const error = await save({ ...profile, slug: profile.slug.trim().toLowerCase(), settings: { defaultLanguage, currency, phoneCountry } }, t.toasts.profileSaved)
    if (error === 'invalid_slug') setSlugError(s.slugInvalid)
    if (error === 'slug_taken') setSlugError(s.slugTaken)
  }

  const reset = async () => {
    setResetting(true)
    await repo.resetDemoData()
    setResetting(false)
    setConfirmReset(false)
    toast(t.toasts.demoReset)
  }

  return (
    <div className="space-y-4">
      <PublishCard business={business} />
      <Card>
        <CardHeader title={t.onboarding.branding.title} description={t.onboarding.branding.subtitle} />
        <div className="grid gap-6 p-5 sm:grid-cols-[auto_1fr]">
          <ImageUpload kind="logo" url={business.logoUrl} label={t.onboarding.branding.logo} hint={t.onboarding.branding.logoHint} onUpload={async (d) => void (await repo.setBusinessImage('logo', d))} />
          <ImageUpload kind="cover" url={business.coverUrl} label={t.onboarding.branding.cover} hint={t.onboarding.branding.coverHint} onUpload={async (d) => void (await repo.setBusinessImage('cover', d))} />
        </div>
      </Card>
      <Card>
        <CardHeader title={s.title} description={s.subtitle} />
        <form id="profile-form" className="grid gap-5 p-5 sm:grid-cols-2" onSubmit={submit}>
          <Field label={s.name}><Input dir="auto" value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label={s.category}><Input dir="auto" value={form.category} onChange={(e) => set('category', e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label={t.services.editor.description} hint={t.services.editor.descriptionHint}>
              <textarea rows={3} dir="auto" value={form.description} onChange={(e) => set('description', e.target.value)} className={cn(inputClass, 'h-auto py-2')} />
            </Field>
          </div>
          {/* Phone, email and URL are LTR data even in RTL layouts. */}
          <Field label={s.phone}><Input type="tel" dir="ltr" className="text-start rtl:text-end" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label={s.email}><Input type="email" dir="ltr" className="text-start rtl:text-end" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <div className="sm:col-span-2"><Field label={s.address}><Input dir="auto" value={form.address} onChange={(e) => set('address', e.target.value)} /></Field></div>
          <div className="sm:col-span-2">
            <Field label={s.bookingUrl} hint={slugError ? undefined : s.bookingUrlHint}>
              <div className="flex" dir="ltr">
                <span className="inline-flex max-w-[55%] items-center truncate rounded-l-lg bg-slate-50 px-3 text-sm text-slate-500 ring-1 ring-slate-200 ring-inset"><Ltr>{`${window.location.host}/book/`}</Ltr></span>
                <Input
                  name="slug"
                  value={form.slug}
                  onChange={(e) => set('slug', e.target.value)}
                  aria-invalid={!!slugError}
                  className={cn('-ml-px rounded-l-none', slugError && 'ring-rose-400')}
                />
              </div>
            </Field>
            {slugError && <p role="alert" className="mt-1 text-xs text-rose-600">{slugError}</p>}
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title={s.localeTitle} description={s.localeSubtitle} />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label={s.defaultLanguage} hint={s.defaultLanguageHint}>
            <select name="defaultLanguage" form="profile-form" value={form.defaultLanguage} onChange={(e) => set('defaultLanguage', e.target.value as LanguageCode)} className={inputClass}>
              {LOCALE_CODES.map((code) => <option key={code} value={code}>{LOCALES[code].nativeName}</option>)}
            </select>
          </Field>
          <Field label={t.onboarding.region.timezone} hint={t.onboarding.region.timezoneHint}>
            <TimezoneSelect value={form.timezone} onChange={(tz) => set('timezone', tz)} />
          </Field>
          <Field label={t.onboarding.region.phoneCountry} hint={t.onboarding.region.phoneCountryHint}>
            <PhoneCountrySelect value={form.phoneCountry ?? 'US'} onChange={(c) => set('phoneCountry', c)} />
          </Field>
          <Field label={s.currency}>
            <select name="currency" form="profile-form" value={form.currency} onChange={(e) => set('currency', e.target.value as ProfileForm['currency'])} className={inputClass}>
              <option value="auto">{s.currencyAuto}</option>
              <option value="USD">{s.currencyUSD}</option>
              <option value="ILS">{s.currencyILS}</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-end border-t border-slate-100 p-4">
          <Button type="submit" form="profile-form" disabled={saving}>{s.save}</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title={s.dataTitle} description={s.dataSaved} />
        {me?.business.demo && <div className="p-5 pt-4">
          {!confirmReset ? (
            <Button variant="danger" size="sm" onClick={() => setConfirmReset(true)}>{s.reset}</Button>
          ) : (
            <div className="rounded-lg bg-rose-50 p-4 ring-1 ring-rose-200" role="alertdialog" aria-labelledby="reset-title">
              <p id="reset-title" className="text-sm font-semibold text-slate-900">{s.resetConfirmTitle}</p>
              <p className="mt-1 text-sm text-slate-600">{s.resetConfirmBody}</p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setConfirmReset(false)} disabled={resetting}>{s.resetCancel}</Button>
                <Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={reset} disabled={resetting}>{resetting ? s.resetting : s.resetConfirm}</Button>
              </div>
            </div>
          )}
        </div>}
      </Card>
    </div>
  )
}

/** Publishing status + publish / unpublish + preview of the public booking page. */
function PublishCard({ business }: { business: Business }) {
  const { t, fmt } = useI18n()
  const { me } = useAuth()
  const s = t.business.publishing
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const live = !!business.publishedAt
  const toggle = async () => {
    setBusy(true)
    try {
      await repo.setPublished(!live)
      toast(live ? s.unpublished : s.published)
    } catch (e) {
      toast(
        e instanceof BookingError && e.code === 'not_ready'
          ? t.onboarding.publish.notReady
          : e instanceof ApiError && e.code === 'email_unverified'
            ? fmt(t.onboarding.publish.unverified, { email: me?.user.email ?? '' })
            : t.toasts.saveFailed,
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="flex items-center gap-3">
        <span className={cn('flex size-10 items-center justify-center rounded-full', live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
          {live ? <Globe className="size-5" /> : <EyeOff className="size-5" />}
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">{s.title}</p>
          <p className="text-xs text-slate-500" data-testid="publish-status">{live ? s.live : s.draft}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <a href={bookingPath(business.slug)} target="_blank" rel="noopener" className={buttonClass('secondary', 'sm')}><ExternalLink className="size-3.5" /> {s.preview}</a>
        <Button size="sm" variant={live ? 'secondary' : 'primary'} disabled={busy} onClick={toggle}>{live ? s.unpublish : s.publish}</Button>
      </div>
    </Card>
  )
}
