import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, LogOut, UserCog } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar } from '@/components/ui/Avatar'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'

/** Compact account menu (mobile top bar): who is signed in, for which business, and log out. */
export function UserMenu({ name, businessName, seed, onLogout, className }: { name: string; businessName: string; seed?: string; onLogout: () => void; className?: string }) {
  const { t } = useI18n()
  const { me, switchBusiness } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={t.shell.account} className="rounded-full">
        <Avatar label={initials} seed={seed} />
      </button>
      {open && (
        <div role="menu" className="absolute end-0 top-full z-50 mt-2 w-56 animate-fade-in rounded-xl bg-white p-1 shadow-pop ring-1 ring-slate-200">
          <div className="px-3 py-2">
            <p dir="auto" className="truncate text-sm font-semibold text-slate-900 rtl:text-right">{name}</p>
            <p dir="auto" className="truncate text-xs text-slate-500 rtl:text-right">{businessName}</p>
          </div>
          <Link to="/app/account" role="menuitem" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-medium text-slate-700 hover:bg-slate-50">
            <UserCog className="size-4" /> {t.account.menu}
          </Link>
          {(me?.businesses?.length ?? 0) > 1 &&
            me!.businesses!.filter((b) => b.id !== me!.business.id).map((b) => (
              <button key={b.id} type="button" role="menuitem" onClick={() => void switchBusiness(b.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-medium text-slate-700 hover:bg-slate-50">
                <ArrowLeftRight className="size-4" /> <span dir="auto" className="truncate">{b.name}</span>
              </button>
            ))}
          <button type="button" role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-medium text-slate-700 hover:bg-slate-50">
            <LogOut className="size-4 rtl:-scale-x-100" /> {t.auth.logout}
          </button>
        </div>
      )}
    </div>
  )
}
