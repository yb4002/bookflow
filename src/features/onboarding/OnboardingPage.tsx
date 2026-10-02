import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, CheckCircle2, ExternalLink, LogOut, MailCheck, Pencil, Plus, Rocket } from 'lucide-react'
import type { Business, BookingPolicies, CurrencyCode, LanguageCode, Service, StaffMember, WeeklyHours } from '@/domain/types'
import { useAuth } from '@/auth/AuthProvider'
import { Logo } from '@/components/brand/Logo'
import { Ltr } from '@/components/i18n/Ltr'
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher'
import { Button, buttonClass } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, inputClass } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { BookingError, repo, type BusinessUpdate } from '@/data/repositories'
import { ApiError } from '@/data/api/client'
import { useQuery } from '@/hooks/useQuery'
import { LOCALE_CODES, LOCALES, useBusinessLocale, useDocumentTitle, useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { staffColor } from '@/lib/staffColors'
import { bookingPath, bookingUrl } from '@/features/booking/paths'
import { ApplyMondayButton, HoursEditor } from '@/features/business/HoursEditor'
import { ImageUpload } from '@/features/business/ImageUpload'
import { PoliciesEditor } from '@/features/business/PoliciesEditor'
import { useStaffEditor } from '@/features/business/StaffEditor'
import { TimezoneSelect } from '@/features/business/TimezoneSelect'
import { PhoneCountrySelect } from '@/features/business/PhoneCountrySelect'
import type { PhoneCountry } from '@/domain/phone'
import { useServiceEditor } from '@/features/business/useServiceEditor'

const STEPS = ['details', 'branding', 'region', 'hours', 'services', 'team', 'rules', 'publish'] as const
type Step = (typeof STEPS)[number]
const stepKey = (businessId: string) => `bookflow.onboarding.step.${businessId}`

/**
 * Self-service setup wizard. Every step saves to the server before moving on, so the
 * owner can leave and resume (the current step is remembered per business).
 */
export default function OnboardingPage() {
  const { t, fmt } = useI18n()
  const o = t.onboarding
  const { me, logout, refresh } = useAuth()
  const navigate = useNavigate()
  const q = useQuery(() => Promise.all([repo.getBusiness(), repo.listServices(), repo.listStaff()]), [], { refreshOn: ['business', 'services', 'staff'] })
  const [business, services, staff] = q.data ?? []
  useBusinessLocale(business?.settings, { timeZone: business?.timezone })
  useDocumentTitle(o.docTitle)

  const [step, setStep] = useState<Step>('details')
  const [visited, setVisited] = useState<Set<Step>>(new Set(['details']))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  // Resume where the owner left off.
  useEffect(() => {
    if (!me) return
    try {
      const saved = localStorage.getItem(stepKey(me.business.id)) as Step | null
      if (saved && STEPS.includes(saved)) {
        setStep(saved)
        setVisited(new Set(STEPS.slice(0, STEPS.indexOf(saved) + 1)))
      }
    } catch {
      /* storage unavailable */
    }
  }, [me])

  if (me?.business.onboardingCompleted) return <Navigate to="/app" replace />

  const index = STEPS.indexOf(step)
  const go = (next: Step) => {
    setError(undefined)
    setStep(next)
    setVisited((v) => new Set([...v, next]))
    try {
      if (me) localStorage.setItem(stepKey(me.business.id), next)
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  /** Runs a save, then advances. */
  const saveAndNext = async (save?: () => Promise<unknown>) => {
    setSaving(true)
    setError(undefined)
    try {
      await save?.()
      if (index < STEPS.length - 1) go(STEPS[index + 1])
    } catch {
      setError(t.toasts.saveFailed)
    } finally {
      setSaving(false)
    }
  }
  const finish = async (publish: boolean) => {
    setSaving(true)
    setError(undefined)
    try {
      if (publish) await repo.setPublished(true)
      await repo.completeOnboarding()
      await refresh()
      try {
        if (me) localStorage.removeItem(stepKey(me.business.id))
      } catch {
        /* ignore */
      }
      navigate('/app', { replace: true })
    } catch (e) {
      setError(
        e instanceof BookingError && e.code === 'not_ready'
          ? o.publish.notReady
          : e instanceof ApiError && e.code === 'email_unverified'
            ? fmt(o.publish.unverified, { email: me?.user.email ?? '' })
            : t.toasts.saveFailed,
      )
      setSaving(false)
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-1">
            <LanguageSwitcher compact />
            <button type="button" onClick={logout} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={t.auth.logout} title={t.auth.logout}>
              <LogOut className="size-4 rtl:-scale-x-100" />
            </button>
          </div>
        </div>
        {/* Mobile progress */}
        <div className="mx-auto max-w-5xl px-4 pb-3 lg:hidden">
          <p className="text-xs font-medium text-slate-500">{fmt(o.stepOf, { current: index + 1, total: STEPS.length })} · {o.steps[step]}</p>
          <div className="mt-2 flex gap-1" aria-hidden>{STEPS.map((s, i) => <span key={s} className={cn('h-1 flex-1 rounded-full', i <= index ? 'bg-brand-600' : 'bg-slate-200')} />)}</div>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 pt-6 pb-24 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:pt-10">
        {/* Desktop step list */}
        <nav className="hidden lg:block" aria-label={o.docTitle}>
          <ol className="space-y-1">
            {STEPS.map((s, i) => {
              const done = visited.has(s) && i < index
              return (
                <li key={s}>
                  <button
                    type="button"
                    disabled={!visited.has(s)}
                    onClick={() => go(s)}
                    aria-current={s === step ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm transition',
                      s === step ? 'bg-brand-50 font-semibold text-brand-700' : visited.has(s) ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-400',
                    )}
                  >
                    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', done ? 'bg-emerald-500 text-white' : s === step ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500')}>
                      {done ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    {o.steps[s]}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>

        <main className="min-w-0">
          {index === 0 && me && <p className="mb-4 text-sm text-slate-600">{fmt(o.welcome, { name: me.user.name.split(' ')[0], business: me.business.name })}</p>}
          {!business || !services || !staff ? (
            <div className="space-y-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-64" /></div>
          ) : (
            <StepView
              key={step}
              step={step}
              business={business}
              services={services}
              staff={staff}
              ownerName={me?.user.name ?? ''}
              saving={saving}
              error={error}
              onBack={index > 0 ? () => go(STEPS[index - 1]) : undefined}
              onNext={saveAndNext}
              onFinish={finish}
              refetch={q.refetch}
            />
          )}
        </main>
      </div>
    </div>
  )
}

interface StepProps {
  step: Step
  business: Business
  services: Service[]
  staff: StaffMember[]
  ownerName: string
  saving: boolean
  error?: string
  onBack?: () => void
  onNext: (save?: () => Promise<unknown>) => void
  onFinish: (publish: boolean) => void
  refetch: () => void
}

/** Card frame + footer actions shared by every step. */
function Frame({ title, subtitle, children, footer, error }: { title: string; subtitle?: string; children: ReactNode; footer: ReactNode; error?: string }) {
  return (
    <section aria-labelledby="step-title">
      <h1 id="step-title" className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      <div className="mt-6">{children}</div>
      {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">{footer}</div>
    </section>
  )
}

function StepView(props: StepProps) {
  const { t } = useI18n()
  const o = t.onboarding
  const { step, business, saving, onBack, onNext } = props
  const back = onBack ? (
    <Button variant="ghost" onClick={onBack} disabled={saving}><ArrowLeft className="size-4 rtl:-scale-x-100" /> {o.back}</Button>
  ) : <span />
  const next = (save?: () => Promise<unknown>, disabled = false, label = o.continue) => (
    <Button size="lg" onClick={() => onNext(save)} disabled={saving || disabled}>{saving ? o.saving : label}</Button>
  )
  const save = (update: BusinessUpdate) => () => repo.updateBusiness(update)

  switch (step) {
    case 'details':
      return <DetailsStep {...props} back={back} next={next} save={save} />
    case 'branding':
      return (
        <Frame title={o.branding.title} subtitle={o.branding.subtitle} error={props.error} footer={<>{back}<div className="flex gap-2"><Button variant="ghost" onClick={() => onNext()}>{o.skip}</Button>{next()}</div></>}>
          <Card className="grid gap-6 p-5 sm:grid-cols-[auto_1fr]">
            <ImageUpload kind="logo" url={business.logoUrl} label={o.branding.logo} hint={o.branding.logoHint} onUpload={async (d) => void (await repo.setBusinessImage('logo', d))} />
            <ImageUpload kind="cover" url={business.coverUrl} label={o.branding.cover} hint={o.branding.coverHint} onUpload={async (d) => void (await repo.setBusinessImage('cover', d))} />
          </Card>
        </Frame>
      )
    case 'region':
      return <RegionStep {...props} back={back} next={next} save={save} />
    case 'hours':
      return <HoursStep {...props} back={back} next={next} save={save} />
    case 'services':
      return <ServicesStep {...props} back={back} next={next} />
    case 'team':
      return <TeamStep {...props} back={back} next={next} />
    case 'rules':
      return <RulesStep {...props} back={back} next={next} save={save} />
    case 'publish':
      return <PublishStep {...props} back={back} />
  }
}

type Helpers = { back: ReactNode; next: (save?: () => Promise<unknown>, disabled?: boolean, label?: string) => ReactNode; save: (u: BusinessUpdate) => () => Promise<unknown> }

function DetailsStep({ business, error, back, next, save }: StepProps & Helpers) {
  const { t } = useI18n()
  const o = t.onboarding
  const p = t.services.profile
  const [form, setForm] = useState({ name: business.name, category: business.category, description: business.description, phone: business.phone, email: business.email, address: business.address })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Frame title={o.details.title} subtitle={o.details.subtitle} error={error} footer={<>{back}{next(save(form), form.name.trim().length < 2)}</>}>
      <Card className="grid gap-5 p-5 sm:grid-cols-2">
        <Field label={p.name}><Input name="name" dir="auto" value={form.name} onChange={set('name')} /></Field>
        <Field label={o.details.type} hint={o.details.typeHint}>
          <Input name="category" dir="auto" list="business-types" value={form.category} onChange={set('category')} />
          <datalist id="business-types">{o.details.types.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <div className="sm:col-span-2">
          <Field label={t.services.editor.description} hint={t.services.editor.descriptionHint}>
            <textarea name="description" rows={3} dir="auto" value={form.description} onChange={set('description')} className={cn(inputClass, 'h-auto py-2')} />
          </Field>
        </div>
        <Field label={p.phone}><Input name="phone" type="tel" dir="ltr" className="text-start rtl:text-end" value={form.phone} onChange={set('phone')} /></Field>
        <Field label={p.email}><Input name="email" type="email" dir="ltr" className="text-start rtl:text-end" value={form.email} onChange={set('email')} /></Field>
        <div className="sm:col-span-2"><Field label={p.address}><Input name="address" dir="auto" value={form.address} onChange={set('address')} /></Field></div>
      </Card>
    </Frame>
  )
}

function RegionStep({ business, error, back, next, save }: StepProps & Helpers) {
  const { t } = useI18n()
  const o = t.onboarding
  const p = t.services.profile
  const [lang, setLang] = useState<LanguageCode>(business.settings.defaultLanguage)
  const [currency, setCurrency] = useState<'auto' | CurrencyCode>(business.settings.currency)
  const [tz, setTz] = useState(business.timezone)
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountry>(business.settings.phoneCountry ?? 'US')
  return (
    <Frame title={o.region.title} subtitle={o.region.subtitle} error={error} footer={<>{back}{next(save({ settings: { defaultLanguage: lang, currency, phoneCountry }, timezone: tz }))}</>}>
      <Card className="grid gap-5 p-5 sm:grid-cols-2">
        <Field label={p.defaultLanguage} hint={p.defaultLanguageHint}>
          <select name="defaultLanguage" value={lang} onChange={(e) => setLang(e.target.value as LanguageCode)} className={inputClass}>
            {LOCALE_CODES.map((c) => <option key={c} value={c}>{LOCALES[c].nativeName}</option>)}
          </select>
        </Field>
        <Field label={p.currency}>
          <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value as 'auto' | CurrencyCode)} className={inputClass}>
            <option value="auto">{p.currencyAuto}</option>
            <option value="USD">{p.currencyUSD}</option>
            <option value="ILS">{p.currencyILS}</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label={o.region.timezone} hint={o.region.timezoneHint}><TimezoneSelect value={tz} onChange={setTz} /></Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={o.region.phoneCountry} hint={o.region.phoneCountryHint}><PhoneCountrySelect value={phoneCountry} onChange={setPhoneCountry} /></Field>
        </div>
      </Card>
    </Frame>
  )
}

function HoursStep({ business, error, back, next, save }: StepProps & Helpers) {
  const { t } = useI18n()
  const o = t.onboarding
  const [hours, setHours] = useState<WeeklyHours>(business.hours)
  return (
    <Frame title={o.hours.title} subtitle={o.hours.subtitle} error={error} footer={<>{back}{next(save({ hours }))}</>}>
      <Card>
        <div className="flex justify-end px-3 pt-3"><ApplyMondayButton value={hours} onChange={setHours} /></div>
        <HoursEditor value={hours} onChange={setHours} />
      </Card>
    </Frame>
  )
}

function ServicesStep({ services, error, back, next, refetch }: StepProps & Omit<Helpers, 'save'>) {
  const { t, f } = useI18n()
  const o = t.onboarding
  const editor = useServiceEditor(refetch)
  return (
    <Frame title={o.services.title} subtitle={o.services.subtitle} error={error} footer={<>{back}<div className="flex items-center gap-3">{!services.length && <span className="text-xs text-slate-500">{o.services.needOne}</span>}{next(undefined, services.length === 0)}</div></>}>
      <Card className="overflow-hidden">
        {services.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">{o.services.empty}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {services.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate font-medium text-slate-900 rtl:text-right">{s.name}</p>
                  <p className="text-xs text-slate-500">{f.duration(s.durationMin)} · {f.money(s.price)}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => editor.openEdit(s)} aria-label={`${t.business.staff.edit} ${s.name}`}><Pencil className="size-4" /></Button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-slate-100 p-3">
          <Button variant="secondary" onClick={editor.openNew}><Plus className="size-4" /> {t.services.list.add}</Button>
        </div>
      </Card>
      {editor.element}
    </Frame>
  )
}

function TeamStep({ business, services, staff, ownerName, error, back, next, refetch }: StepProps & Omit<Helpers, 'save'>) {
  const { t, fmt } = useI18n()
  const o = t.onboarding
  const editor = useStaffEditor(services, business.hours, refetch)
  const ready = staff.some((m) => m.serviceIds.length > 0)
  const ownerAdded = staff.some((m) => m.name === ownerName)
  return (
    <Frame title={o.team.title} subtitle={o.team.subtitle} error={error} footer={<>{back}<div className="flex items-center gap-3">{!ready && <span className="text-xs text-slate-500">{o.team.needOne}</span>}{next(undefined, !ready)}</div></>}>
      <Card className="overflow-hidden">
        {staff.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">{o.team.empty}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {staff.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold', staffColor[m.color].soft)}>{m.avatarInitials}</span>
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate font-medium text-slate-900 rtl:text-right">{m.name}</p>
                  <p className="text-xs text-slate-500">{m.availability ? t.business.staff.worksCustom : t.business.staff.worksAll}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => editor.openEdit(m)} aria-label={`${t.business.staff.edit} ${m.name}`}><Pencil className="size-4" /></Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 border-t border-slate-100 p-3">
          {!ownerAdded && ownerName && <Button variant="secondary" onClick={() => editor.openNew({ name: ownerName })}><Plus className="size-4" /> {fmt(o.team.addMe, { name: ownerName.split(' ')[0] })}</Button>}
          <Button variant="secondary" onClick={() => editor.openNew()}><Plus className="size-4" /> {t.business.staff.add}</Button>
        </div>
      </Card>
      {editor.element}
    </Frame>
  )
}

function RulesStep({ business, error, back, next, save }: StepProps & Helpers) {
  const { t } = useI18n()
  const o = t.onboarding
  const [policies, setPolicies] = useState<BookingPolicies>(business.policies)
  return (
    <Frame title={o.rules.title} subtitle={o.rules.subtitle} error={error} footer={<>{back}{next(save({ policies }))}</>}>
      <PoliciesEditor value={policies} onChange={setPolicies} />
    </Frame>
  )
}

function PublishStep({ business, saving, error, back, onFinish }: StepProps & Pick<Helpers, 'back'>) {
  const { t } = useI18n()
  const o = t.onboarding
  const p = t.services.profile
  const { me } = useAuth()
  const verified = me?.user.emailVerified !== false
  const [slug, setSlug] = useState(business.slug)
  const [slugError, setSlugError] = useState<string>()
  const [savingSlug, setSavingSlug] = useState(false)
  const saveSlug = async () => {
    setSavingSlug(true)
    setSlugError(undefined)
    try {
      await repo.updateBusiness({ slug: slug.trim().toLowerCase() })
    } catch (e) {
      setSlugError(e instanceof BookingError && e.code === 'slug_taken' ? p.slugTaken : p.slugInvalid)
    } finally {
      setSavingSlug(false)
    }
  }
  return (
    <Frame
      title={o.publish.title}
      subtitle={o.publish.subtitle}
      error={error}
      footer={
        <>
          {back}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={saving} onClick={() => onFinish(false)}>{o.publish.later}</Button>
            <Button size="lg" disabled={saving || !verified} onClick={() => onFinish(true)}><Rocket className="size-4" /> {saving ? o.publish.publishing : o.publish.publish}</Button>
          </div>
        </>
      }
    >
      <EmailCheck />
      <Card className="space-y-5 p-5">
        <Field label={o.publish.link} hint={slugError ? undefined : p.bookingUrlHint}>
          <div className="flex gap-2" dir="ltr">
            <div className="flex min-w-0 flex-1">
              <span className="inline-flex max-w-[50%] items-center truncate rounded-l-lg bg-slate-50 px-3 text-sm text-slate-500 ring-1 ring-slate-200 ring-inset"><Ltr>{`${window.location.host}/book/`}</Ltr></span>
              <Input name="slug" value={slug} onChange={(e) => setSlug(e.target.value)} aria-invalid={!!slugError} className={cn('-ml-px rounded-l-none', slugError && 'ring-rose-400')} />
            </div>
            {slug !== business.slug && <Button variant="secondary" disabled={savingSlug} onClick={saveSlug}>{t.business.staff.save}</Button>}
          </div>
        </Field>
        {slugError && <p role="alert" className="-mt-3 text-xs text-rose-600">{slugError}</p>}
        <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200" dir="ltr">
          <span className="font-mono text-xs break-all">{bookingUrl(business.slug)}</span>
        </div>
        <a href={bookingPath(business.slug)} target="_blank" rel="noopener" className={buttonClass('secondary')}>
          <ExternalLink className="size-4" /> {o.publish.preview}
        </a>
      </Card>
    </Frame>
  )
}

/**
 * Publishing needs a confirmed email address. Shows where the link went, re-sends it, and
 * re-checks when the owner comes back from their inbox (tab focus) or says they've confirmed.
 */
function EmailCheck() {
  const { t, fmt, locale } = useI18n()
  const o = t.onboarding.publish
  const { me, refresh, resendVerification } = useAuth()
  const [sent, setSent] = useState(false)
  const [checking, setChecking] = useState(false)
  const unverified = me?.user.emailVerified === false
  useEffect(() => {
    if (!unverified) return
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [unverified, refresh])
  if (!me) return null
  if (!unverified) {
    return (
      <p role="status" className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> {o.verified}
      </p>
    )
  }
  return (
    <Card className="mb-4 space-y-3 p-5 ring-amber-200" data-testid="email-check">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600"><MailCheck className="size-5" /></span>
        <div>
          <p className="text-sm font-semibold text-slate-900">{o.verifyTitle}</p>
          <p className="mt-1 text-sm text-slate-600">{fmt(o.verifyBody, { email: me.user.email })}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 ps-12">
        <Button
          size="sm"
          variant="secondary"
          disabled={checking}
          onClick={async () => {
            setChecking(true)
            await refresh().finally(() => setChecking(false))
          }}
        >
          {o.verifyCheck}
        </Button>
        {sent ? (
          <span role="status" className="text-xs text-slate-600">{o.verifySent}</span>
        ) : (
          <Button size="sm" variant="ghost" onClick={async () => (await resendVerification(locale).catch(() => undefined), setSent(true))}>{o.verifyResend}</Button>
        )}
      </div>
    </Card>
  )
}
