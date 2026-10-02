import { describe, expect, it } from 'vitest'
import { migrate } from '../db/migrate'
import { openSqlite } from '../db/sqlite'
import { purgeRateLimits, RateLimiter } from './rateLimit'

const db = () => {
  const sql = openSqlite(':memory:')
  migrate(sql)
  return sql
}

describe('RateLimiter (database store)', () => {
  it('counts per key within a window, then starts a new window', () => {
    const sql = db()
    const limiter = new RateLimiter(2, 60_000, { sql, name: 'login' })
    expect([limiter.attempt('a', 0), limiter.attempt('a', 1), limiter.attempt('a', 2)]).toEqual([true, true, false])
    expect(limiter.attempt('b', 2)).toBe(true)
    expect(limiter.attempt('a', 60_000)).toBe(true) // window expired
  })

  it('is shared by limiters on the same database and survives a new instance', () => {
    const sql = db()
    new RateLimiter(1, 60_000, { sql, name: 'signup' }).attempt('ip', 0)
    expect(new RateLimiter(1, 60_000, { sql, name: 'signup' }).attempt('ip', 1)).toBe(false)
    expect(new RateLimiter(1, 60_000, { sql, name: 'reset' }).attempt('ip', 1)).toBe(true) // other limiter, other counter
  })

  it('purge drops only expired windows', () => {
    const sql = db()
    const limiter = new RateLimiter(1, 60_000, { sql, name: 'login' })
    limiter.attempt('old', 0)
    limiter.attempt('fresh', 30_000)
    expect(purgeRateLimits(sql, 60_000)).toBe(1)
    expect(limiter.attempt('fresh', 60_001)).toBe(false) // still counted
    expect(limiter.attempt('old', 60_001)).toBe(true)
  })
})
