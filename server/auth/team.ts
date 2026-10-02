import { createHash, randomBytes } from 'node:crypto'
import { newId } from '../../src/domain/bookingRules'
import type { Sql } from '../db/sqlite'
import { AccountError, strongEnough, validEmail } from './accounts'
import { hashPassword, verifyPassword } from './passwords'

/**
 * Team access (who can sign in to a business, and as what) and account security.
 * No HTTP here — routes live in app.ts. Tokens are random, emailed once, stored hashed.
 */

export type Role = 'owner' | 'staff'
export const INVITE_TTL_MS = 7 * 86_400_000
export const VERIFY_TTL_MS = 3 * 86_400_000
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const token = () => randomBytes(32).toString('base64url')

export type TeamErrorCode = 'forbidden' | 'last_owner' | 'already_member' | 'not_found' | 'wrong_password'
export class TeamError extends Error {
  constructor(public code: TeamErrorCode) {
    super(code)
    this.name = 'TeamError'
  }
}

export interface Member {
  userId: string
  name: string
  email: string
  role: Role
  staffId?: string
  joinedAt: string
  lastLoginAt?: string
}
export interface Invitation {
  id: string
  email: string
  role: Role
  staffId?: string
  createdAt: string
  expiresAt: string
}

export function listMembers(sql: Sql, businessId: string): Member[] {
  return sql
    .all<{ user_id: string; name: string; email: string; role: Role; staff_id: string | null; created_at: string; last_login_at: string | null }>(
      `SELECT m.user_id, u.name, u.email, m.role, m.staff_id, m.created_at, u.last_login_at
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = ? ORDER BY m.role = 'owner' DESC, m.created_at`,
      [businessId],
    )
    .map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role, staffId: r.staff_id ?? undefined, joinedAt: r.created_at, lastLoginAt: r.last_login_at ?? undefined }))
}

export function listInvitations(sql: Sql, businessId: string, now: Date): Invitation[] {
  return sql
    .all<{ public_id: string; email: string; role: Role; staff_id: string | null; created_at: string; expires_at: string }>(
      'SELECT public_id, email, role, staff_id, created_at, expires_at FROM invitations WHERE business_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at',
      [businessId, now.toISOString()],
    )
    .map((r) => ({ id: r.public_id, email: r.email, role: r.role, staffId: r.staff_id ?? undefined, createdAt: r.created_at, expiresAt: r.expires_at }))
}

const validRole = (role: unknown): role is Role => role === 'owner' || role === 'staff'
const validStaff = (sql: Sql, businessId: string, staffId: unknown) =>
  staffId === undefined || staffId === null || (typeof staffId === 'string' && !!sql.get('SELECT 1 FROM staff WHERE business_id = ? AND id = ? AND deleted_at IS NULL', [businessId, staffId]))

/** Creates (or renews) an invitation; returns the raw token for the email link. */
export function invite(sql: Sql, input: { businessId: string; email: unknown; role: unknown; staffId?: unknown; invitedBy: string }, now: Date): { token: string; invitation: Invitation } {
  if (typeof input.email !== 'string' || !validEmail(input.email)) throw new AccountError('invalid_email')
  if (!validRole(input.role) || !validStaff(sql, input.businessId, input.staffId)) throw new AccountError('invalid_name')
  const email = input.email.trim().toLowerCase()
  if (sql.get('SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = ? AND u.email = ?', [input.businessId, email])) throw new TeamError('already_member')
  const raw = token()
  const publicId = newId('inv')
  const ts = now.toISOString()
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString()
  sql.transaction(() => {
    // One open invitation per email: a new one replaces the previous link.
    sql.run('UPDATE invitations SET revoked_at = ? WHERE business_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL', [ts, input.businessId, email])
    sql.run(
      'INSERT INTO invitations (id, public_id, business_id, email, role, staff_id, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [hash(raw), publicId, input.businessId, email, input.role as Role, (input.staffId as string | undefined) ?? null, input.invitedBy, ts, expiresAt],
    )
  })
  return { token: raw, invitation: { id: publicId, email, role: input.role as Role, staffId: (input.staffId as string | undefined) ?? undefined, createdAt: ts, expiresAt } }
}

export function revokeInvitation(sql: Sql, businessId: string, publicId: string, now: Date) {
  const r = sql.run('UPDATE invitations SET revoked_at = ? WHERE business_id = ? AND public_id = ? AND accepted_at IS NULL AND revoked_at IS NULL', [now.toISOString(), businessId, publicId])
  if (!r.changes) throw new TeamError('not_found')
}

interface OpenInvitation { id: string; business_id: string; business_name: string; email: string; role: Role; staff_id: string | null }
function openInvitation(sql: Sql, raw: string, now: Date): OpenInvitation {
  const row = sql.get<OpenInvitation>(
    `SELECT i.id, i.business_id, b.name AS business_name, i.email, i.role, i.staff_id FROM invitations i JOIN businesses b ON b.id = i.business_id
     WHERE i.id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?`,
    [hash(typeof raw === 'string' ? raw : ''), now.toISOString()],
  )
  if (!row) throw new AccountError('invalid_token')
  return row
}

/** What the accept page shows before the invitee signs in or creates an account. */
export function describeInvitation(sql: Sql, raw: string, now: Date) {
  const inv = openInvitation(sql, raw, now)
  const existing = sql.get('SELECT 1 FROM users WHERE email = ?', [inv.email]) !== undefined
  return { businessName: inv.business_name, email: inv.email, role: inv.role, existingUser: existing }
}

/**
 * Accepts an invitation. New people choose a name and password; someone who already has a
 * BookFlow account proves it with their password. Returns the user and business to sign into.
 */
export async function acceptInvitation(sql: Sql, input: { token: string; name?: string; password: string }, now: Date): Promise<{ userId: string; businessId: string }> {
  const inv = openInvitation(sql, input.token, now)
  if (typeof input.password !== 'string') throw new AccountError('weak_password')
  const user = sql.get<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = ?', [inv.email])
  let userId: string
  let passwordHash: string | undefined
  if (user) {
    if (!(await verifyPassword(input.password, user.password_hash))) throw new TeamError('wrong_password')
    userId = user.id
  } else {
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : ''
    if (name.length < 2 || name.length > 80) throw new AccountError('invalid_name')
    if (!strongEnough(input.password)) throw new AccountError('weak_password')
    passwordHash = await hashPassword(input.password)
    userId = newId('usr')
    input = { ...input, name }
  }
  const ts = now.toISOString()
  sql.transaction(() => {
    const spent = sql.run('UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL', [ts, inv.id])
    if (!spent.changes) throw new AccountError('invalid_token')
    if (passwordHash) {
      // The invitation was emailed to this address, so accepting it verifies the email.
      sql.run('INSERT INTO users (id, email, name, password_hash, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?)', [userId, inv.email, input.name!, passwordHash, ts, ts])
    } else {
      sql.run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', [ts, userId])
    }
    sql.run(
      `INSERT INTO memberships (user_id, business_id, role, staff_id, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, business_id) DO NOTHING`,
      [userId, inv.business_id, inv.role, inv.staff_id, ts],
    )
  })
  return { userId, businessId: inv.business_id }
}

const ownerCount = (sql: Sql, businessId: string) => Number(sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE business_id = ? AND role = 'owner'", [businessId])!.n)

/** Changes someone's role / linked calendar. A business always keeps at least one owner. */
export function updateMember(sql: Sql, businessId: string, userId: string, change: { role?: unknown; staffId?: unknown }) {
  sql.transaction(() => {
    const m = sql.get<{ role: Role }>('SELECT role FROM memberships WHERE business_id = ? AND user_id = ?', [businessId, userId])
    if (!m) throw new TeamError('not_found')
    if (change.role !== undefined && !validRole(change.role)) throw new AccountError('invalid_name')
    if (!validStaff(sql, businessId, change.staffId)) throw new AccountError('invalid_name')
    if (m.role === 'owner' && change.role === 'staff' && ownerCount(sql, businessId) <= 1) throw new TeamError('last_owner')
    sql.run('UPDATE memberships SET role = COALESCE(?, role), staff_id = ? WHERE business_id = ? AND user_id = ?', [
      (change.role as Role | undefined) ?? null,
      change.staffId === undefined ? (sql.get<{ staff_id: string | null }>('SELECT staff_id FROM memberships WHERE business_id = ? AND user_id = ?', [businessId, userId])!.staff_id) : ((change.staffId as string | null) ?? null),
      businessId,
      userId,
    ])
    // A demoted owner's open sessions pick up the new role on their next request (role is read per request).
  })
}

/** Removes someone's access to the business; their sessions for it end immediately. */
export function removeMember(sql: Sql, businessId: string, userId: string) {
  sql.transaction(() => {
    const m = sql.get<{ role: Role }>('SELECT role FROM memberships WHERE business_id = ? AND user_id = ?', [businessId, userId])
    if (!m) throw new TeamError('not_found')
    if (m.role === 'owner' && ownerCount(sql, businessId) <= 1) throw new TeamError('last_owner')
    sql.run('DELETE FROM sessions WHERE user_id = ? AND active_business_id = ?', [userId, businessId])
    sql.run('DELETE FROM memberships WHERE business_id = ? AND user_id = ?', [businessId, userId])
  })
}

/* ---------------- Account security ---------------- */

/** Requires the current password; signs out every other session of the user. */
export async function changePassword(sql: Sql, userId: string, currentSessionId: string, current: unknown, next: unknown) {
  if (typeof current !== 'string' || typeof next !== 'string') throw new AccountError('weak_password')
  const user = sql.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [userId])
  if (!user || !(await verifyPassword(current, user.password_hash))) throw new TeamError('wrong_password')
  if (!strongEnough(next)) throw new AccountError('weak_password')
  const passwordHash = await hashPassword(next)
  sql.transaction(() => {
    sql.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId])
    sql.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, currentSessionId])
    sql.run('UPDATE password_resets SET used_at = COALESCE(used_at, ?) WHERE user_id = ?', [new Date().toISOString(), userId])
  })
}

export const signOutOtherSessions = (sql: Sql, userId: string, currentSessionId: string) => sql.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, currentSessionId]).changes

export function updateProfile(sql: Sql, userId: string, name: unknown) {
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
  if (clean.length < 2 || clean.length > 80) throw new AccountError('invalid_name')
  sql.run('UPDATE users SET name = ? WHERE id = ?', [clean, userId])
}

/** Issues an email-verification token for the user's current email (null if already verified). */
export function createEmailVerification(sql: Sql, userId: string, now: Date): { token: string; email: string; name: string } | null {
  const user = sql.get<{ email: string; name: string; email_verified_at: string | null }>('SELECT email, name, email_verified_at FROM users WHERE id = ?', [userId])
  if (!user || user.email_verified_at) return null
  const raw = token()
  sql.run('INSERT INTO email_verifications (id, user_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [hash(raw), userId, user.email, now.toISOString(), new Date(now.getTime() + VERIFY_TTL_MS).toISOString()])
  return { token: raw, email: user.email, name: user.name }
}

export function verifyEmail(sql: Sql, raw: unknown, now: Date): string {
  const row = sql.get<{ id: string; user_id: string; email: string }>(
    'SELECT id, user_id, email FROM email_verifications WHERE id = ? AND used_at IS NULL AND expires_at > ?',
    [hash(typeof raw === 'string' ? raw : ''), now.toISOString()],
  )
  if (!row) throw new AccountError('invalid_token')
  sql.transaction(() => {
    sql.run('UPDATE email_verifications SET used_at = ? WHERE id = ?', [now.toISOString(), row.id])
    // Only verifies the address the link was sent to (if the email changed since, nothing happens).
    sql.run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ? AND email = ?', [now.toISOString(), row.user_id, row.email])
  })
  return row.user_id
}

/** Every business the user can act for (for the business switcher). */
export const userBusinesses = (sql: Sql, userId: string) =>
  sql.all<{ id: string; name: string; role: Role }>('SELECT b.id, b.name, m.role FROM memberships m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ? ORDER BY b.name', [userId])
