import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { ApiError, useAuth } from '@/auth/AuthProvider'
import { useDocumentTitle, useI18n } from '@/i18n'
import { AuthLayout, authInputClass } from './AuthLayout'
import { landingFor } from './LoginPage'

type SignupError = keyof ReturnType<typeof useI18n>['t']['auth']['signup']['errors']

export default function SignupPage() {
  const { t, locale } = useI18n()
  const s = t.auth.signup
  const { status, me, signup } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', businessName: '', email: '', password: '' })
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useDocumentTitle(s.title)

  if (status === 'authenticated' && me) return <Navigate to={landingFor(me, '/app')} replace />
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await signup({ ...form, email: form.email.trim(), locale, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      navigate('/onboarding', { replace: true })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      setError(code in s.errors ? s.errors[code as SignupError] : code === 'rate_limited' ? t.auth.rateLimited : t.auth.generic)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={s.title}
      subtitle={s.subtitle}
      error={error}
      footer={<>{s.haveAccount} <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">{t.auth.submit}</Link></>}
    >
      <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
        <Field label={s.name}><Input name="name" autoComplete="name" dir="auto" className="h-11" value={form.name} onChange={set('name')} /></Field>
        <Field label={s.businessName}><Input name="businessName" autoComplete="organization" dir="auto" className="h-11" value={form.businessName} onChange={set('businessName')} /></Field>
        <Field label={t.auth.email}><Input type="email" name="email" autoComplete="username" dir="ltr" className={authInputClass} value={form.email} onChange={set('email')} /></Field>
        <Field label={t.auth.password} hint={s.passwordHint}><Input type="password" name="password" autoComplete="new-password" dir="ltr" className={authInputClass} value={form.password} onChange={set('password')} /></Field>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? s.submitting : s.submit}</Button>
        <p className="text-center text-xs text-slate-500">{s.note}</p>
      </form>
    </AuthLayout>
  )
}
