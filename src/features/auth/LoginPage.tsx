import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { ApiError, AuthError, useAuth, type Me } from '@/auth/AuthProvider'
import { useDocumentTitle, useI18n } from '@/i18n'
import { AuthLayout, authInputClass } from './AuthLayout'

/** Only allow redirects back into the app (never to another site). */
export const safeNext = (next: string | null) => (next && next.startsWith('/app') ? next : '/app')
/** Where a signed-in user belongs: setup first, then the requested page. */
export const landingFor = (me: Me, next: string) => (me.business.onboardingCompleted || me.role !== 'owner' ? next : '/onboarding')

export default function LoginPage() {
  const { t } = useI18n()
  const s = t.auth
  const { status, me, login, demoLogin, demoMode, expired } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNext(params.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<'login' | 'demo' | null>(null)
  useDocumentTitle(s.title)

  if (status === 'authenticated' && me) return <Navigate to={landingFor(me, next)} replace />

  const run = async (kind: 'login' | 'demo', fn: () => Promise<Me>) => {
    setBusy(kind)
    setError(undefined)
    try {
      navigate(landingFor(await fn(), next), { replace: true })
    } catch (e) {
      setError(e instanceof AuthError ? s.invalid : e instanceof ApiError && e.code === 'rate_limited' ? s.rateLimited : s.generic)
    } finally {
      setBusy(null)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!email || !password) return setError(s.invalid)
    void run('login', () => login(email.trim(), password))
  }

  return (
    <AuthLayout
      title={s.title}
      subtitle={s.subtitle}
      error={error ?? (expired ? s.sessionExpired : undefined)}
      footer={<>{s.noAccount} <Link to="/signup" className="font-semibold text-brand-600 hover:text-brand-700">{s.createAccount}</Link></>}
    >
      <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
        <Field label={s.email}>
          <Input type="email" name="email" autoComplete="username" dir="ltr" className={authInputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={s.password}>
          <Input type="password" name="password" autoComplete="current-password" dir="ltr" className={authInputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-xs font-semibold text-brand-600 hover:text-brand-700">{s.forgotLink}</Link>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={busy !== null}>{busy === 'login' ? s.submitting : s.submit}</Button>
      </form>

      {demoMode && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />{s.or}<span className="h-px flex-1 bg-slate-200" />
          </div>
          <Button variant="secondary" size="lg" className="w-full" disabled={busy !== null} onClick={() => run('demo', demoLogin)}>
            <Sparkles className="size-4 text-brand-600" /> {s.demo}
          </Button>
          <p className="mt-2 text-center text-xs text-slate-500">{s.demoHint}</p>
        </>
      )}
    </AuthLayout>
  )
}
