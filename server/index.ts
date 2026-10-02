import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app'
import { hashPassword } from './auth/passwords'
import { purgeRateLimits } from './auth/rateLimit'
import { purgeExpiredSessions } from './auth/sessions'
import { createBilling } from './billing/service'
import { createStripeClient } from './billing/stripe'
import { checkConfig, config } from './config'
import { backupDatabase } from './db/backup'
import { migrate } from './db/migrate'
import { demoDatasets, demoUsers, insertDataset, insertUsers, seedDemoIfEmpty } from './db/seed'
import { openSqlite } from './db/sqlite'
import { createScheduler } from './jobs/scheduler'
import { createErrorAlerter, createLogger } from './log'
import { createProviders } from './notifications/setup'

/** Process entry point: validate config, open + migrate the database, start jobs, serve API (+ SPA). */
async function main() {
  const log = createLogger(config.logFormat, { service: 'bookflow' }, undefined, createErrorAlerter(process.env.ERROR_WEBHOOK_URL))
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err }))
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', { err })
    process.exit(1)
  })

  const { errors, warnings } = checkConfig(config)
  for (const w of warnings) log.warn(`config: ${w}`)
  if (errors.length) {
    for (const e of errors) log.error(`config: ${e}`)
    log.error('refusing to start: fix the configuration above (see .env.example)')
    process.exit(1)
  }

  if (config.databasePath !== ':memory:') mkdirSync(dirname(resolve(config.databasePath)), { recursive: true })
  const sql = openSqlite(config.databasePath)
  const applied = migrate(sql)
  if (applied.length) log.info('database migrated', { applied })
  purgeExpiredSessions(sql, new Date())
  purgeRateLimits(sql)

  const passwordHash = await hashPassword(config.demoPassword)
  if (config.demoMode && seedDemoIfEmpty(sql, new Date(), passwordHash)) log.info('seeded demo businesses (Luna Hair Studio, Glow Lab)')

  const reseedAll = () => {
    sql.transaction(() => {
      for (const t of ['billing_events', 'subscriptions', 'inbound_messages', 'email_verifications', 'invitations', 'password_resets', 'notifications', 'sessions', 'memberships', 'users', 'staff_hours', 'offer_recipients', 'availability_offers', 'appointments', 'customers', 'staff_services', 'services', 'staff', 'booking_links', 'business_hours', 'business_settings', 'businesses']) sql.run(`DELETE FROM ${t}`)
    })
    for (const ds of demoDatasets(new Date())) insertDataset(sql, ds)
    insertUsers(sql, demoUsers(passwordHash), new Date())
  }

  // Messaging: real providers where configured; simulated ones only where allowed (never silently in production).
  const messaging = createProviders({ ...config.messaging, log: !config.testMode })
  log.info('messaging channels', messaging.status)

  const billing = config.billing.stripeSecretKey
    ? createBilling({
        sql,
        now: () => new Date(),
        stripe: createStripeClient(config.billing.stripeSecretKey),
        webhookSecret: config.billing.stripeWebhookSecret,
        prices: { solo: config.billing.prices.starter, team: config.billing.prices.pro },
        trialDays: config.billing.trialDays,
        publicBaseUrl: config.publicBaseUrl,
      })
    : undefined
  log.info(billing ? 'billing: Stripe enabled' : 'billing: not configured — every business has full access')

  let lastDispatchOk = Date.now()
  const { app, engine } = createApp({
    sql,
    demoMode: config.demoMode,
    testMode: config.testMode,
    secureCookies: config.secureCookies,
    onTestReset: reseedAll,
    providers: messaging.registry,
    messagingStatus: messaging.status,
    publicBaseUrl: config.publicBaseUrl,
    uploadsDir: config.uploadsDir,
    webhooks: { twilioAuthToken: config.messaging.twilio.authToken, resendWebhookSecret: config.messaging.resend.webhookSecret },
    billing,
    trustProxy: config.trustProxy,
    allowedOrigin: config.production ? config.publicBaseUrl : undefined,
    logger: log,
    metricsToken: config.metricsToken,
    // Not ready if the notification dispatcher hasn't completed a run for 5 minutes.
    readiness: () => ({ notificationDispatcher: Date.now() - lastDispatchOk < 5 * 60_000 }),
  })

  // Background jobs. Durable state is in the database, so restarts lose nothing.
  const scheduler = createScheduler(
    [
      {
        name: 'notifications.dispatch',
        intervalMs: config.notifyPollMs,
        run: async () => {
          await engine?.dispatchDue(50)
          lastDispatchOk = Date.now()
        },
      },
      { name: 'sessions.purge', intervalMs: 60 * 60_000, run: () => purgeExpiredSessions(sql, new Date()) },
      // Expired rate-limit windows (the table would otherwise keep one row per IP / email ever seen).
      { name: 'rateLimits.purge', intervalMs: 15 * 60_000, run: () => purgeRateLimits(sql) },
      ...(config.backupIntervalHours > 0 && config.databasePath !== ':memory:'
        ? [{
            name: 'database.backup',
            intervalMs: config.backupIntervalHours * 3_600_000,
            run: () => {
              const b = backupDatabase(sql, config.backupDir, config.backupKeep)
              log.info('database backup written', { file: b.file, bytes: b.bytes, pruned: b.removed.length })
            },
          }]
        : []),
    ],
    (m) => log.error(m),
  )
  scheduler.start()

  // Production: serve the built SPA. Hashed assets are immutable; HTML is always revalidated.
  const indexHtml = join(config.staticDir, 'index.html')
  if (existsSync(indexHtml)) {
    const html = readFileSync(indexHtml, 'utf8')
    app.use('/assets/*', async (c, next) => {
      await next()
      if (c.res.status === 200) c.header('cache-control', 'public, max-age=31536000, immutable')
    })
    app.use('/*', serveStatic({ root: config.staticDir }))
    app.get('*', (c) => c.html(html, 200, { 'cache-control': 'no-cache' }))
  }

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    log.info('BookFlow listening', { port: info.port, host: config.host, publicBaseUrl: config.publicBaseUrl, demoMode: config.demoMode, production: config.production })
  })

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    log.info('shutting down', { signal })
    // Stop taking requests, let in-flight jobs finish, then close the database cleanly.
    // Live-update streams stay open, so don't wait for them for more than 10 seconds.
    await Promise.race([new Promise<void>((done) => server.close(() => done())), new Promise((done) => setTimeout(done, 10_000))])
    await scheduler.stop()
    sql.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

void main()
