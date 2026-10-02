import { CloudOff, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/i18n'

/** Shown when a page's data couldn't be loaded (offline, server error) — with a retry. */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl bg-white px-6 py-12 text-center ring-1 ring-slate-200">
      <CloudOff className="size-8 text-slate-400" />
      <p className="text-base font-semibold text-slate-900">{t.system.loadErrorTitle}</p>
      <p className="max-w-sm text-sm text-slate-500">{navigator.onLine ? t.system.loadErrorBody : t.system.offlineBody}</p>
      <Button variant="secondary" onClick={onRetry}><RotateCw className="size-4" /> {t.system.retry}</Button>
    </div>
  )
}
