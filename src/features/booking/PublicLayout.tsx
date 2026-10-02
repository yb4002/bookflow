import { businessZone, zonedWeekday } from '@/domain/time'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Clock, EyeOff, Info, MapPin, Phone } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher'
import { Ltr } from '@/components/i18n/Ltr'
import type { PublicBusinessProfile } from '@/data/repositories'
import { useBusinessLocale, useI18n } from '@/i18n'
import { bookingPath } from './paths'

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}

/** Customer-facing shell: business identity, language, demo notice and footer. No app chrome. */
export function PublicLayout({ business, children, compact, demo = false }: { business?: PublicBusinessProfile['business']; children: ReactNode; compact?: boolean; demo?: boolean }) {
  const { t, f, fmt } = useI18n()
  useBusinessLocale(business?.settings, { applyDefaultLanguage: true, timeZone: business?.timezone })
  const b = t.booking
  const today = business?.hours[zonedWeekday(new Date(), businessZone(business))]

  return (
    <div className="min-h-dvh bg-slate-50">
      {business && !business.publishedAt ? (
        <div role="status" className="bg-slate-900 px-4 py-2 text-center text-xs font-medium text-white" data-testid="preview-banner">
          <EyeOff className="me-1.5 inline size-3.5 align-[-2px]" />
          {b.previewBanner}
        </div>
      ) : demo ? (
        <div className="bg-amber-50 px-4 py-2 text-center text-[11px] leading-snug text-amber-900 ring-1 ring-amber-200/60">
          <Info className="me-1 inline size-3.5 align-[-2px] text-amber-600" />
          {b.demoBanner}
        </div>
      ) : null}

      <header className="relative">
        {business?.coverUrl ? (
          <img src={business.coverUrl} alt="" className="h-28 w-full object-cover sm:h-40" />
        ) : (
          <div className="h-24 bg-gradient-to-br from-brand-600 via-brand-700 to-violet-700 sm:h-32" />
        )}
        <div className="absolute end-3 top-3">
          <div className="rounded-lg bg-white/90 shadow-sm backdrop-blur">
            <LanguageSwitcher compact />
          </div>
        </div>
        {business && (
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            {/* The logo overlaps the cover; the name starts just below the cover's edge so it stays readable. */}
            <div className="-mt-10 flex items-start gap-4 sm:-mt-12">
              <Link to={bookingPath(business.slug)} className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-3xl font-bold text-white shadow-pop ring-4 ring-white sm:size-24">
                {business.logoUrl ? <img src={business.logoUrl} alt={business.name} className="size-full bg-white object-cover" /> : business.name[0]}
              </Link>
              <div className="min-w-0 pt-12 sm:pt-14">
                <h1 dir="auto" className="truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{business.name}</h1>
                <p dir="auto" className="truncate text-sm text-slate-500">{business.category}</p>
              </div>
            </div>
            {!compact && (
              <>
                <p dir="auto" className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-600">{business.description}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-3.5 text-slate-400" />
                    {today?.open ? fmt(b.openToday, { hours: f.timeRange(at(today.start), at(today.end)) }) : b.closedToday}
                  </span>
                  <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5 text-slate-400" /><span dir="auto">{business.address}</span></span>
                  <a href={`tel:${business.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    <Phone className="size-3.5 text-slate-400" /><Ltr>{business.phone}</Ltr>
                  </a>
                </div>
              </>
            )}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-6">{children}</main>

      <footer className="pb-8 text-center text-xs text-slate-400">
        <Link to="/" className="inline-flex items-center gap-1.5 hover:text-slate-600">
          {b.poweredBy} <LogoMark className="size-4" /> <span className="font-semibold text-slate-500">BookFlow</span>
        </Link>
      </footer>
    </div>
  )
}
