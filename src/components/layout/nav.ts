import { CalendarDays, LayoutDashboard, Scissors, Users, type LucideIcon } from 'lucide-react'
import type { Messages } from '@/i18n'

export interface NavItem {
  to: string
  /** Key into `messages.nav` — labels live in the locale files. */
  key: keyof Messages['nav']
  icon: LucideIcon
  /** Hidden from team members (settings are owner-only; the server enforces it too). */
  ownerOnly?: boolean
}

/** Add future modules (Reviews, Marketing, Reports…) here and in each locale's `nav`. */
export const navItems: NavItem[] = [
  { to: '/app', key: 'dashboard', icon: LayoutDashboard },
  { to: '/app/calendar', key: 'calendar', icon: CalendarDays },
  { to: '/app/customers', key: 'customers', icon: Users },
  { to: '/app/services', key: 'services', icon: Scissors, ownerOnly: true },
]
