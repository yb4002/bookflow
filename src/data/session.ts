import type { ID } from '@/domain/types'
import { DEMO_BUSINESS_ID } from './seed/demo'

/**
 * Who is using the dashboard. Today: the demo business, no sign-in.
 * When authentication arrives, this becomes the signed-in user's active business
 * (e.g. from a session token) — the repository already scopes every query by it.
 */
let activeBusinessId: ID = DEMO_BUSINESS_ID

export const getActiveBusinessId = (): ID => activeBusinessId
export const setActiveBusinessId = (id: ID) => {
  activeBusinessId = id
}
