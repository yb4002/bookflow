import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { buttonClass } from '@/components/ui/Button'
import { useDocumentTitle, useI18n } from '@/i18n'

/** Unknown URL: say so (instead of silently redirecting), with a way back. */
export default function NotFoundPage() {
  const { t } = useI18n()
  useDocumentTitle(t.system.notFoundTitle)
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="px-4 py-4 sm:px-6"><Link to="/"><Logo /></Link></header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-20 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><Compass className="size-6" /></span>
        <h1 className="text-2xl font-bold text-slate-900">{t.system.notFoundTitle}</h1>
        <p className="max-w-sm text-sm text-slate-600">{t.system.notFoundBody}</p>
        <Link to="/" className={buttonClass('primary')}>{t.system.home}</Link>
      </main>
    </div>
  )
}
