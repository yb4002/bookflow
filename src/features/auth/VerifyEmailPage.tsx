import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { buttonClass } from '@/components/ui/Button'
import { useAuth } from '@/auth/AuthProvider'
import { useDocumentTitle, useI18n } from '@/i18n'
import { AuthLayout } from './AuthLayout'

/** /verify-email?token=… — confirms the account's email address. */
export default function VerifyEmailPage() {
  const { t } = useI18n()
  const s = t.verify
  const { verifyEmail, refresh, status } = useAuth()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed')
  const started = useRef(false)
  useDocumentTitle(s.docTitle)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true // the link is single-use: never submit it twice (StrictMode double effects)
    verifyEmail(token).then(
      () => {
        setState('done')
        void refresh()
      },
      () => setState('failed'),
    )
  }, [token, verifyEmail, refresh])

  return (
    <AuthLayout title={s.docTitle} error={state === 'failed' ? s.failed : undefined}>
      {state === 'working' && <p className="mt-5 text-sm text-slate-600">{s.working}</p>}
      {state === 'done' && (
        <>
          <p role="status" className="mt-5 flex gap-3 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> {s.done}
          </p>
          <Link to={status === 'authenticated' ? '/app' : '/login'} className={buttonClass('primary', 'lg', 'mt-5 w-full')}>{s.continue}</Link>
        </>
      )}
    </AuthLayout>
  )
}
