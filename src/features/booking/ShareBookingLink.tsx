import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Link2 } from 'lucide-react'
import { Button, buttonClass } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'
import { bookingPath, bookingUrl } from './paths'

async function copyText(text: string, fallbackInput: HTMLInputElement | null) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API needs a secure context (https/localhost); fall back for LAN http.
    if (!fallbackInput) return false
    fallbackInput.select()
    return document.execCommand('copy')
  }
}

/** Dashboard "Share booking link" menu: the live link, copy, and open in a new tab. */
export function ShareBookingLink({ slug }: { slug: string }) {
  const { t } = useI18n()
  const s = t.dashboard.share
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const url = bookingUrl(slug)

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

  const copy = async () => {
    if (await copyText(url, inputRef.current)) {
      setCopied(true)
      toast(s.copied)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <Link2 className="size-4" /> {t.dashboard.shareLink}
      </Button>
      {open && (
        <div role="dialog" aria-label={s.title} className="absolute end-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-fade-in rounded-xl bg-white p-4 shadow-pop ring-1 ring-slate-200 max-sm:start-0 max-sm:end-auto">
          <p className="text-sm font-semibold text-slate-900">{s.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">{s.hint}</p>
          <input
            ref={inputRef}
            readOnly
            dir="ltr"
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-3 h-10 w-full rounded-lg bg-slate-50 px-3 font-mono text-xs text-slate-700 ring-1 ring-slate-200 focus:ring-2 focus:ring-brand-500 focus:outline-none rtl:text-right"
            aria-label={s.title}
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" onClick={copy}>
              {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />} {copied ? s.copied : s.copy}
            </Button>
            <a href={bookingPath(slug)} target="_blank" rel="noopener" onClick={() => setOpen(false)} className={cn(buttonClass('primary', 'sm'))}>
              <ExternalLink className="size-3.5" /> {s.open}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
