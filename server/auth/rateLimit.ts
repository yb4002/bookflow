import type { Sql } from '../db/sqlite'

/**
 * Fixed-window limiter (per client, email, token…). With a database store, counters survive
 * restarts and are shared by every process using the same database; without one they live in
 * memory (tests, tools).
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly store?: { sql: Sql; name: string },
  ) {}

  /** Records an attempt; returns false when the key is over the limit. */
  attempt(key: string, now = Date.now()): boolean {
    if (this.store) {
      const { sql, name } = this.store
      const k = `${name}|${key}`
      // One statement: start a new window when the old one expired, otherwise count up.
      const row = sql.get<{ count: number }>(
        `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
           reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
         RETURNING count`,
        [k, now + this.windowMs, now, now],
      )
      return (row?.count ?? 1) <= this.max
    }
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    entry.count++
    return entry.count <= this.max
  }

  reset(key: string) {
    if (this.store) this.store.sql.run('DELETE FROM rate_limits WHERE key = ?', [`${this.store.name}|${key}`])
    else this.hits.delete(key)
  }

  clear() {
    if (this.store) this.store.sql.run('DELETE FROM rate_limits WHERE key >= ? AND key < ?', [`${this.store.name}|`, `${this.store.name}}`])
    else this.hits.clear()
  }
}

/** Housekeeping: drops expired windows. */
export const purgeRateLimits = (sql: Sql, now = Date.now()) => sql.run('DELETE FROM rate_limits WHERE reset_at <= ?', [now]).changes
