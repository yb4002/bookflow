import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

/**
 * Thin SQL adapter. Repositories only use `all/get/run/transaction`, so moving to
 * PostgreSQL means re-implementing this file (e.g. with `pg`) — not the queries'
 * callers. Parameters are always bound (never string-concatenated).
 */
export type Params = Record<string, SQLInputValue> | SQLInputValue[]

export interface Sql {
  all<T>(sql: string, params?: Params): T[]
  get<T>(sql: string, params?: Params): T | undefined
  run(sql: string, params?: Params): { changes: number }
  exec(sql: string): void
  /** Serializable write transaction; rolls back on throw. Nested calls join the outer one. */
  transaction<T>(fn: () => T): T
  close(): void
}

const bind = (params?: Params) => (params === undefined ? [] : Array.isArray(params) ? params : [params])

export function openSqlite(path: string): Sql {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
  }
  let depth = 0

  return {
    all: <T,>(sql: string, params?: Params) => db.prepare(sql).all(...(bind(params) as SQLInputValue[])) as T[],
    get: <T,>(sql: string, params?: Params) => db.prepare(sql).get(...(bind(params) as SQLInputValue[])) as T | undefined,
    run: (sql, params) => {
      const r = db.prepare(sql).run(...(bind(params) as SQLInputValue[]))
      return { changes: Number(r.changes) }
    },
    exec: (sql) => db.exec(sql),
    transaction(fn) {
      if (depth > 0) return fn()
      // IMMEDIATE takes the write lock up front: concurrent bookings are serialized,
      // so "check slot is free → insert" cannot interleave (no double booking).
      db.exec('BEGIN IMMEDIATE')
      depth++
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      } finally {
        depth--
      }
    },
    close: () => db.close(),
  }
}
