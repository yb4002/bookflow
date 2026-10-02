import { createHash, randomBytes } from 'node:crypto'
import { newId, slugify } from '../../src/domain/bookingRules'
import type { LanguageCode } from '../../src/domain/types'
import type { Sql } from '../db/sqlite'
import { hashPassword } from './passwords'
import { defaultPhoneCountry } from '../../src/domain/phone'

/** Sign-up and password-reset rules (no HTTP here — see app.ts). */

export type AccountErrorCode = 'invalid_email' | 'weak_password' | 'invalid_name' | 'email_taken' | 'invalid_token' | 'terms_required'
export class AccountError extends Error {
  constructor(public code: AccountErrorCode) {
    super(code)
    this.name = 'AccountError'
  }
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/
export const validEmail = (email: string) => EMAIL.test(email.trim()) && email.length <= 254
/** At least 8 characters, not trivially repetitive. */
export const strongEnough = (password: string) => password.length >= 8 && password.length <= 200 && new Set(password).size >= 4

export interface SignupInput {
  name: string
  email: string
  password: string
  businessName: string
  locale?: LanguageCode
  timezone?: string
  /** The Terms of Service and Privacy Policy were accepted (required). */
  acceptTerms?: boolean
}

/** Sensible starting hours: Sunday–Thursday in Hebrew, Monday–Friday otherwise, 09:00–17:00. */
function defaultHours(locale: LanguageCode) {
  const open = locale === 'he' ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5]
  return Array.from({ length: 7 }, (_, d) => ({ weekday: d, isOpen: open.includes(d) }))
}

function uniqueSlug(sql: Sql, businessName: string) {
  const taken = (slug: string) => sql.get('SELECT 1 FROM booking_links WHERE slug = ?', [slug]) !== undefined
  const base = slugify(businessName)
  if (base.length >= 3 && !['app', 'book', 'admin', 'api', 'login', 'signup'].includes(base) && !taken(base)) return base
  for (;;) {
    // Names without Latin letters (e.g. Hebrew) get a short random link; the owner can rename it.
    const candidate = `${base.length >= 3 ? base.slice(0, 33) : 'book'}-${randomBytes(3).toString('hex')}`
    if (!taken(candidate)) return candidate
  }
}

/** Creates the user, their business (unpublished, onboarding pending) and owner membership — atomically. */
export async function signUp(sql: Sql, input: SignupInput, now: Date, isValidTz: (tz: string) => boolean) {
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim().replace(/\s+/g, ' ')
  const businessName = input.businessName.trim().replace(/\s+/g, ' ')
  if (!validEmail(email)) throw new AccountError('invalid_email')
  if (name.length < 2 || name.length > 80 || businessName.length < 2 || businessName.length > 80) throw new AccountError('invalid_name')
  if (!strongEnough(input.password)) throw new AccountError('weak_password')
  if (input.acceptTerms !== true) throw new AccountError('terms_required')
  if (sql.get('SELECT 1 FROM users WHERE email = ?', [email])) throw new AccountError('email_taken')

  const passwordHash = await hashPassword(input.password) // async — done before the write transaction
  const locale: LanguageCode = input.locale === 'he' ? 'he' : 'en'
  const timezone = input.timezone && isValidTz(input.timezone) ? input.timezone : 'UTC'
  const ts = now.toISOString()
  const userId = newId('usr')
  const businessId = newId('biz')

  sql.transaction(() => {
    if (sql.get('SELECT 1 FROM users WHERE email = ?', [email])) throw new AccountError('email_taken') // race-safe re-check
    sql.run('INSERT INTO users (id, email, name, password_hash, created_at, terms_accepted_at) VALUES (?, ?, ?, ?, ?, ?)', [userId, email, name, passwordHash, ts, ts])
    sql.run(
      `INSERT INTO businesses (id, name, description, category, timezone, phone, email, address, created_at, updated_at)
       VALUES (?, ?, '', '', ?, '', ?, '', ?, ?)`,
      [businessId, businessName, timezone, email, ts, ts],
    )
    sql.run(
      `INSERT INTO business_settings (business_id, default_language, currency, reminder_hours_before, notification_channel, phone_country, updated_at)
       VALUES (?, ?, 'auto', '[24]', 'sms', ?, ?)`,
      [businessId, locale, defaultPhoneCountry(locale, timezone), ts],
    )
    for (const h of defaultHours(locale)) {
      sql.run("INSERT INTO business_hours (business_id, weekday, is_open, opens_at, closes_at) VALUES (?, ?, ?, '09:00', '17:00')", [businessId, h.weekday, h.isOpen ? 1 : 0])
    }
    sql.run('INSERT INTO booking_links (id, business_id, slug, is_primary, created_at) VALUES (?, ?, ?, 1, ?)', [newId('lnk'), businessId, uniqueSlug(sql, businessName), ts])
    sql.run("INSERT INTO memberships (user_id, business_id, role, created_at) VALUES (?, ?, 'owner', ?)", [userId, businessId, ts])
  })
  return { userId, businessId }
}

/* ---------------- Password reset ---------------- */

export const RESET_TTL_MS = 60 * 60_000
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Issues a single-use reset token for an existing user (returns null for unknown emails — callers stay silent). */
export function createPasswordReset(sql: Sql, email: string, now: Date): { token: string; userId: string; name: string; resetId: string } | null {
  const user = sql.get<{ id: string; name: string }>('SELECT id, name FROM users WHERE email = ?', [email.trim()])
  if (!user) return null
  const token = randomBytes(32).toString('base64url')
  const resetId = hashToken(token)
  sql.run('INSERT INTO password_resets (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [resetId, user.id, now.toISOString(), new Date(now.getTime() + RESET_TTL_MS).toISOString()])
  return { token, userId: user.id, name: user.name, resetId }
}

/** Sets a new password from a valid token; the token is spent and every existing session is revoked. */
export async function resetPassword(sql: Sql, token: string, password: string, now: Date): Promise<string> {
  if (!strongEnough(password)) throw new AccountError('weak_password')
  const id = hashToken(token)
  const row = sql.get<{ user_id: string; expires_at: string; used_at: string | null }>('SELECT user_id, expires_at, used_at FROM password_resets WHERE id = ?', [id])
  if (!row || row.used_at || row.expires_at <= now.toISOString()) throw new AccountError('invalid_token')
  const passwordHash = await hashPassword(password)
  sql.transaction(() => {
    const spent = sql.run('UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL', [now.toISOString(), id])
    if (!spent.changes) throw new AccountError('invalid_token') // raced with another use
    sql.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, row.user_id])
    sql.run('DELETE FROM sessions WHERE user_id = ?', [row.user_id])
    sql.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [now.toISOString(), row.user_id])
  })
  return row.user_id
}
