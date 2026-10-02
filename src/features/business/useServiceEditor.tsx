import { useState } from 'react'
import type { Service } from '@/domain/types'
import { useToast } from '@/components/ui/Toast'
import { repo } from '@/data/repositories'
import { useI18n } from '@/i18n'
import { blankService, ServiceEditor } from '@/features/services/ServiceEditor'

/** Add / edit / remove services through the repository — shared by Settings and onboarding. */
export function useServiceEditor(onChanged?: () => void) {
  const { t } = useI18n()
  const toast = useToast()
  const [editing, setEditing] = useState<Service | null>(null)

  const element = (
    <ServiceEditor
      service={editing}
      onClose={() => setEditing(null)}
      onSave={async (s) => {
        try {
          if (s.id) await repo.updateService(s)
          else await repo.createService({ name: s.name, category: s.category, description: s.description, durationMin: s.durationMin, bufferMin: s.bufferMin, price: s.price, active: s.active })
          toast(s.id ? t.toasts.serviceUpdated : t.business.services.added)
          setEditing(null)
          onChanged?.()
        } catch {
          toast(t.toasts.saveFailed)
        }
      }}
      onDelete={async (s) => {
        await repo.deleteService(s.id)
        toast(t.business.services.removed)
        setEditing(null)
        onChanged?.()
      }}
    />
  )
  return { element, openNew: () => setEditing(blankService()), openEdit: (s: Service) => setEditing(s) }
}
