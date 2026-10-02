import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher'
import { useI18n } from '@/i18n'

/** Shared shell for login, sign-up and password pages. */
export function AuthLayout({ title, subtitle, error, children, footer }: { title: string; subtitle?: string; error?: string; children: ReactNode; footer?: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/"><Logo /></Link>
        <LanguageSwitcher compact />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">
          <div className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-slate-200/70 sm:p-8">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            {error && (
              <p role="alert" className="mt-5 flex gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
              </p>
            )}
            {children}
          </div>
          {footer && <div className="mt-5 text-center text-sm text-slate-600">{footer}</div>}
          <Link to="/" className="mt-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t.auth.backHome}
          </Link>
        </div>
      </main>
    </div>
  )
}

export const authInputClass = 'h-11 text-start rtl:text-end'
