import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { ApiError, useAuth } from '@/auth/AuthProvider'
import { useDocumentTitle, useI18n } from '@/i18n'
import { AuthLayout, authInputClass } from './AuthLayout'
import { landingFor } from './LoginPage'

export default function ResetPasswordPage() {
  const { t } = useI18n()
  const s = t.auth.reset
  const { resetPassword } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [invalid, setInvalid] = useState(!token)
  const [busy, setBusy] = useState(false)
  useDocumentTitle(s.title)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const me = await resetPassword(token, password)
      navigate(landingFor(me, '/app'), { replace: true })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      if (code === 'invalid_token') setInvalid(true)
      else setError(code === 'weak_password' ? t.auth.signup.errors.weak_password : t.auth.generic)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={s.title} error={invalid ? s.invalid : error} footer={<Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">{t.auth.forgot.back}</Link>}>
      {invalid ? (
        <Link to="/forgot-password" className="mt-5 inline-flex font-semibold text-brand-600 hover:text-brand-700">{s.requestNew}</Link>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
          <Field label={s.password} hint={t.auth.signup.passwordHint}>
            <Input type="password" name="password" autoComplete="new-password" dir="ltr" className={authInputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{s.submit}</Button>
        </form>
      )}
    </AuthLayout>
  )
}
