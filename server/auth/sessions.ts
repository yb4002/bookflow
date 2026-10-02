import { createHash, randomBytes } from 'node:crypto'
import type { Sql } from '../db/sqlite'

export const SESSION_COOKIE = 'bf_session'
export const SESSION_TTL_DAYS = 30

export interface AuthContext {
  sessionId: string
  user: { id: string; email: string; name: string }
  businessId: string
  role: 'owner' | 'staff'
  /** The team member (calendar) this login is linked to, if any. */
  staffId?: string
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Creates a session for a membership; returns the raw token (sent once, as a cookie). */
export function createSession(sql: Sql, userId: string, businessId: string, now: Date, userAgent?: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 864e5)
  sql.run('INSERT INTO sessions (id, user_id, active_business_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    hashToken(token), userId, businessId, now.toISOString(), expiresAt.toISOString(), now.toISOString(), userAgent?.slice(0, 200) ?? null,
  ])
  return { token, expiresAt }
}

/** Resolves a cookie token to the signed-in user and their active business (or null). */
export function readSession(sql: Sql, token: string | undefined, now: Date): AuthContext | null {
  if (!token) return null
  const row = sql.get<{ id: string; user_id: string; email: string; name: string; business_id: string; role: 'owner' | 'staff'; staff_id: string | null; expires_at: string; last_seen_at: string | null }>(
    `SELECT s.id, s.user_id, u.email, u.name, m.business_id, m.role, m.staff_id, s.expires_at, s.last_seen_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN memberships m ON m.user_id = s.user_id AND m.business_id = s.active_business_id
     WHERE s.id = ?`,
    [hashToken(token)],
  )
  if (!row) return null
  if (row.expires_at <= now.toISOString()) {
    sql.run('DELETE FROM sessions WHERE id = ?', [row.id])
    return null
  }
  // Activity stamp, at most every 10 minutes (cheap; used to show signed-in devices).
  if (!row.last_seen_at || now.getTime() - Date.parse(row.last_seen_at) > 10 * 60_000) sql.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now.toISOString(), row.id])
  const auth: AuthContext = { sessionId: row.id, user: { id: row.user_id, email: row.email, name: row.name }, businessId: row.business_id, role: row.role }
  if (row.staff_id) auth.staffId = row.staff_id
  return auth
}

export const deleteSession = (sql: Sql, sessionId: string) => sql.run('DELETE FROM sessions WHERE id = ?', [sessionId])
export const purgeExpiredSessions = (sql: Sql, now: Date) => sql.run('DELETE FROM sessions WHERE expires_at <= ?', [now.toISOString()])
