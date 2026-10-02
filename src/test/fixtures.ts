import { Database } from '@/data/db/database'
import { normalizers } from '@/data/db/normalize'
import { MemoryStorage, type StorageAdapter } from '@/data/db/storage'
import { createLocalRepository } from '@/data/repositories/localRepository'
import type { BookFlowRepository } from '@/data/repositories/types'
import { buildDemoDataset, DEMO_BUSINESS_ID, type Dataset } from '@/data/seed/demo'

/** Monday 5 Oct 2026, 08:00 UTC — tests run with TZ=UTC. */
export const NOW = new Date('2026-10-05T08:00:00.000Z')

/** What the repository contract tests need from any implementation. */
export interface ContractEnv {
  repo: BookFlowRepository
  /** Simulates a reload / server restart: a fresh repository on the same stored data. */
  reload: () => ContractEnv
  /** Same stored data, acting for another business (multi-tenant tests). */
  as: (businessId: string) => ContractEnv
}

export interface TestEnv extends ContractEnv {
  storage: StorageAdapter
  db: Database
  reload: () => TestEnv
}

/** Local (browser) repository on in-memory storage. */
export function createTestEnv(options: { now?: Date; seed?: () => Dataset; storage?: StorageAdapter; businessId?: string } = {}): TestEnv {
  const now = options.now ?? NOW
  const storage = options.storage ?? new MemoryStorage()
  const db = new Database(storage, { namespace: 'test', seed: options.seed ?? (() => buildDemoDataset(now)), normalize: normalizers })
  const repo = createLocalRepository({ db, businessId: () => options.businessId ?? DEMO_BUSINESS_ID, latencyMs: 0, now: () => now })
  return { storage, db, repo, reload: () => createTestEnv({ ...options, storage }), as: (businessId) => createTestEnv({ ...options, storage, businessId }) }
}

/** First available slot (optionally for a staff member) at least `minDaysAhead` days out. */
export async function findSlot(env: ContractEnv, serviceId: string, { minDaysAhead = 2, staffId }: { minDaysAhead?: number; staffId?: string } = {}) {
  const days = await env.repo.getAvailability('luna-hair', serviceId, NOW, 14, staffId)
  for (const day of days.slice(minDaysAhead)) {
    const slot = day.slots.find((s) => s.available)
    if (slot) return slot
  }
  throw new Error('No free slot found')
}
