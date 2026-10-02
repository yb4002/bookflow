import { useState, type FormEvent } from 'react'
import { BadgeCheck, LogOut, MailWarning } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Ltr } from '@/components/i18n/Ltr'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { ApiError, useAuth } from '@/auth/AuthProvider'
import { useDocumentTitle, useI18n } from '@/i18n'

/** Your own login: name, email status, password, other devices, businesses. */
export default function AccountPage() {
  const { t, plural, locale } = useI18n()
  const a = t.account
  const toast = useToast()
  const { me, updateName, changePassword, signOutOthers, switchBusiness, resendVerification } = useAuth()
  const [name, setName] = useState(me?.user.name ?? '')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [pwError, setPwError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  useDocumentTitle(a.title)
  if (!me) return null

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(undefined)
    }
  }
  const savePassword = (e: FormEvent) => {
    e.preventDefault()
    setPwError(undefined)
    void run('password', async () => {
      try {
        await changePassword(current, next)
        setCurrent('')
        setNext('')
        toast(a.passwordChanged)
      } catch (err) {
        const code = err instanceof ApiError ? err.code : ''
        setPwError(code === 'wrong_password' ? a.wrongPassword : code === 'weak_password' ? a.weakPassword : t.auth.generic)
      }
    })
  }

  return (
    <>
      <PageHeader title={a.title} description={a.description} />
      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader title={a.profile} />
          <form
            className="grid gap-4 p-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              void run('name', async () => {
                await updateName(name)
                toast(a.nameSaved)
              })
            }}
          >
            <Field label={a.name}><Input name="name" dir="auto" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">{a.email}</span>
              <p className="flex h-10 items-center gap-2 text-sm text-slate-700">
                <Ltr>{me.user.email}</Ltr>
                {me.user.emailVerified ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><BadgeCheck className="size-4" /> {a.verified}</span>
                ) : (
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 underline underline-offset-2" onClick={() => run('verify', async () => (await resendVerification(locale), toast(a.resent)))}>
                    <MailWarning className="size-4" /> {a.notVerified} · {a.resend}
                  </button>
                )}
              </p>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy === 'name' || name.trim() === me.user.name || name.trim().length < 2}>{a.saveName}</Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title={a.password} description={a.passwordHint} />
          <form className="grid gap-4 p-5 sm:grid-cols-2" onSubmit={savePassword} noValidate>
            <Field label={a.currentPassword}><Input type="password" name="currentPassword" autoComplete="current-password" dir="ltr" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
            <Field label={a.newPassword}><Input type="password" name="newPassword" autoComplete="new-password" dir="ltr" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
            {pwError && <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{pwError}</p>}
            <div className="sm:col-span-2"><Button type="submit" disabled={busy === 'password' || !current || !next}>{a.savePassword}</Button></div>
          </form>
        </Card>

        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="max-w-md">
            <p className="text-sm font-semibold text-slate-900">{a.devices}</p>
            <p className="text-xs text-slate-500">{a.devicesBody}</p>
          </div>
          <Button variant="secondary" disabled={busy === 'devices'} onClick={() => run('devices', async () => toast(plural(a.signedOutOthers, await signOutOthers())))}>
            <LogOut className="size-4 rtl:-scale-x-100" /> {a.signOutOthers}
          </Button>
        </Card>

        {(me.businesses?.length ?? 0) > 1 && (
          <Card>
            <CardHeader title={a.businesses} />
            <ul className="divide-y divide-slate-100">
              {me.businesses!.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p dir="auto" className="truncate text-sm font-medium text-slate-900 rtl:text-right">{b.name}</p>
                    <p className="text-xs text-slate-500">{t.team.roleShort[b.role]}</p>
                  </div>
                  {b.id === me.business.id ? (
                    <span className="text-xs font-semibold text-brand-700">{a.current}</span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => void switchBusiness(b.id)}>{a.switchTo}</Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  )
}
