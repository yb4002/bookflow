import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, BellRing, Check, ChevronDown, Globe, Menu, Repeat, ShieldCheck, Star, Users, X, type LucideIcon } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher'
import { buttonClass } from '@/components/ui/Button'
import { useI18n, type Messages } from '@/i18n'
import { cn } from '@/lib/cn'
import { HeroVisual } from './HeroVisual'
import { usePublicConfig } from '@/hooks/usePublicConfig'

type FeatureKey = keyof Messages['landing']['features']['items']
type PlanKey = keyof Messages['landing']['pricing']['plans']

/** Non-translatable structure: icons and flags. Copy lives in the locale files; prices come from the server's configuration. */
const featureMeta: { key: FeatureKey; icon: LucideIcon; soon?: boolean }[] = [
  { key: 'booking', icon: Globe },
  { key: 'reminders', icon: BellRing },
  { key: 'waitlist', icon: Repeat },
  { key: 'profiles', icon: Users },
  { key: 'reviews', icon: Star, soon: true },
  { key: 'analytics', icon: BarChart3 },
]
const planMeta: { key: PlanKey; featured?: boolean }[] = [{ key: 'solo' }, { key: 'team', featured: true }, { key: 'business' }]

/** Arrow that points "forward" in the reading direction. */
const Forward = ({ className }: { className?: string }) => <ArrowRight className={cn('size-4 rtl:-scale-x-100', className)} />

function Nav() {
  const { t } = useI18n()
  const n = t.landing.nav
  const [open, setOpen] = useState(false)
  const links = [
    { href: '#features', label: n.features },
    { href: '#how', label: n.how },
    { href: '#pricing', label: n.pricing },
    { href: '#faq', label: n.faq },
  ]
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/"><Logo /></Link>
        <nav className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-slate-600 hover:text-slate-900">{l.label}</a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <LanguageSwitcher />
          <Link to="/login" className={buttonClass('ghost')}>{n.login}</Link>
          <Link to="/signup" className={buttonClass('primary')}>{n.startTrial}</Link>
        </div>
        <div className="flex items-center gap-1 md:hidden">
          <LanguageSwitcher compact />
          <button className="rounded-lg p-2 text-slate-600" onClick={() => setOpen(!open)} aria-label={t.common.menu} aria-expanded={open}>
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-slate-100 bg-white px-4 pt-2 pb-4 md:hidden">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-base font-medium text-slate-700 hover:bg-slate-50">{l.label}</a>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/login" className={buttonClass('secondary')}>{n.login}</Link>
            <Link to="/signup" className={buttonClass('primary')}>{n.startFree}</Link>
          </div>
        </div>
      )}
    </header>
  )
}

function Hero() {
  const { t } = useI18n()
  const h = t.landing.hero
  const config = usePublicConfig()
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--color-brand-100),transparent_60%)]" />
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-12 pb-20 sm:px-6 lg:grid-cols-2 lg:gap-12 lg:pt-20 lg:pb-28">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-brand-100">
            <span className="size-1.5 rounded-full bg-brand-500" /> {h.badge}
          </span>
          <h1 className="mt-5 text-4xl leading-[1.08] font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            {h.titleLine1}<br />
            <span className="bg-gradient-to-r from-brand-600 to-violet-600 bg-clip-text text-transparent">{h.titleLine2}</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-600">{h.body}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/signup" className={buttonClass('primary', 'lg')}>{h.ctaPrimary} <Forward /></Link>
            <Link to="/login" className={buttonClass('secondary', 'lg')}>{config?.demoMode ? h.ctaSecondary : h.ctaLogin}</Link>
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-sm text-slate-500">
            <ShieldCheck className="size-4 text-emerald-600" /> {h.trustNote}
          </p>
          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-slate-200 pt-6">
            {h.stats.map((s) => (
              <div key={s.label}>
                <dt className="text-2xl font-bold text-slate-900">{s.value}</dt>
                <dd className="mt-0.5 text-xs leading-snug text-slate-500">{s.label}</dd>
              </div>
            ))}
          </dl>
        </div>
        <HeroVisual />
      </div>
    </section>
  )
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold text-brand-600">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-lg text-slate-600">{body}</p>}
    </div>
  )
}

function Features() {
  const { t } = useI18n()
  const s = t.landing.features
  return (
    <section id="features" className="scroll-mt-16 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow={s.eyebrow} title={s.title} body={s.body} />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featureMeta.map(({ key, icon: Icon, soon }) => (
            <div key={key} className="group rounded-2xl bg-white p-6 shadow-card ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-pop">
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100"><Icon className="size-5" /></span>
                {soon && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{s.soon}</span>}
              </div>
              <h3 className="mt-5 text-base font-semibold text-slate-900">{s.items[key].title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.items[key].body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  const { t, f } = useI18n()
  const s = t.landing.how
  return (
    <section id="how" className="scroll-mt-16 bg-slate-900 py-20 text-white sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold text-brand-300">{s.eyebrow}</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{s.title}</h2>
        </div>
        <ol className="mt-14 grid gap-8 md:grid-cols-3">
          {s.steps.map((step, i) => (
            <li key={i} className="relative rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
              <span className="flex size-9 items-center justify-center rounded-full bg-brand-500 text-sm font-bold">{f.number(i + 1)}</span>
              <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function Pricing() {
  const { t, locale } = useI18n()
  const s = t.landing.pricing
  const pricing = usePublicConfig()?.pricing
  // Prices are shown in the operator's billing currency — never converted by the visitor's language.
  const price = (key: PlanKey) => {
    const amount = pricing?.[key]
    return pricing && amount !== undefined ? new Intl.NumberFormat(locale === 'he' ? 'he-IL' : 'en-US', { style: 'currency', currency: pricing.currency, maximumFractionDigits: 0 }).format(amount) : null
  }
  return (
    <section id="pricing" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow={s.eyebrow} title={s.title} body={s.body} />
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {planMeta.map(({ key, featured }) => {
            const p = s.plans[key]
            const amount = price(key)
            return (
              <div key={key} className={cn('relative flex flex-col rounded-2xl p-7 ring-1', featured ? 'bg-slate-900 text-white ring-slate-900 shadow-pop' : 'bg-white ring-slate-200')}>
                {featured && <span className="absolute start-7 -top-3 rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white">{s.mostPopular}</span>}
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className={cn('mt-1 text-sm', featured ? 'text-slate-300' : 'text-slate-500')}>{p.blurb}</p>
                {amount ? (
                  <p className="mt-6 flex items-baseline gap-1">
                    <span className="text-4xl font-bold tracking-tight">{amount}</span>
                    <span className={cn('text-sm', featured ? 'text-slate-400' : 'text-slate-500')}>{s.perMonth}</span>
                  </p>
                ) : (
                  <p className="mt-6 text-lg font-semibold">{s.earlyAccess}</p>
                )}
                <ul className="mt-6 flex-1 space-y-3">
                  {p.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2.5 text-sm">
                      <Check className={cn('mt-0.5 size-4 shrink-0', featured ? 'text-brand-300' : 'text-brand-600')} /> {feat}
                    </li>
                  ))}
                </ul>
                <Link to="/signup" className={cn(buttonClass(featured ? 'primary' : 'secondary', 'lg'), 'mt-8 w-full', featured && 'bg-brand-500 hover:bg-brand-400')}>{p.cta}</Link>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function Faq() {
  const { t } = useI18n()
  const s = t.landing.faq
  return (
    <section id="faq" className="scroll-mt-16 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeading eyebrow={s.eyebrow} title={s.title} />
        <div className="mt-12 divide-y divide-slate-200 rounded-2xl bg-white shadow-card ring-1 ring-slate-200/70">
          {s.items.map((item) => (
            <details key={item.q} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-start text-base font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown className="size-5 shrink-0 text-slate-400 transition group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  const { t } = useI18n()
  const s = t.landing.cta
  return (
    <section className="px-4 pb-20 sm:px-6 sm:pb-28">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-violet-700 px-6 py-14 text-center text-white sm:px-12 sm:py-20">
        <div className="absolute -end-24 -top-24 size-72 rounded-full bg-white/10 blur-2xl" />
        <h2 className="relative text-3xl font-bold tracking-tight sm:text-4xl">{s.title}</h2>
        <p className="relative mx-auto mt-4 max-w-xl text-lg text-brand-100">{s.body}</p>
        <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to="/signup" className={buttonClass('secondary', 'lg', 'ring-0')}>{s.primary} <Forward /></Link>
          <Link to="/login" className={buttonClass('ghost', 'lg', 'text-white ring-1 ring-white/30 hover:bg-white/10 hover:text-white')}>{s.secondary}</Link>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  const { t, fmt } = useI18n()
  const s = t.landing.footer
  const n = t.landing.nav
  const operator = usePublicConfig()?.operator
  const linkClass = 'text-sm text-slate-500 hover:text-slate-900'
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-5">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-slate-500">{s.tagline}</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{s.product}</p>
          <ul className="mt-4 space-y-2.5">
            <li><a href="#features" className={linkClass}>{n.features}</a></li>
            <li><a href="#pricing" className={linkClass}>{n.pricing}</a></li>
            <li><a href="#faq" className={linkClass}>{n.faq}</a></li>
            <li><Link to="/login" className={linkClass}>{n.login}</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{s.legal}</p>
          <ul className="mt-4 space-y-2.5">
            <li><Link to="/privacy" className={linkClass}>{s.privacy}</Link></li>
            <li><Link to="/terms" className={linkClass}>{s.terms}</Link></li>
          </ul>
        </div>
        {operator?.email && (
          <div>
            <p className="text-sm font-semibold text-slate-900">{s.contact}</p>
            <p className="mt-4 text-sm text-slate-500" dir="ltr">{operator.email}</p>
          </div>
        )}
      </div>
      <div className="border-t border-slate-100 py-6 text-center text-xs text-slate-400">{fmt(s.rights, { year: new Date().getFullYear() })}</div>
    </footer>
  )
}

export function LandingPage() {
  return (
    <div className="bg-slate-50">
      <Nav />
      <Hero />
      <Features />
      <HowItWorks />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </div>
  )
}
