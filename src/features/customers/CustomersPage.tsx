import { useMemo, useState } from 'react'
import { ChevronRight, Download, FileUp, UserPlus, Users } from 'lucide-react'
import type { CustomerTag } from '@/domain/types'
import { Ltr } from '@/components/i18n/Ltr'
import { PageHeader } from '@/components/layout/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { TagBadge } from '@/components/ui/StatusBadge'
import { repo } from '@/data/repositories'
import { useQuery } from '@/hooks/useQuery'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { fullName, initials } from '@/lib/format'
import { downloadText, toCsv } from '@/lib/csv'
import { CustomerDrawer } from './CustomerDrawer'
import { CustomerForm } from './CustomerForm'
import { ImportCustomers } from './ImportCustomers'
import { useAuth } from '@/auth/AuthProvider'
import { LoadError } from '@/features/system/LoadError'

type SortKey = 'name' | 'lastVisit' | 'value' | 'visits'
const TAGS: (CustomerTag | 'All')[] = ['All', 'VIP', 'Regular', 'New', 'At risk']

export default function CustomersPage() {
  const { t, f, fmt, plural } = useI18n()
  const s = t.customers
  const { data, loading, error, refetch } = useQuery(() => repo.listCustomers(), [], { refreshOn: ['customers', 'appointments'] })
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<CustomerTag | 'All'>('All')
  const [sort, setSort] = useState<SortKey>('lastVisit')
  const [selectedId, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const { me } = useAuth()
  // Always show the freshest copy (edits, opt-outs and new visits refresh the list).
  const selected = (selectedId && data?.find((c) => c.id === selectedId)) || null

  const exportCsv = () => {
    const tbl = s.table
    const csv = toCsv([
      [t.manage.client.firstName, t.manage.client.lastName, t.manage.client.phone, 'Email', t.manage.client.tags, tbl.visits, t.customers.drawer.noShows, tbl.value, tbl.lastVisit, tbl.nextBooking, t.manage.client.marketing, t.manage.client.optedOut],
      ...(data ?? []).map((c) => [
        c.firstName, c.lastName, c.phone, c.email, c.tags.join(' '), c.totalVisits, c.noShows, c.lifetimeValue,
        c.lastVisit ? f.dateRange(c.lastVisit, c.lastVisit) : '', c.nextAppointment ? `${f.dateMedium(c.nextAppointment)} ${f.time(c.nextAppointment)}` : '',
        c.marketingOptIn ? '✓' : '', c.messagingOptOut ? '✓' : '',
      ]),
    ])
    downloadText(`${t.manage.client.exportFile}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data ?? [])
      .filter((c) => tag === 'All' || c.tags.includes(tag))
      .filter((c) => !needle || `${fullName(c)} ${c.email} ${c.phone}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        switch (sort) {
          case 'name': return fullName(a).localeCompare(fullName(b), f.locale)
          case 'value': return b.lifetimeValue - a.lifetimeValue
          case 'visits': return b.totalVisits - a.totalVisits
          default: return (b.lastVisit ?? '').localeCompare(a.lastVisit ?? '')
        }
      })
  }, [data, q, tag, sort, f.locale])

  const counts = useMemo(() => {
    const all = data ?? []
    return {
      total: all.length,
      vip: all.filter((c) => c.tags.includes('VIP')).length,
      booked: all.filter((c) => c.nextAppointment).length,
      ltv: all.length ? all.reduce((s, c) => s + c.lifetimeValue, 0) / all.length : 0,
    }
  }, [data])

  return (
    <>
      <PageHeader
        title={s.title}
        description={s.description}
        actions={
          <>
            {me?.role === 'owner' && <Button variant="secondary" onClick={() => setImporting(true)}><FileUp className="size-4" /> {t.importClients.button}</Button>}
            <Button variant="secondary" disabled={!data?.length} onClick={exportCsv}><Download className="size-4" /> {s.export}</Button>
            <Button onClick={() => setAdding(true)}><UserPlus className="size-4" /> {s.addClient}</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          { label: s.stats.total, value: f.number(counts.total) },
          { label: s.stats.vip, value: f.number(counts.vip) },
          { label: s.stats.upcoming, value: f.number(counts.booked) },
          { label: s.stats.avgValue, value: f.money(counts.ltv) },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs font-medium text-slate-500">{s.label}</p>
            {loading && !data ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{s.value}</p>}
          </Card>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-3 sm:p-4 lg:flex-row lg:items-center">
          <SearchInput placeholder={s.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} className="lg:w-80" />
          <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1">
            {TAGS.map((tg) => (
              <button key={tg} onClick={() => setTag(tg)} aria-pressed={tag === tg} className={cn('shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition', tag === tg ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                {tg === 'All' ? s.filterAll : t.tags[tg]}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500 lg:ms-auto">
            {s.sortBy}
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-8 rounded-lg bg-white px-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 focus:ring-brand-500 focus:outline-none">
              <option value="lastVisit">{s.sort.lastVisit}</option>
              <option value="name">{s.sort.name}</option>
              <option value="value">{s.sort.value}</option>
              <option value="visits">{s.sort.visits}</option>
            </select>
          </label>
        </div>

        {error && !data ? (
          <div className="p-4"><LoadError onRetry={refetch} /></div>
        ) : loading && !data ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title={s.emptyTitle} description={s.emptyBody} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-start text-sm">
                <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-medium">{s.table.client}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{s.table.contact}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{s.table.lastVisit}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{s.table.nextBooking}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{s.table.visits}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{s.table.value}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((c) => (
                    <tr key={c.id} onClick={() => setSelected(c.id)} className="cursor-pointer hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar label={initials(c)} seed={c.id} />
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">{fullName(c)}</p>
                            <div className="mt-0.5 flex gap-1">{c.tags.map((t) => <TagBadge key={t} tag={t} />)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <p><Ltr>{c.phone}</Ltr></p>
                        <p className="text-xs text-slate-400"><Ltr>{c.email}</Ltr></p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{c.lastVisit ? f.friendlyDate(c.lastVisit) : '—'}</td>
                      <td className="px-4 py-3">{c.nextAppointment ? <span className="font-medium text-brand-700">{f.friendlyDate(c.nextAppointment)}</span> : <span className="text-slate-400">{s.notBooked}</span>}</td>
                      <td className="px-4 py-3 text-end text-slate-700 tabular-nums">{f.number(c.totalVisits)}</td>
                      <td className="px-4 py-3 text-end font-semibold text-slate-900 tabular-nums">{f.money(c.lifetimeValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((c) => (
                <li key={c.id}>
                  <button onClick={() => setSelected(c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start active:bg-slate-50">
                    <Avatar label={initials(c)} seed={c.id} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p dir="auto" className="truncate font-medium text-slate-900">{fullName(c)}</p>
                        {c.tags.slice(0, 1).map((t) => <TagBadge key={t} tag={t} />)}
                      </div>
                      <p className="text-xs text-slate-500">
                        {plural(t.common.visits, c.totalVisits)} · {f.money(c.lifetimeValue)} ·{' '}
                        {c.nextAppointment
                          ? fmt(s.nextOn, { date: f.friendlyDate(c.nextAppointment) })
                          : c.lastVisit
                            ? fmt(s.lastOn, { date: f.friendlyDate(c.lastVisit) })
                            : s.newClient}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-slate-300 rtl:rotate-180" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">{fmt(s.showing, { shown: f.number(rows.length), total: f.number(data?.length ?? 0) })}</div>
      </Card>

      <CustomerDrawer customer={selected} onClose={() => setSelected(null)} />
      {importing && <ImportCustomers onClose={() => setImporting(false)} />}
      {adding && <CustomerForm onClose={() => setAdding(false)} onSaved={(c) => setSelected(c.id)} />}
    </>
  )
}
