import { migrations } from './migrations'
import type { Sql } from './sqlite'

/** Applies pending migrations in order, each atomically. Returns the ids applied. */
export function migrate(sql: Sql): string[] {
  sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const done = new Set(sql.all<{ id: string }>('SELECT id FROM schema_migrations').map((r) => r.id))
  const applied: string[] = []
  for (const m of migrations) {
    if (done.has(m.id)) continue
    sql.transaction(() => {
      sql.exec(m.sql)
      sql.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [m.id, new Date().toISOString()])
    })
    applied.push(m.id)
  }
  return applied
}
