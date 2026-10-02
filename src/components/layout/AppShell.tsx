import { Suspense, useState } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import { ExternalLink, LogOut, MailCheck, Sparkles } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { UserMenu } from './UserMenu'
import { Logo, LogoMark } from '@/components/brand/Logo'
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher'
import { Avatar } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { repo } from '@/data/repositories'
import { bookingPath } from '@/features/booking/paths'
import { useQuery } from '@/hooks/useQuery'
import { useBusinessLocale, useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { navItems } from './nav'
import { AppointmentFormProvider } from '@/features/appointments/AppointmentForm'
import { daysUntil, useBilling } from '@/features/billing/useBilling'
import { ActivityMenu } from '@/features/activity/ActivityMenu'

export function AppShell() {
  const { t } = useI18n()
  const { data: business } = useQuery(() => repo.getBusiness(), [], { refreshOn: ['business'] })
  useBusinessLocale(business?.settings, { timeZone: business?.timezone })
  const { me, logout } = useAuth()
  const businessName = business?.name ?? me?.business.name ?? ''
  const nav = navItems.filter((i) => !i.ownerOnly || me?.role === 'owner')
  return (
    <div className="min-h-dvh lg:ps-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link to="/"><Logo /></Link>
        </div>
        <div className="mx-3 mb-4 flex items-center gap-3 rounded-lg bg-slate-50 p-2.5 ring-1 ring-slate-200/70">
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white">
            {business?.logoUrl ? <img src={business.logoUrl} alt="" className="size-full bg-white object-cover" /> : (businessName[0] ?? '')}
          </span>
          <div className="min-w-0">
            <p dir="auto" className="truncate text-sm font-semibold text-slate-900 rtl:text-right">{businessName}</p>
            <p dir="auto" className="truncate text-xs text-slate-500 rtl:text-right">{business?.address.split(',').slice(-2).join(',').trim()}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/app'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )
              }
            >
              <item.icon className="size-[18px]" />
              {t.nav[item.key].label}
            </NavLink>
          ))}
        </nav>
        <Link to="/app" className="m-3 block rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 p-4 text-white transition hover:brightness-110">
          <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" /> {t.shell.smartWaitlistTitle}</div>
          <p className="mt-1 text-xs text-brand-100">{t.shell.smartWaitlistBody}</p>
        </Link>
        <div className="flex items-center gap-3 border-t border-slate-100 p-4">
          <Link to="/app/account" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg" title={t.account.menu}>
            <Avatar label={initialsOf(me?.user.name)} seed={me?.user.id} />
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate text-sm font-medium text-slate-900 rtl:text-right">{me?.user.name}</p>
              <p className="truncate text-xs text-slate-500">{me?.role === 'staff' ? t.shell.staffRole : t.shell.ownerRole}</p>
            </div>
          </Link>
          <button type="button" onClick={logout} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t.auth.logout} title={t.auth.logout}>
            <LogOut className="size-4 rtl:-scale-x-100" />
          </button>
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur lg:h-16 lg:px-8">
        <Link to="/" className="lg:hidden"><LogoMark className="size-7" /></Link>
        {me?.business.demo && <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-600/20">{t.shell.previewBadge}</span>}
        <div className="ms-auto flex items-center gap-1.5">
          <LanguageSwitcher compact />
          {business && (
            <a className="hidden items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:inline-flex" href={bookingPath(business.slug)} target="_blank" rel="noopener">
              <ExternalLink className="size-4" /> {t.shell.bookingPage}
            </a>
          )}
          <ActivityMenu />
          <UserMenu name={me?.user.name ?? ''} businessName={businessName} seed={me?.user.id} onLogout={logout} className="lg:hidden" />
        </div>
      </header>

      {me?.role === 'owner' && <BillingBanner />}
      {me && me.user.emailVerified === false && !me.business.demo && <VerifyEmailBanner email={me.user.email} />}

      <main className="mx-auto max-w-7xl px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">
        <AppointmentFormProvider>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </AppointmentFormProvider>
      </main>

      {/* Mobile tab bar */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
        <div className={cn('grid', nav.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/app'}
              className={({ isActive }) =>
                cn('flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-brand-600' : 'text-slate-500')
              }
            >
              <item.icon className="size-5" />
              {t.nav[item.key].short}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

/** Trial ending soon / online booking paused (owners only; only when billing is set up). */
function BillingBanner() {
  const { t, plural } = useI18n()
  const { state } = useBilling()
  if (!state?.enabled) return null
  const days = daysUntil(state.trialEndsAt)
  const paused = !state.entitled
  const ending = state.status === 'trialing' && state.entitled && days <= 3
  if (!paused && !ending && state.status !== 'past_due') return null
  return (
    <div role="status" className={cn('flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-xs ring-1', paused || state.status === 'past_due' ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-brand-50 text-brand-900 ring-brand-100')}>
      <span>{paused ? t.billing.banner.paused : state.status === 'past_due' ? t.billing.status.past_due : plural(t.billing.banner.trialEnding, Math.max(1, days))}</span>
      <Link to="/app/services?tab=billing" className="font-semibold underline underline-offset-2">{t.billing.banner.action}</Link>
    </div>
  )
}

/** Nudge until the account's email address is confirmed (with a resend link). */
function VerifyEmailBanner({ email }: { email: string }) {
  const { t, fmt, locale } = useI18n()
  const { resendVerification } = useAuth()
  const [sent, setSent] = useState(false)
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-brand-50 px-4 py-2 text-center text-xs text-brand-900 ring-1 ring-brand-100">
      <MailCheck className="size-4 shrink-0 text-brand-600" />
      <span>{fmt(t.account.verifyBanner, { email })}</span>
      {sent ? (
        <span className="font-semibold">{t.account.resent}</span>
      ) : (
        <button type="button" className="font-semibold text-brand-700 underline underline-offset-2" onClick={async () => (await resendVerification(locale).catch(() => undefined), setSent(true))}>
          {t.account.resend}
        </button>
      )}
    </div>
  )
}

function PageFallback() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid grid-cols-2 gap-4 pt-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}

const initialsOf = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
