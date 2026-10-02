import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { LogoMark } from '@/components/brand/Logo'
import { useI18n } from '@/i18n'
import { useAuth } from './AuthProvider'

/**
 * Guards signed-in areas: waits for the session check, then renders, or sends to
 * /login?next=…. With `requireOnboarded`, businesses that haven't finished setup
 * are sent to the onboarding wizard first. With `requireOwner`, team members are sent to the dashboard.
 */
export function RequireAuth({ children, requireOnboarded = false, requireOwner = false }: { children: ReactNode; requireOnboarded?: boolean; requireOwner?: boolean }) {
  const { status, me } = useAuth()
  const location = useLocation()
  const { t } = useI18n()

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50" role="status" aria-live="polite">
        <LogoMark className="size-10 animate-pulse" />
        <p className="text-sm text-slate-500">{t.auth.checking}</p>
      </div>
    )
  }
  if (status === 'anonymous') {
    const next = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  // Setup is the owner's job; team members of a business still being set up just see the dashboard.
  if (requireOnboarded && me && !me.business.onboardingCompleted && me.role === 'owner') return <Navigate to="/onboarding" replace />
  // Owner-only areas (settings): team members go back to the dashboard (the API refuses them too).
  if (requireOwner && me && me.role !== 'owner') return <Navigate to="/app" replace />
  return <>{children}</>
}
