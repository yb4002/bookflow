import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { streamSSE } from 'hono/streaming'
import { BookingError, type BookingErrorCode } from '../src/domain/errors'
import type { AppointmentStatus, AvailabilityOffer, CancellationReason, Service } from '../src/domain/types'
import type { AppointmentMove, BookFlowRepository, BusinessBookingInput, BusinessUpdate, CustomerInput, NewBookingInput } from '../src/data/repositories/types'
import { bodyLimit } from 'hono/body-limit'
import { randomUUID } from 'node:crypto'
import { nullLogger, type Logger } from './log'
import { clientIp, originCheck, securityHeaders } from './security'
import { isValidTimeZone, type ServiceInput, type StaffInput } from '../src/domain/bookingRules'
import { AccountError, createPasswordReset, resetPassword, signUp, type SignupInput } from './auth/accounts'
import { RateLimiter } from './auth/rateLimit'
import { sendInvitationEmail, sendPasswordResetEmail, sendVerificationEmail } from './notifications/accountMailer'
import { acceptInvitation, changePassword, createEmailVerification, describeInvitation, invite, listInvitations, listMembers, removeMember, revokeInvitation, signOutOtherSessions, TeamError, updateMember, updateProfile, userBusinesses, verifyEmail } from './auth/team'
import { createFileImageStore } from './storage/images'
import { hashPassword, verifyPassword } from './auth/passwords'
import { createSession, deleteSession, readSession, SESSION_COOKIE, SESSION_TTL_DAYS, type AuthContext } from './auth/sessions'
import { DEMO, resetBusinessData } from './db/seed'
import type { Sql } from './db/sqlite'
import { EventBus } from './events'
import { createSqlRepository } from './repositories/sqlRepository'
import { NotificationEngine } from './notifications/engine'
import type { ProviderRegistry } from './notifications/provider'
import { handleInboundMessage } from './notifications/inbound'
import { resendReceiptStatus, verifyResendSignature } from './notifications/providers/resend'
import { twilioReceiptStatus, verifyTwilioSignature } from './notifications/providers/twilio'
import type { MessagingStatus } from './notifications/setup'
import { BillingError, type Billing } from './billing/service'
import { listActivity } from './activity'

export interface AppOptions {
  sql: Sql
  now?: () => Date
  /** Demo conveniences: one-click demo login and "Restore demo data". */
  demoMode?: boolean
  /** Test-only endpoint to reseed everything (never enable in production). */
  testMode?: boolean
  /** Send the session cookie with `Secure` (production over HTTPS). */
  secureCookies?: boolean
  onTestReset?: () => void
  /** Notification providers (dev/mock today). Omit to run without the notification engine. */
  providers?: ProviderRegistry
  /** Origin used for links inside customer messages. */
  publicBaseUrl?: string
  /** Where uploaded logos/covers are stored. Omit to disable uploads. */
  uploadsDir?: string
  /** Which channels really send (shown to businesses). */
  messagingStatus?: MessagingStatus
  /** Secrets for verifying provider webhooks. A webhook without its secret is disabled. */
  webhooks?: { twilioAuthToken?: string; resendWebhookSecret?: string }
  /** Subscriptions (plans, trial, Stripe). Omit = no billing: full access for everyone. */
  billing?: Billing
  /** Read client IPs from X-Forwarded-For (only behind a trusted reverse proxy). */
  trustProxy?: boolean
  /** Reject state-changing browser requests from other origins (production: the public origin). */
  allowedOrigin?: string
  logger?: Logger
  /** Bearer token for /api/metrics; unset = disabled. */
  metricsToken?: string
  /** Extra readiness checks (e.g. background jobs healthy). */
  readiness?: () => Record<string, boolean>
}

type Env = { Variables: { auth: AuthContext; repo: BookFlowRepository } }

const STATUS: Record<BookingErrorCode, 400 | 404 | 409> = {
  invalid_input: 400,
  invalid_slug: 400,
  not_found: 404,
  slot_unavailable: 409,
  slug_taken: 409,
  already_cancelled: 409,
  not_changeable: 409,
  change_window_closed: 409,
  not_published: 404,
  in_use: 409,
  invalid_image: 400,
  not_ready: 409,
  booking_paused: 409,
  plan_limit: 409,
  duplicate: 409,
  opted_out: 409,
  no_contact: 409,
}
const APPOINTMENT_STATUSES: AppointmentStatus[] = ['confirmed', 'pending', 'completed', 'cancelled', 'no_show']
const REASONS: CancellationReason[] = ['schedule_conflict', 'unwell', 'found_alternative', 'other']

/** The BookFlow API. Pure function of its options, so tests drive it in-process (`app.request`). */
export function createApp({ sql, now = () => new Date(), demoMode = false, testMode = false, secureCookies = false, onTestReset, providers, publicBaseUrl = 'http://localhost:5173', uploadsDir, messagingStatus, webhooks = {}, billing, trustProxy = false, allowedOrigin, logger = nullLogger, metricsToken, readiness }: AppOptions) {
  const app = new Hono<Env>()
  const events = new EventBus()
  const startedAt = Date.now()
  const counters = { requests: 0, errors5xx: 0, rateLimited: 0 }
  // Business logic emits domain events; the engine turns them into outbox rows (same transaction).
  const engine = providers ? new NotificationEngine({ sql, providers, now, publicBaseUrl, events, log: testMode ? undefined : (m) => logger.info(m) }) : undefined
  const loginLimiter = new RateLimiter(10, 15 * 60_000)
  const signupLimiter = new RateLimiter(10, 60 * 60_000)
  const resetLimiter = new RateLimiter(5, 60 * 60_000)
  const inviteViewLimiter = new RateLimiter(60, 15 * 60_000)
  const images = uploadsDir ? createFileImageStore(uploadsDir) : undefined
  // Equalizes timing for unknown emails (no account enumeration via response time).
  const dummyHash = hashPassword('not-a-real-password')

  const repoFor = (businessId: string, canPreview?: (id: string) => boolean) =>
    createSqlRepository({
      sql,
      businessId: () => businessId,
      events,
      now,
      resetBusiness: demoMode ? (id) => resetBusinessData(sql, id, now()) : undefined,
      onDomainEvent: engine?.handle,
      images,
      canPreview,
      entitled: billing?.isEntitled,
      staffLimit: billing?.staffLimit,
    })
  const clientKey = (c: Context) => clientIp(c, trustProxy)

  const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429, code: string) => {
    if (status === 429) counters.rateLimited++
    return c.json({ error: { code } }, status)
  }

  // Request id + access log (path only — query strings can carry tokens).
  app.use('*', async (c, next) => {
    const id = c.req.header('x-request-id')?.slice(0, 64) || randomUUID()
    c.header('x-request-id', id)
    const t0 = performance.now()
    await next()
    counters.requests++
    if (c.res.status >= 500) counters.errors5xx++
    if (c.req.path.startsWith('/api/') && c.req.path !== '/api/health') {
      logger.info('request', { requestId: id, method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - t0) })
    }
  })
  app.use('*', securityHeaders({ hsts: secureCookies }))
  if (allowedOrigin) app.use('/api/*', originCheck(allowedOrigin))

  app.onError((err, c) => {
    if (err instanceof BookingError) return fail(c, STATUS[err.code], err.code)
    if (err instanceof AccountError) return fail(c, err.code === 'email_taken' ? 409 : 400, err.code)
    if (err instanceof BillingError) return c.json({ error: { code: err.code } }, err.code === 'billing_disabled' ? 404 : err.code === 'invalid_plan' ? 400 : err.code === 'no_customer' ? 409 : err.code === 'invalid_signature' ? 403 : 502)
    if (err instanceof TeamError) return fail(c, err.code === 'not_found' ? 404 : err.code === 'forbidden' ? 403 : err.code === 'wrong_password' ? 400 : 409, err.code)
    logger.error('unhandled error', { err, method: c.req.method, path: c.req.path, requestId: c.res.headers.get('x-request-id') ?? undefined })
    return c.json({ error: { code: 'internal' } }, 500)
  })

  // CSRF: browsers can't send JSON cross-site without a CORS preflight (which we never grant),
  // so requiring JSON on every state-changing request blocks form-based CSRF.
  // Provider webhooks are exempt: they're authenticated by their HMAC signatures instead.
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/webhooks/')) return next()
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !c.req.header('content-type')?.includes('application/json')) return fail(c, 415, 'json_required')
    await next()
  })
  // Request size caps: image uploads (base64) up to 3 MB, everything else 100 KB.
  const tooLarge = (c: Context) => fail(c, 413, 'too_large')
  app.use('/api/app/business/images/*', bodyLimit({ maxSize: 3 * 1024 * 1024, onError: tooLarge }))
  app.use('/api/app/customers/import', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: tooLarge }))
  const bigBody = (p: string) => p.startsWith('/api/app/business/images/') || p === '/api/app/customers/import'
  app.use('/api/*', async (c, next) => (bigBody(c.req.path) ? next() : bodyLimit({ maxSize: 100 * 1024, onError: tooLarge })(c, next)))

  const body = async <T,>(c: Context): Promise<T> => {
    try {
      return (await c.req.json()) as T
    } catch {
      throw new BookingError('invalid_input')
    }
  }
  /** Issues a session cookie and returns the signed-in profile. */
  const startSession = (c: Context, userId: string, businessId: string) => {
    const { token } = createSession(sql, userId, businessId, now(), c.req.header('user-agent'))
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: secureCookies, path: '/', maxAge: SESSION_TTL_DAYS * 86400 })
    sql.run('UPDATE users SET last_login_at = ? WHERE id = ?', [now().toISOString(), userId])
    return me(readSession(sql, token, now())!)
  }
  const me = (auth: AuthContext) => {
    const b = sql.get<{ id: string; name: string; onboarding_completed_at: string | null; published_at: string | null }>(
      'SELECT id, name, onboarding_completed_at, published_at FROM businesses WHERE id = ?',
      [auth.businessId],
    )!
    const u = sql.get<{ email_verified_at: string | null }>('SELECT email_verified_at FROM users WHERE id = ?', [auth.user.id])
    return {
      user: { ...auth.user, emailVerified: !!u?.email_verified_at },
      role: auth.role,
      staffId: auth.staffId,
      business: { id: b.id, name: b.name, onboardingCompleted: !!b.onboarding_completed_at, published: !!b.published_at, demo: Object.values(DEMO).some((d) => d.businessId === b.id) },
      businesses: userBusinesses(sql, auth.user.id),
    }
  }
  const baseUrl = publicBaseUrl.replace(/\/$/, '')
  const localeOf = (v: unknown) => (v === 'he' ? 'he' : 'en') as 'he' | 'en'
  /** Sends a verification link (best effort — never fails the calling request). */
  const sendVerification = async (userId: string, locale: 'en' | 'he') => {
    const v = createEmailVerification(sql, userId, now())
    if (!v || !providers) return
    await sendVerificationEmail(providers, { to: v.email, name: v.name.split(' ')[0], link: `${baseUrl}/verify-email?token=${v.token}`, locale, idempotencyKey: v.token.slice(0, 16) }).catch(() => undefined)
  }
  /** The signed-in user for /api/auth/* routes that need one. */
  const sessionOf = (c: Context) => readSession(sql, getCookie(c, SESSION_COOKIE), now())
  const requireOwner = (c: Context<Env>) => (c.var.auth.role === 'owner' ? null : fail(c, 403, 'forbidden'))

  /* ---------------- Auth ---------------- */

  app.post('/api/auth/login', async (c) => {
    const { email, password } = await body<{ email?: string; password?: string }>(c)
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) return fail(c, 400, 'invalid_input')
    const key = `${clientKey(c)}|${email.toLowerCase()}`
    if (!loginLimiter.attempt(key)) return fail(c, 429, 'rate_limited')

    const user = sql.get<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = ?', [email.trim()])
    const ok = user ? await verifyPassword(password, user.password_hash) : (await verifyPassword(password, await dummyHash), false)
    if (!user || !ok) return fail(c, 401, 'invalid_credentials')
    // First business the user belongs to (owners first); a business switcher can change it later.
    const membership = sql.get<{ business_id: string }>("SELECT business_id FROM memberships WHERE user_id = ? ORDER BY role = 'owner' DESC, created_at LIMIT 1", [user.id])
    if (!membership) return fail(c, 403, 'no_business')
    loginLimiter.reset(key)
    return c.json(startSession(c, user.id, membership.business_id))
  })

  /** Demo mode only: sign in as the Luna Hair Studio owner without a password. */
  app.post('/api/auth/demo-login', async (c) => {
    if (!demoMode) return fail(c, 404, 'not_found')
    const user = sql.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [DEMO.luna.ownerEmail])
    if (!user) return fail(c, 404, 'not_found')
    return c.json(startSession(c, user.id, DEMO.luna.businessId))
  })

  /** Self-service sign-up: creates the user, their business and an owner session. */
  app.post('/api/auth/signup', async (c) => {
    if (!signupLimiter.attempt(clientKey(c))) return fail(c, 429, 'rate_limited')
    const input = await body<SignupInput>(c)
    if ([input.name, input.email, input.password, input.businessName].some((v) => typeof v !== 'string')) return fail(c, 400, 'invalid_input')
    const { userId, businessId } = await signUp(sql, input, now(), isValidTimeZone)
    billing?.startTrial(businessId)
    const profile = startSession(c, userId, businessId)
    await sendVerification(userId, localeOf(input.locale))
    return c.json(profile, 201)
  })

  /** Always answers the same way, whether or not the email has an account (no account enumeration). */
  app.post('/api/auth/forgot-password', async (c) => {
    const { email, locale } = await body<{ email?: string; locale?: string }>(c)
    if (typeof email !== 'string' || !email) return fail(c, 400, 'invalid_input')
    if (!resetLimiter.attempt(`${clientKey(c)}|${email.toLowerCase()}`)) return fail(c, 429, 'rate_limited')
    const reset = createPasswordReset(sql, email, now())
    if (reset && providers) {
      const link = `${publicBaseUrl.replace(/\/$/, '')}/reset-password?token=${reset.token}`
      const user = sql.get<{ email: string }>('SELECT email FROM users WHERE id = ?', [reset.userId])!
      await sendPasswordResetEmail(providers, { to: user.email, name: reset.name.split(' ')[0], link, locale: locale === 'he' ? 'he' : 'en', idempotencyKey: reset.resetId })
    }
    return c.json({ ok: true })
  })

  app.post('/api/auth/reset-password', async (c) => {
    const { token, password } = await body<{ token?: string; password?: string }>(c)
    if (typeof token !== 'string' || typeof password !== 'string') return fail(c, 400, 'invalid_input')
    const userId = await resetPassword(sql, token, password, now())
    const membership = sql.get<{ business_id: string }>("SELECT business_id FROM memberships WHERE user_id = ? ORDER BY role = 'owner' DESC, created_at LIMIT 1", [userId])
    if (!membership) return c.json({ ok: true })
    return c.json(startSession(c, userId, membership.business_id))
  })

  app.post('/api/auth/logout', async (c) => {
    const auth = readSession(sql, getCookie(c, SESSION_COOKIE), now())
    if (auth) deleteSession(sql, auth.sessionId)
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/api/auth/me', (c) => {
    const auth = readSession(sql, getCookie(c, SESSION_COOKIE), now())
    if (!auth) return fail(c, 401, 'unauthenticated')
    return c.json({ ...me(auth), demoMode })
  })

  // Public, non-secret settings for the web app (demo mode; who operates the service, for legal pages).
  const operator = { name: process.env.LEGAL_OPERATOR_NAME, email: process.env.LEGAL_CONTACT_EMAIL, address: process.env.LEGAL_ADDRESS }
  const priceOf = (v?: string) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined)
  const pricing = process.env.PRICE_CURRENCY ? { currency: process.env.PRICE_CURRENCY, solo: priceOf(process.env.PRICE_SOLO), team: priceOf(process.env.PRICE_TEAM), business: priceOf(process.env.PRICE_BUSINESS) } : null
  app.get('/api/config', (c) => c.json({ demoMode, operator, pricing }))

  /* ---------------- Operations ---------------- */

  /** Liveness: the process is up. */
  app.get('/api/health', (c) => c.json({ ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000) }))
  /** Readiness: the database answers and background jobs are healthy. */
  app.get('/api/ready', (c) => {
    let db = false
    try {
      db = sql.get<{ ok: number }>('SELECT 1 AS ok')?.ok === 1
    } catch {
      db = false
    }
    const checks = { database: db, ...(readiness?.() ?? {}) }
    const ok = Object.values(checks).every(Boolean)
    return c.json({ ok, checks }, ok ? 200 : 503)
  })
  /** Prometheus text metrics (bearer token). */
  app.get('/api/metrics', (c) => {
    if (!metricsToken || c.req.header('authorization') !== `Bearer ${metricsToken}`) return fail(c, 404, 'not_found')
    const q = (s: string) => Number(sql.get<{ n: number }>(s)?.n ?? 0)
    const lines = [
      ['bookflow_uptime_seconds', Math.round((Date.now() - startedAt) / 1000)],
      ['bookflow_http_requests_total', counters.requests],
      ['bookflow_http_5xx_total', counters.errors5xx],
      ['bookflow_rate_limited_total', counters.rateLimited],
      ['bookflow_businesses', q('SELECT COUNT(*) AS n FROM businesses')],
      ['bookflow_notifications_pending', q("SELECT COUNT(*) AS n FROM notifications WHERE status = 'pending'")],
      ['bookflow_notifications_overdue', q(`SELECT COUNT(*) AS n FROM notifications WHERE status = 'pending' AND scheduled_for < '${new Date(now().getTime() - 10 * 60_000).toISOString()}'`)],
      ['bookflow_notifications_failed_24h', q(`SELECT COUNT(*) AS n FROM notifications WHERE status = 'failed' AND updated_at > '${new Date(now().getTime() - 86_400_000).toISOString()}'`)],
    ]
    return c.text(lines.map(([k, v]) => `${k} ${v}`).join('\n') + '\n', 200, { 'content-type': 'text/plain; version=0.0.4' })
  })
  /** Front-end errors (crashes, unhandled rejections) reported by browsers — logged for monitoring. */
  const clientErrorLimiter = new RateLimiter(20, 60_000)
  app.post('/api/client-errors', async (c) => {
    if (!clientErrorLimiter.attempt(clientKey(c))) return fail(c, 429, 'rate_limited')
    const e = await body<{ message?: string; stack?: string; url?: string; source?: string }>(c)
    const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined)
    // Strip query strings from the reported URL (tokens).
    logger.warn('client error', { message: clip(e.message, 300), source: clip(e.source, 40), url: clip(e.url, 200)?.split('?')[0], stack: clip(e.stack, 1500) })
    return c.body(null, 204)
  })

  /* Account security (signed-in user). */
  app.patch('/api/auth/profile', async (c) => {
    const auth = sessionOf(c)
    if (!auth) return fail(c, 401, 'unauthenticated')
    updateProfile(sql, auth.user.id, (await body<{ name?: string }>(c)).name)
    return c.json(me(readSession(sql, getCookie(c, SESSION_COOKIE), now())!))
  })
  app.post('/api/auth/change-password', async (c) => {
    const auth = sessionOf(c)
    if (!auth) return fail(c, 401, 'unauthenticated')
    if (!loginLimiter.attempt(`pw|${auth.user.id}`)) return fail(c, 429, 'rate_limited')
    const { currentPassword, newPassword } = await body<{ currentPassword?: string; newPassword?: string }>(c)
    await changePassword(sql, auth.user.id, auth.sessionId, currentPassword, newPassword)
    loginLimiter.reset(`pw|${auth.user.id}`)
    return c.json({ ok: true })
  })
  app.post('/api/auth/logout-others', (c) => {
    const auth = sessionOf(c)
    if (!auth) return fail(c, 401, 'unauthenticated')
    return c.json({ ok: true, signedOut: signOutOtherSessions(sql, auth.user.id, auth.sessionId) })
  })
  app.post('/api/auth/switch', async (c) => {
    const auth = sessionOf(c)
    if (!auth) return fail(c, 401, 'unauthenticated')
    const { businessId } = await body<{ businessId?: string }>(c)
    if (typeof businessId !== 'string' || !sql.get('SELECT 1 FROM memberships WHERE user_id = ? AND business_id = ?', [auth.user.id, businessId])) return fail(c, 403, 'forbidden')
    // A fresh session for the other business (the old one ends) — no privilege carries over.
    deleteSession(sql, auth.sessionId)
    return c.json(startSession(c, auth.user.id, businessId))
  })
  app.post('/api/auth/verify-email', async (c) => {
    const { token } = await body<{ token?: string }>(c)
    verifyEmail(sql, token, now())
    return c.json({ ok: true })
  })
  app.post('/api/auth/verify-email/resend', async (c) => {
    const auth = sessionOf(c)
    if (!auth) return fail(c, 401, 'unauthenticated')
    if (!resetLimiter.attempt(`verify|${auth.user.id}`)) return fail(c, 429, 'rate_limited')
    await sendVerification(auth.user.id, localeOf((await body<{ locale?: string }>(c)).locale))
    return c.json({ ok: true })
  })

  /* Team invitations (public: the invitee isn't signed in yet). */
  app.get('/api/auth/invitations/:token', (c) => {
    if (!inviteViewLimiter.attempt(clientKey(c))) return fail(c, 429, 'rate_limited')
    return c.json(describeInvitation(sql, c.req.param('token'), now()))
  })
  app.post('/api/auth/invitations/accept', async (c) => {
    const input = await body<{ token?: string; name?: string; password?: string }>(c)
    if (typeof input.token !== 'string' || typeof input.password !== 'string') return fail(c, 400, 'invalid_input')
    const key = `invite|${clientKey(c)}|${input.token.slice(0, 12)}`
    if (!loginLimiter.attempt(key)) return fail(c, 429, 'rate_limited')
    const { userId, businessId } = await acceptInvitation(sql, { token: input.token, name: input.name, password: input.password }, now())
    loginLimiter.reset(key)
    return c.json(startSession(c, userId, businessId))
  })

  /* ---------------- Business API: /api/app/* (authenticated, tenant-scoped) ---------------- */

  const business = new Hono<Env>()
  business.use('*', async (c, next) => {
    const auth = readSession(sql, getCookie(c, SESSION_COOKIE), now())
    if (!auth) return fail(c, 401, 'unauthenticated')
    c.set('auth', auth)
    // Every query made through this repository is scoped to the session's business.
    c.set('repo', repoFor(auth.businessId))
    await next()
  })

  business.get('/business', async (c) => c.json(await c.var.repo.getBusiness()))
  // Catalog, team, branding and publishing — owners only.
  business.post('/services', async (c) => requireOwner(c) ?? c.json(await c.var.repo.createService(await body<ServiceInput>(c)), 201))
  business.delete('/services/:id', async (c) => requireOwner(c) ?? (await c.var.repo.deleteService(c.req.param('id')), c.json({ ok: true })))
  business.post('/staff', async (c) => requireOwner(c) ?? c.json(await c.var.repo.createStaff(await body<StaffInput>(c)), 201))
  business.put('/staff/:id', async (c) => requireOwner(c) ?? c.json(await c.var.repo.updateStaff(c.req.param('id'), await body<StaffInput>(c))))
  business.delete('/staff/:id', async (c) => requireOwner(c) ?? (await c.var.repo.deleteStaff(c.req.param('id')), c.json({ ok: true })))
  business.put('/business/images/:kind', async (c) => {
    const kind = c.req.param('kind')
    if (kind !== 'logo' && kind !== 'cover') return fail(c, 404, 'not_found')
    const { dataUrl } = await body<{ dataUrl: string | null }>(c)
    if (dataUrl !== null && typeof dataUrl !== 'string') return fail(c, 400, 'invalid_input')
    return requireOwner(c) ?? c.json(await c.var.repo.setBusinessImage(kind, dataUrl))
  })
  business.post('/business/publish', async (c) => {
    const { published } = await body<{ published: boolean }>(c)
    return requireOwner(c) ?? c.json(await c.var.repo.setPublished(published === true))
  })
  business.post('/business/onboarding/complete', async (c) => requireOwner(c) ?? c.json(await c.var.repo.completeOnboarding()))

  business.patch('/business', async (c) => {
    if (c.var.auth.role !== 'owner') return fail(c, 403, 'forbidden')
    return c.json(await c.var.repo.updateBusiness(await body<BusinessUpdate>(c)))
  })
  business.get('/staff', async (c) => c.json(await c.var.repo.listStaff()))
  /* Subscription & billing. Everyone in the business can see the state; owners manage it. */
  business.get('/billing', (c) => c.json(billing ? billing.state(c.var.auth.businessId) : { enabled: false, plan: 'business', status: 'comped', cancelAtPeriodEnd: false, entitled: true, maxStaff: null, purchasable: [], hasPaymentMethod: false }))
  business.post('/billing/checkout', async (c) => {
    const denied = requireOwner(c)
    if (denied) return denied
    if (!billing) return fail(c, 404, 'not_found')
    const { plan, locale } = await body<{ plan?: string; locale?: string }>(c)
    return c.json({ url: await billing.checkout(c.var.auth.businessId, plan, c.var.auth.user, localeOf(locale)) })
  })
  business.post('/billing/portal', async (c) => {
    const denied = requireOwner(c)
    if (denied) return denied
    if (!billing) return fail(c, 404, 'not_found')
    return c.json({ url: await billing.portal(c.var.auth.businessId) })
  })
  /** Recent things clients did (and failed messages) — the dashboard's activity menu. */
  business.get('/activity', (c) => c.json(listActivity(sql, c.var.auth.businessId, new Date(now().getTime() - 14 * 86_400_000))))
  /** Which channels really deliver (live), are simulated (demo/dev) or unavailable. */
  business.get('/messaging', (c) => c.json(messagingStatus ?? { sms: 'off', whatsapp: 'off', email: 'off' }))

  /* Team access (logins) — owners only. */
  business.get('/team', (c) => requireOwner(c) ?? c.json({ members: listMembers(sql, c.var.auth.businessId), invitations: listInvitations(sql, c.var.auth.businessId, now()) }))
  business.post('/team/invitations', async (c) => {
    const denied = requireOwner(c)
    if (denied) return denied
    const input = await body<{ email?: string; role?: string; staffId?: string; locale?: string }>(c)
    const { token, invitation } = invite(sql, { businessId: c.var.auth.businessId, email: input.email, role: input.role, staffId: input.staffId || undefined, invitedBy: c.var.auth.user.id }, now())
    if (providers) {
      const biz = sql.get<{ name: string }>('SELECT name FROM businesses WHERE id = ?', [c.var.auth.businessId])!
      await sendInvitationEmail(providers, { to: invitation.email, inviter: c.var.auth.user.name, businessName: biz.name, link: `${baseUrl}/accept-invite?token=${token}`, locale: localeOf(input.locale), idempotencyKey: invitation.id }).catch(() => undefined)
    }
    return c.json(invitation, 201)
  })
  business.delete('/team/invitations/:id', (c) => requireOwner(c) ?? (revokeInvitation(sql, c.var.auth.businessId, c.req.param('id'), now()), c.json({ ok: true })))
  business.patch('/team/members/:userId', async (c) => {
    const denied = requireOwner(c)
    if (denied) return denied
    updateMember(sql, c.var.auth.businessId, c.req.param('userId'), await body<{ role?: string; staffId?: string | null }>(c))
    return c.json({ ok: true })
  })
  business.delete('/team/members/:userId', (c) => requireOwner(c) ?? (removeMember(sql, c.var.auth.businessId, c.req.param('userId')), c.json({ ok: true })))
  business.get('/services', async (c) => c.json(await c.var.repo.listServices()))
  business.put('/services/:id', async (c) => {
    const service = await body<Service>(c)
    await c.var.repo.updateService({ ...service, id: c.req.param('id') })
    return c.json({ ok: true })
  })
  business.get('/customers', async (c) => c.json(await c.var.repo.listCustomers()))
  business.get('/customers/:id', async (c) => {
    const customer = await c.var.repo.getCustomer(c.req.param('id'))
    return customer ? c.json(customer) : fail(c, 404, 'not_found')
  })
  business.get('/appointments', async (c) => {
    const q = c.req.query()
    const date = (v?: string) => (v ? new Date(v) : undefined)
    const status = q.status?.split(',').filter((s): s is AppointmentStatus => APPOINTMENT_STATUSES.includes(s as AppointmentStatus))
    return c.json(await c.var.repo.listAppointments({ from: date(q.from), to: date(q.to), staffId: q.staffId, customerId: q.customerId, status }))
  })
  business.patch('/appointments/:id/status', async (c) => {
    const { status } = await body<{ status: AppointmentStatus }>(c)
    if (!APPOINTMENT_STATUSES.includes(status)) return fail(c, 400, 'invalid_input')
    await c.var.repo.updateAppointmentStatus(c.req.param('id'), status)
    return c.json({ ok: true })
  })
  business.get('/offers', async (c) => c.json(await c.var.repo.listAvailabilityOffers(c.req.query('appointmentId') ?? '')))
  business.put('/offers/:id', async (c) => {
    const offer = await body<AvailabilityOffer>(c)
    await c.var.repo.saveAvailabilityOffer({ ...offer, id: c.req.param('id'), businessId: c.var.auth.businessId })
    return c.json({ ok: true })
  })
  business.get('/notifications', async (c) => {
    const customerId = c.req.query('customerId')
    return c.json(customerId ? await c.var.repo.listCustomerNotifications(customerId) : await c.var.repo.listNotifications(c.req.query('appointmentId') ?? ''))
  })

  /* Appointments entered and managed by the business (owner and staff). */
  business.get('/availability', async (c) => {
    const q = c.req.query()
    return c.json(await c.var.repo.getStaffAvailability(q.serviceId ?? '', new Date(q.from ?? now()), Number(q.days) || 1, { staffId: q.staffId || undefined, ignoreAppointmentId: q.ignore || undefined }))
  })
  business.post('/appointments', async (c) => c.json(await c.var.repo.createAppointment(await body<BusinessBookingInput>(c)), 201))
  business.post('/appointments/:id/move', async (c) => c.json(await c.var.repo.moveAppointment(c.req.param('id'), await body<AppointmentMove>(c))))
  business.post('/appointments/:id/cancel', async (c) => {
    const { notify } = await body<{ notify?: boolean }>(c)
    return c.json(await c.var.repo.cancelAppointment(c.req.param('id'), { notify: notify !== false }))
  })
  business.put('/appointments/:id/notes', async (c) => {
    const { notes } = await body<{ notes: string }>(c)
    await c.var.repo.updateAppointmentNotes(c.req.param('id'), notes)
    return c.json({ ok: true })
  })
  business.post('/appointments/:id/remind', async (c) => (await c.var.repo.sendReminder(c.req.param('id')), c.json({ ok: true })))

  /* Clients. Erasing personal data is owner-only. */
  business.post('/customers', async (c) => c.json(await c.var.repo.createCustomer(await body<CustomerInput>(c)), 201))
  business.post('/customers/import', async (c) => {
    const denied = requireOwner(c)
    if (denied) return denied
    return c.json(await c.var.repo.importCustomers((await body<{ rows: CustomerInput[] }>(c)).rows))
  })
  business.put('/customers/:id', async (c) => c.json(await c.var.repo.updateCustomer(c.req.param('id'), await body<CustomerInput>(c))))
  business.post('/customers/:id/opt-out', async (c) => {
    const { optedOut } = await body<{ optedOut: boolean }>(c)
    return c.json(await c.var.repo.setCustomerOptOut(c.req.param('id'), optedOut === true))
  })
  business.delete('/customers/:id', async (c) => requireOwner(c) ?? (await c.var.repo.eraseCustomer(c.req.param('id')), c.json({ ok: true })))
  business.post('/customers/:id/messages', async (c) => {
    const { body: text } = await body<{ body: string }>(c)
    await c.var.repo.sendCustomerMessage(c.req.param('id'), text)
    return c.json({ ok: true }, 202)
  })
  business.post('/demo/reset', async (c) => {
    // Only the seeded demo businesses can be reset — never a real business's data.
    if (!demoMode || !Object.values(DEMO).some((d) => d.businessId === c.var.auth.businessId)) return fail(c, 404, 'not_found')
    if (c.var.auth.role !== 'owner') return fail(c, 403, 'forbidden')
    await c.var.repo.resetDemoData()
    return c.json({ ok: true })
  })
  /** Live updates for the dashboard (Server-Sent Events), scoped to the session's business. */
  business.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = c.var.repo.onChange((topics) => void stream.writeSSE({ event: 'change', data: JSON.stringify(topics) }))
      stream.onAbort(unsubscribe)
      while (!stream.aborted) {
        await stream.writeSSE({ event: 'ping', data: '' })
        await stream.sleep(25_000)
      }
      unsubscribe()
    }),
  )
  app.route('/api/app', business)

  /* ---------------- Public booking API (no auth; resolved by booking link) ---------------- */

  const pub = new Hono<Env>()
  // Unpublished pages are visible only to their own signed-in owner/staff (preview).
  pub.use('*', async (c, next) => {
    const viewer = readSession(sql, getCookie(c, SESSION_COOKIE), now())
    c.set('repo', repoFor('', (id) => viewer?.businessId === id))
    await next()
  })
  const days = (v: string | undefined, max = 62) => Math.min(Math.max(Number(v) || 14, 1), max)
  // Abuse limits: manage-link lookups (no guessing) and new bookings (no spam) per client IP.
  const lookupLimiter = new RateLimiter(120, 10 * 60_000)
  const bookingLimiter = new RateLimiter(20, 60 * 60_000)
  pub.use('/:slug/bookings/*', async (c, next) => (lookupLimiter.attempt(clientKey(c)) ? next() : fail(c, 429, 'rate_limited')))
  pub.use('/:slug/bookings', async (c, next) => (c.req.method !== 'POST' || bookingLimiter.attempt(clientKey(c)) ? next() : fail(c, 429, 'rate_limited')))
  pub.get('/:slug', async (c) => {
    const profile = await c.var.repo.getPublicProfile(c.req.param('slug'))
    if (!profile) return fail(c, 404, 'not_found')
    if (Object.values(DEMO).some((d) => d.businessId === profile.business.id)) profile.demo = true
    return c.json(profile)
  })
  pub.get('/:slug/availability', async (c) => {
    const q = c.req.query()
    return c.json(await c.var.repo.getAvailability(c.req.param('slug'), q.serviceId ?? '', new Date(q.from ?? now()), days(q.days), q.staffId || undefined))
  })
  pub.post('/:slug/bookings', async (c) => c.json(await c.var.repo.createBooking(c.req.param('slug'), await body<NewBookingInput>(c)), 201))
  pub.get('/:slug/bookings/:ref', async (c) => {
    const booking = await c.var.repo.getBookingByReference(c.req.param('slug'), c.req.param('ref'))
    return booking ? c.json(booking) : fail(c, 404, 'not_found')
  })
  pub.get('/:slug/bookings/:ref/availability', async (c) => {
    const q = c.req.query()
    return c.json(await c.var.repo.getRescheduleAvailability(c.req.param('slug'), c.req.param('ref'), new Date(q.from ?? now()), days(q.days)))
  })
  pub.post('/:slug/bookings/:ref/reschedule', async (c) => {
    const { start } = await body<{ start: string }>(c)
    return c.json(await c.var.repo.rescheduleBooking(c.req.param('slug'), c.req.param('ref'), start))
  })
  pub.post('/:slug/bookings/:ref/cancel', async (c) => {
    const { reason } = await body<{ reason?: CancellationReason }>(c)
    if (reason !== undefined && !REASONS.includes(reason)) return fail(c, 400, 'invalid_input')
    return c.json(await c.var.repo.cancelBooking(c.req.param('slug'), c.req.param('ref'), reason))
  })
  app.route('/api/public', pub)

  /* ---------------- Test support ---------------- */

  if (testMode) {
    app.post('/api/__test__/reset', (c) => {
      onTestReset?.()
      for (const l of [loginLimiter, signupLimiter, resetLimiter, inviteViewLimiter, lookupLimiter, bookingLimiter]) l.clear()
      providers?.providers.forEach((p) => (p as { clear?: () => void }).clear?.())
      return c.json({ ok: true })
    })
    /** Runs the notification dispatcher now (instead of waiting for the background job). */
    app.post('/api/__test__/dispatch', async (c) => c.json(engine ? await engine.dispatchDue(100) : { sent: 0 }))
    /** Messages accepted by the dev provider. */
    app.get('/api/__test__/outbox', (c) => c.json(providers?.providers.flatMap((p) => (p as { outbox?: unknown[] }).outbox ?? []) ?? []))
  }

  /* ---------------- Provider webhooks (signed) ---------------- */

  const baseUrl0 = publicBaseUrl.replace(/\/$/, '')
  const twilioForm = async (c: Context) => {
    const token = webhooks.twilioAuthToken
    if (!token) return null
    const params = Object.fromEntries(new URLSearchParams(await c.req.text())) as Record<string, string>
    const url = `${baseUrl0}${c.req.path}`
    return verifyTwilioSignature(token, url, params, c.req.header('x-twilio-signature')) ? params : null
  }
  app.post('/api/webhooks/twilio/status', async (c) => {
    const p = await twilioForm(c)
    if (!p) return fail(c, 403, 'invalid_signature')
    const status = twilioReceiptStatus(p.MessageStatus)
    if (status && p.MessageSid && engine) engine.recordReceipt('twilio', { providerMessageId: p.MessageSid, status, at: now().toISOString(), error: p.ErrorCode ? `twilio ${p.ErrorCode}` : undefined })
    return c.body(null, 204)
  })
  app.post('/api/webhooks/twilio/inbound', async (c) => {
    const p = await twilioForm(c)
    if (!p) return fail(c, 403, 'invalid_signature')
    if (p.From && p.Body !== undefined) {
      handleInboundMessage(sql, (e) => engine?.handle(e), { provider: 'twilio', channel: p.From.startsWith('whatsapp:') ? 'whatsapp' : 'sms', from: p.From, to: p.To ?? '', body: p.Body }, now())
    }
    // Empty TwiML: no automatic reply from us (carriers/Twilio confirm STOP themselves).
    return c.body('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, { 'content-type': 'text/xml' })
  })
  app.post('/api/webhooks/resend', async (c) => {
    const secret = webhooks.resendWebhookSecret
    const raw = await c.req.text()
    if (!secret || !verifyResendSignature(secret, { id: c.req.header('svix-id'), timestamp: c.req.header('svix-timestamp'), signature: c.req.header('svix-signature') }, raw, now().getTime())) {
      return fail(c, 403, 'invalid_signature')
    }
    const event = JSON.parse(raw) as { type?: string; created_at?: string; data?: { email_id?: string; to?: string[] } }
    const status = resendReceiptStatus(event.type)
    if (status && event.data?.email_id && engine) engine.recordReceipt('resend', { providerMessageId: event.data.email_id, status, at: event.created_at ?? now().toISOString(), error: status === 'failed' ? event.type : undefined })
    // A spam complaint is an unsubscribe: stop emailing that address.
    if (event.type === 'email.complained') {
      for (const to of event.data?.to ?? []) {
        for (const c2 of sql.all<{ id: string; business_id: string }>('SELECT id, business_id FROM customers WHERE email = ? AND erased_at IS NULL', [to.toLowerCase()])) {
          sql.run('UPDATE customers SET messaging_opt_out_at = COALESCE(messaging_opt_out_at, ?) WHERE id = ?', [now().toISOString(), c2.id])
          engine?.handle({ type: 'customer.opted_out', businessId: c2.business_id, customerId: c2.id })
        }
      }
    }
    return c.json({ ok: true })
  })

  app.post('/api/webhooks/stripe', async (c) => {
    if (!billing?.enabled) return fail(c, 404, 'not_found')
    const result = billing.handleWebhook(await c.req.text(), c.req.header('stripe-signature'))
    return c.json({ received: true, result })
  })

  /** Uploaded logos/covers. Random, immutable file names → cache forever. */
  app.get('/api/assets/:businessId/:file', (c) => {
    const asset = images?.read(c.req.param('businessId'), c.req.param('file'))
    if (!asset) return fail(c, 404, 'not_found')
    return c.body(new Uint8Array(asset.data), 200, { 'content-type': asset.mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' })
  })

  app.all('/api/*', (c) => fail(c, 404, 'not_found'))
  return { app, events, engine }
}

