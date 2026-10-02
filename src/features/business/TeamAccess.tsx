import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { MailPlus, Trash2, X } from 'lucide-react'
import type { StaffMember } from '@/domain/types'
import { api, ApiError } from '@/data/api/client'
import { Ltr } from '@/components/i18n/Ltr'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field, Input, inputClass } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/AuthProvider'
import { useI18n } from '@/i18n'

type Role = 'owner' | 'staff'
interface Member { userId: string; name: string; email: string; role: Role; staffId?: string; lastLoginAt?: string }
interface Invitation { id: string; email: string; role: Role; staffId?: string; expiresAt: string }

/** Owners: who can sign in to this business, invitations, roles and removing access. */
export function TeamAccess({ staff }: { staff: StaffMember[] }) {
  const { t, f, fmt, locale } = useI18n()
  const s = t.team
  const toast = useToast()
  const { me } = useAuth()
  const [data, setData] = useState<{ members: Member[]; invitations: Invitation[] }>()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('staff')
  const [staffId, setStaffId] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api<{ members: Member[]; invitations: Invitation[] }>('GET', '/app/team').then(setData), [])
  useEffect(() => void load(), [load])

  const fail = (e: unknown) => {
    const code = e instanceof ApiError ? e.code : ''
    setError(code in s.errors ? s.errors[code as keyof typeof s.errors] : s.errors.generic)
  }
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
      toast(msg)
      await load()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  const sendInvite = (e: FormEvent) => {
    e.preventDefault()
    const to = email.trim()
    void run(() => api('POST', '/app/team/invitations', { email: to, role, staffId: staffId || undefined, locale }), fmt(s.sent, { email: to })).then(() => setEmail(''))
  }
  const staffName = (id?: string) => staff.find((m) => m.id === id)?.name

  return (
    <Card>
      <CardHeader title={s.title} description={s.subtitle} />
      {error && <p role="alert" className="mx-5 mt-3 rounded-lg bg-rose-50 p-2.5 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
      <ul className="mt-3 divide-y divide-slate-100">
        {data?.members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3" data-testid="team-member">
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate text-sm font-semibold text-slate-900 rtl:text-right">{m.name}{m.userId === me?.user.id && <span className="ms-1.5 text-xs font-normal text-slate-500">({s.you})</span>}</p>
              <p className="truncate text-xs text-slate-500"><Ltr>{m.email}</Ltr> · {m.lastLoginAt ? fmt(s.lastLogin, { when: f.relative(m.lastLoginAt) }) : s.never}</p>
            </div>
            <select
              aria-label={`${s.role}: ${m.name}`}
              className={`${inputClass} h-9 w-auto`}
              value={m.role}
              disabled={busy}
              onChange={(e) => run(() => api('PATCH', `/app/team/members/${m.userId}`, { role: e.target.value }), t.toasts.profileSaved)}
            >
              <option value="owner">{s.roleShort.owner}</option>
              <option value="staff">{s.roleShort.staff}</option>
            </select>
            <select
              aria-label={`${s.linkStaff}: ${m.name}`}
              className={`${inputClass} h-9 w-auto max-w-44`}
              value={m.staffId ?? ''}
              disabled={busy}
              onChange={(e) => run(() => api('PATCH', `/app/team/members/${m.userId}`, { staffId: e.target.value || null }), t.toasts.profileSaved)}
            >
              <option value="">{s.noLink}</option>
              {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            {m.userId !== me?.user.id && (
              <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" disabled={busy} onClick={() => run(() => api('DELETE', `/app/team/members/${m.userId}`), s.removed)} aria-label={`${s.remove}: ${m.name}`}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </li>
        ))}
        {data?.invitations.map((i) => (
          <li key={i.id} className="flex items-center gap-4 bg-slate-50/60 px-5 py-3" data-testid="team-invitation">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800"><Ltr>{i.email}</Ltr></p>
              <p className="text-xs text-slate-500">{s.roleShort[i.role]}{staffName(i.staffId) ? ` · ${staffName(i.staffId)}` : ''} · {fmt(s.pending, { date: f.monthDay(i.expiresAt) })}</p>
            </div>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api('DELETE', `/app/team/invitations/${i.id}`), s.revoked)}><X className="size-4" /> {s.revoke}</Button>
          </li>
        ))}
      </ul>
      <form className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end" onSubmit={sendInvite}>
        <Field label={s.inviteEmail}><Input name="inviteEmail" type="email" dir="ltr" className="text-start rtl:text-end" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={s.role}>
          <select name="inviteRole" className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="staff">{s.roles.staff}</option>
            <option value="owner">{s.roles.owner}</option>
          </select>
        </Field>
        <Field label={s.linkStaff}>
          <select name="inviteStaff" className={inputClass} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">{s.noLink}</option>
            {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Button type="submit" disabled={busy || !email.trim()}><MailPlus className="size-4" /> {s.send}</Button>
      </form>
    </Card>
  )
}
