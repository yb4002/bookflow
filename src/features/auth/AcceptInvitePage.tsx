import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { ApiError, useAuth, type InvitationInfo } from '@/auth/AuthProvider'
import { useDocumentTitle, useI18n } from '@/i18n'
import { AuthLayout, authInputClass } from './AuthLayout'

/** /accept-invite?token=… — join a business's team (new login, or an existing account's password). */
export default function AcceptInvitePage() {
  const { t, fmt } = useI18n()
  const s = t.invite
  const { describeInvitation, acceptInvitation } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [info, setInfo] = useState<InvitationInfo | null>(null)
  const [invalid, setInvalid] = useState(!token)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useDocumentTitle(s.docTitle)

  // Looked up once per link (not again when the auth context re-renders).
  const looked = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!token || looked.current === token) return
    looked.current = token
    describeInvitation(token).then(setInfo, () => setInvalid(true))
  }, [token, describeInvitation])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await acceptInvitation(token, password, info?.existingUser ? undefined : name)
      navigate('/app', { replace: true })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      if (code === 'invalid_token') setInvalid(true)
      else setError(code === 'wrong_password' ? s.wrongPassword : code === 'weak_password' ? s.weakPassword : code === 'invalid_name' ? s.invalidName : t.auth.generic)
    } finally {
      setBusy(false)
    }
  }

  if (invalid) return <AuthLayout title={s.docTitle} error={s.invalid}>{null}</AuthLayout>
  if (!info) {
    return (
      <AuthLayout title={s.docTitle}>
        <div className="mt-5 space-y-3"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-11" /><Skeleton className="h-11" /></div>
      </AuthLayout>
    )
  }
  return (
    <AuthLayout title={fmt(s.title, { business: info.businessName })} subtitle={fmt(s.subtitle, { role: t.team.roleShort[info.role], email: info.email })} error={error}>
      <p className="mt-4 text-sm text-slate-600">{info.existingUser ? s.existingAccount : s.newAccount}</p>
      <form className="mt-4 space-y-4" onSubmit={submit} noValidate>
        {!info.existingUser && (
          <Field label={s.name}>
            <Input name="name" autoComplete="name" dir="auto" className={authInputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label={s.password} hint={info.existingUser ? undefined : t.auth.signup.passwordHint}>
          <Input type="password" name="password" autoComplete={info.existingUser ? 'current-password' : 'new-password'} dir="ltr" className={authInputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? s.accepting : s.accept}</Button>
      </form>
    </AuthLayout>
  )
}
