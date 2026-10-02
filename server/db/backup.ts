import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Sql } from './sqlite'

/**
 * Online, consistent backups with `VACUUM INTO` (safe while the app is running; the copy is
 * compact and self-contained). Keeps the newest `keep` files. Restore = stop the app, copy a
 * backup over DATABASE_PATH, start the app (see README "Backups").
 */
export function backupDatabase(sql: Sql, dir: string, keep: number, now = new Date()): { file: string; bytes: number; removed: string[] } {
  mkdirSync(dir, { recursive: true })
  const file = resolve(join(dir, `bookflow-${now.toISOString().replace(/[:.]/g, '-')}.sqlite`))
  sql.run('VACUUM INTO ?', [file])
  const backups = readdirSync(dir).filter((f) => /^bookflow-.*\.sqlite$/.test(f)).sort()
  const removed = backups.slice(0, Math.max(0, backups.length - keep))
  for (const f of removed) rmSync(join(dir, f), { force: true })
  return { file, bytes: statSync(file).size, removed }
}

/** Integrity check for readiness probes and after restores. */
export const integrityOk = (sql: Sql) => {
  const rows = sql.all<Record<string, string>>('PRAGMA quick_check')
  return rows.length === 1 && Object.values(rows[0])[0] === 'ok'
}
