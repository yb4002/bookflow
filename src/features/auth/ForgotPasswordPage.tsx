import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { ApiError, useAuth } from '@/auth/AuthProvider'
import { useDocumentTitle, useI18n } from '@/i18n'
import { AuthLayout, authInputClass } from './AuthLayout'

export default function ForgotPasswordPage() {
  const { t, fmt, locale } = useI18n()
  const s = t.auth.forgot
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useDocumentTitle(s.title)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return setError(t.auth.signup.errors.invalid_email)
    setBusy(true)
    setError(undefined)
    try {
      await requestPasswordReset(email.trim(), locale)
      setSentTo(email.trim())
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'rate_limited' ? t.auth.rateLimited : t.auth.generic)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={s.title} subtitle={sentTo ? undefined : s.subtitle} error={error} footer={<Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">{s.back}</Link>}>
      {sentTo ? (
        <p role="status" className="mt-5 flex gap-3 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          {fmt(s.sent, { email: sentTo })}
        </p>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
          <Field label={t.auth.email}><Input type="email" name="email" autoComplete="username" dir="ltr" className={authInputClass} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{s.submit}</Button>
        </form>
      )}
    </AuthLayout>
  )
}
