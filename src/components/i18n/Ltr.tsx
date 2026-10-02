import type { ReactNode } from 'react'

/**
 * Isolates left-to-right data (phone numbers, emails, URLs, codes) so it renders
 * correctly inside right-to-left text, e.g. "(555) 214-8890" stays intact in Hebrew.
 */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi dir="ltr" className={className}>{children}</bdi>
}
