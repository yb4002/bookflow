import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { buildDemoDataset, DEMO_BUSINESS_ID, type Dataset } from '../../src/data/seed/demo'
import type { ContractEnv } from '../../src/test/fixtures'
import { NOW } from '../../src/test/fixtures'
import { runRepositoryContract } from '../../src/test/repositoryContract'
import { migrate } from '../db/migrate'
import { insertDataset, resetBusinessData } from '../db/seed'
import { openSqlite, type Sql } from '../db/sqlite'
import { EventBus } from '../events'
import { createFileImageStore } from '../storage/images'
import { createSqlRepository } from './sqlRepository'

const dir = mkdtempSync(join(tmpdir(), 'bookflow-contract-'))
const open: Sql[] = []
afterAll(() => {
  open.forEach((s) => s.close())
  rmSync(dir, { recursive: true, force: true })
})
let n = 0

/** SQL repository on a real database file; reload() reopens the file (a server restart). */
function createSqlEnv(options: { seed?: () => Dataset; businessId?: string } = {}): ContractEnv {
  const file = join(dir, `db-${n++}.sqlite`)
  const sql = openSqlite(file)
  open.push(sql)
  migrate(sql)
  insertDataset(sql, (options.seed ?? (() => buildDemoDataset(NOW)))())
  return envFor(file, sql, options.businessId ?? DEMO_BUSINESS_ID)
}

function envFor(file: string, sql: Sql, businessId: string): ContractEnv {
  const events = new EventBus()
  const repo = createSqlRepository({
    sql,
    businessId: () => businessId,
    events,
    now: () => NOW,
    images: createFileImageStore(join(dir, 'uploads')),
    // The contract's demo reset expects the plain (unprefixed) demo dataset.
    resetBusiness: (id) => {
      resetBusinessData(sql, id, NOW)
    },
  })
  return {
    repo,
    reload: () => {
      const reopened = openSqlite(file)
      open.push(reopened)
      return envFor(file, reopened, businessId)
    },
    as: (otherId) => envFor(file, sql, otherId),
  }
}

runRepositoryContract('SqlRepository', createSqlEnv)
