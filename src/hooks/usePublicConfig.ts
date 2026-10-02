import { useEffect, useState } from 'react'
import { api } from '@/data/api/client'

/** Non-secret server settings shown to visitors (from /api/config). */
export interface PublicConfig {
  demoMode: boolean
  operator?: { name?: string; email?: string; address?: string }
  /** Monthly plan prices as configured by the operator (null = not set: early access). */
  pricing?: { currency: string; solo?: number; team?: number; business?: number } | null
}

let cached: Promise<PublicConfig> | null = null
export function usePublicConfig() {
  const [config, setConfig] = useState<PublicConfig>()
  useEffect(() => {
    cached ??= api<PublicConfig>('GET', '/config').catch(() => ({ demoMode: false }))
    void cached.then(setConfig)
  }, [])
  return config
}
