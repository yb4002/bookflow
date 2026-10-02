import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { reportError } from '@/lib/errorReporting'
import { useI18n } from '@/i18n'

/** Catches render crashes: reports them and shows a friendly recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(Object.assign(error, { stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}`.slice(0, 3000) }), 'render')
  }
  render() {
    return this.state.error ? <CrashScreen /> : this.props.children
  }
}

function CrashScreen() {
  const { t } = useI18n()
  return (
    <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700"><AlertTriangle className="size-6" /></span>
      <h1 className="text-xl font-bold text-slate-900">{t.system.crashTitle}</h1>
      <p className="max-w-sm text-sm text-slate-600">{t.system.crashBody}</p>
      <button type="button" onClick={() => location.reload()} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
        <RotateCw className="size-4" /> {t.system.reload}
      </button>
    </div>
  )
}
