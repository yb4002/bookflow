import type { Business } from '@/domain/types'
import { DEMO_BUSINESS_ID } from '../seed/demo'
import type { DatabaseOptions } from './database'

/**
 * Upgrades records written before a field existed, so older stored data stays usable.
 * (Records from the pre-database demo had no businessId or settings.)
 */
const tenant = <T extends { businessId?: string }>(row: T) => (row.businessId ? row : { ...row, businessId: DEMO_BUSINESS_ID })

export const normalizers: DatabaseOptions['normalize'] = {
  businesses: (b) => {
    const legacy = b as Business & { bookingUrl?: string; currency?: string }
    const { bookingUrl: _u, currency: _c, ...rest } = legacy
    return {
      ...rest,
      settings: rest.settings ?? { defaultLanguage: 'en', currency: 'auto' },
      policies: { ...rest.policies, notificationChannel: rest.policies?.notificationChannel ?? 'sms' },
      createdAt: rest.createdAt ?? new Date(0).toISOString(),
      updatedAt: rest.updatedAt ?? new Date(0).toISOString(),
    }
  },
  staff: tenant,
  services: tenant,
  customers: tenant,
  appointments: tenant,
  offers: tenant,
}
