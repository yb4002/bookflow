import { useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import type { ImageKind } from '@/data/repositories/types'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/cn'

const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const LIMITS: Record<ImageKind, { w: number; h: number }> = { logo: { w: 512, h: 512 }, cover: { w: 1600, h: 800 } }

/** Downscales in the browser (fast uploads, well under the server's 2 MB cap). WebP where supported, else JPEG/PNG. */
async function toDataUrl(file: File, kind: ImageKind): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('decode'))
      i.src = url
    })
    const { w, h } = LIMITS[kind]
    const scale = Math.min(1, w / img.naturalWidth, h / img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const webp = canvas.toDataURL('image/webp', 0.86)
    if (webp.startsWith('data:image/webp')) return webp
    return file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Logo / cover picker with preview. `onUpload` receives a data URL (or null to remove). */
export function ImageUpload({ kind, url, label, hint, onUpload }: { kind: ImageKind; url?: string; label: string; hint?: string; onUpload: (dataUrl: string | null) => Promise<void> }) {
  const { t } = useI18n()
  const s = t.business.image
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const pick = async (file?: File) => {
    if (!file) return
    setError(undefined)
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError(s.notImage)
    if (file.size > MAX_SOURCE_BYTES) return setError(s.tooLarge)
    setBusy(true)
    try {
      await onUpload(await toDataUrl(file, kind))
    } catch {
      setError(s.failed)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <div className={cn('mt-2 flex items-center gap-4', kind === 'cover' && 'flex-col items-stretch')}>
        <div
          className={cn(
            'flex items-center justify-center overflow-hidden bg-slate-100 ring-1 ring-slate-200',
            kind === 'logo' ? 'size-20 shrink-0 rounded-2xl' : 'aspect-[3/1] w-full rounded-xl',
            !url && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(241_245_249)_6px,rgb(241_245_249)_7px)]',
          )}
        >
          {url ? <img src={url} alt={label} className="size-full object-cover" /> : <ImagePlus className="size-6 text-slate-400" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={label} data-kind={kind} onChange={(e) => pick(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
            <ImagePlus className="size-3.5" /> {url ? s.replace : s.upload}
          </Button>
          {url && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { setBusy(true); await onUpload(null).finally(() => setBusy(false)) }}>
              <Trash2 className="size-3.5" /> {s.remove}
            </Button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  )
}
