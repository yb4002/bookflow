import { useSearchParams } from 'react-router-dom'
import type { Service } from '@/domain/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { repo } from '@/data/repositories'
import { useQuery } from '@/hooks/useQuery'
import { useI18n, type Messages } from '@/i18n'
import { cn } from '@/lib/cn'
import { useServiceEditor } from '@/features/business/useServiceEditor'
import { BillingTab } from '@/features/billing/BillingTab'
import { LoadError } from '@/features/system/LoadError'
import { HoursTab, PoliciesTab, ProfileTab, ServicesTab, TeamTab } from './tabs'

type TabId = keyof Messages['services']['tabs']
const TABS: TabId[] = ['services', 'team', 'hours', 'policies', 'profile', 'billing']

export default function ServicesPage() {
  const toast = useToast()
  const { t, fmt } = useI18n()
  const [params, setParams] = useSearchParams()
  const tab: TabId = TABS.find((id) => id === params.get('tab')) ?? 'services'

  const { data, refetch, error } = useQuery(() => Promise.all([repo.getBusiness(), repo.listStaff(), repo.listServices()]), [], { refreshOn: ['business', 'staff', 'services'] })
  const [business, staff, services] = data ?? []

  const editor = useServiceEditor(refetch)
  const save = async (s: Service) => {
    await repo.updateService(s)
    refetch()
  }

  return (
    <>
      <PageHeader title={t.services.title} description={t.services.description} />

      <div className="scrollbar-none -mx-4 mb-5 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
        <nav className="flex gap-6" role="tablist">
          {TABS.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setParams(id === 'services' ? {} : { tab: id }, { replace: true })}
              className={cn('-mb-px shrink-0 border-b-2 pb-3 text-sm font-medium transition-colors', tab === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}
            >
              {t.services.tabs[id]}
            </button>
          ))}
        </nav>
      </div>

      {error && !data ? (
        <LoadError onRetry={refetch} />
      ) : !business || !staff || !services ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <>
          {tab === 'services' && (
            <ServicesTab
              services={services}
              onEdit={editor.openEdit}
              onAdd={editor.openNew}
              onToggle={async (s) => { await save({ ...s, active: !s.active }); toast(fmt(s.active ? t.toasts.serviceHidden : t.toasts.serviceVisible, { name: s.name })) }}
            />
          )}
          {tab === 'team' && <TeamTab staff={staff} services={services} business={business} />}
          {tab === 'hours' && <HoursTab business={business} />}
          {tab === 'policies' && <PoliciesTab business={business} />}
          {tab === 'profile' && <ProfileTab business={business} />}
          {tab === 'billing' && <BillingTab />}
        </>
      )}

      {editor.element}
    </>
  )
}
