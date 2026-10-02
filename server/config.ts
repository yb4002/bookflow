/**
 * Server configuration from environment variables (12-factor). `loadConfig` validates it:
 * in production, unsafe or contradictory settings stop the server at startup with a clear
 * message instead of failing later. See `.env.example` for every variable.
 */

const bool = (v: string | undefined, fallback: boolean) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()))
const num = (v: string | undefined, fallback: number) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v))
const str = (v: string | undefined) => (v === undefined || v.trim() === '' ? undefined : v.trim())

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production'
  const publicBaseUrl = (str(env.PUBLIC_BASE_URL) ?? 'http://localhost:5173').replace(/\/$/, '')
  const config = {
    production,
    port: num(env.PORT, 8787),
    /** Bind address. 0.0.0.0 in containers; 127.0.0.1 behind a local reverse proxy. */
    host: str(env.HOST) ?? '0.0.0.0',
    /** SQLite file. Use a persistent volume in production. */
    databasePath: str(env.DATABASE_PATH) ?? 'data/bookflow.sqlite',
    /** Demo conveniences (one-click demo login, "Restore demo data", demo seed). Off by default in production. */
    demoMode: bool(env.BOOKFLOW_DEMO, !production),
    /** Password for the seeded demo owners. */
    demoPassword: str(env.BOOKFLOW_DEMO_PASSWORD) ?? 'bookflow-demo',
    /** Enables /api/__test__/* — end-to-end tests only. Refused in production. */
    testMode: bool(env.BOOKFLOW_TEST, false),
    /** `Secure` cookies (HTTPS only). On in production unless explicitly disabled. */
    secureCookies: bool(env.SECURE_COOKIES, production),
    /** Trust X-Forwarded-For / X-Forwarded-Proto from a reverse proxy (Caddy, nginx, a PaaS router). */
    trustProxy: bool(env.TRUST_PROXY, false),
    /** Built SPA to serve (production). */
    staticDir: str(env.STATIC_DIR) ?? 'dist',
    /** Public origin (links in messages, webhook signature URLs, CORS/CSRF origin check). */
    publicBaseUrl,
    /** How often the background dispatcher looks for due notifications. */
    notifyPollMs: num(env.NOTIFY_POLL_MS, 5000),
    /** Uploaded logos/covers (use a persistent volume in production). */
    uploadsDir: str(env.UPLOAD_DIR) ?? 'data/uploads',
    /** Online backups of the database (directory, interval, how many to keep). */
    backupDir: str(env.BACKUP_DIR) ?? 'data/backups',
    backupIntervalHours: num(env.BACKUP_INTERVAL_HOURS, production ? 6 : 0),
    backupKeep: num(env.BACKUP_KEEP, 28),
    /** Logs as one JSON object per line (for log collectors). */
    logFormat: (str(env.LOG_FORMAT) ?? (production ? 'json' : 'pretty')) as 'json' | 'pretty',
    /** Bearer token for /api/metrics (monitoring). Unset = metrics endpoint disabled. */
    metricsToken: str(env.METRICS_TOKEN),
    messaging: {
      twilio: {
        accountSid: str(env.TWILIO_ACCOUNT_SID),
        authToken: str(env.TWILIO_AUTH_TOKEN),
        messagingServiceSid: str(env.TWILIO_MESSAGING_SERVICE_SID),
        smsFrom: str(env.TWILIO_SMS_FROM),
        whatsappFrom: str(env.TWILIO_WHATSAPP_FROM),
        statusCallbackUrl: `${publicBaseUrl}/api/webhooks/twilio/status`,
      },
      resend: { apiKey: str(env.RESEND_API_KEY), from: str(env.EMAIL_FROM), replyTo: str(env.EMAIL_REPLY_TO), webhookSecret: str(env.RESEND_WEBHOOK_SECRET) },
      /** Simulate channels with no real provider. Default: on outside production, off in production. */
      simulateMissing: bool(env.MESSAGING_SIMULATE, !production),
    },
    billing: {
      stripeSecretKey: str(env.STRIPE_SECRET_KEY),
      stripeWebhookSecret: str(env.STRIPE_WEBHOOK_SECRET),
      /** Price ids per plan, e.g. STRIPE_PRICE_STARTER=price_123 */
      prices: { starter: str(env.STRIPE_PRICE_STARTER), pro: str(env.STRIPE_PRICE_PRO) },
      trialDays: num(env.TRIAL_DAYS, 14),
    },
  }
  return config
}

export type Config = ReturnType<typeof loadConfig>

/** Fatal problems (refuse to start) and warnings (start, but say so) for a configuration. */
export function checkConfig(c: Config): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  if (!/^https?:\/\/[^/]+$/.test(c.publicBaseUrl)) errors.push(`PUBLIC_BASE_URL must be an origin like https://book.example.com (got "${c.publicBaseUrl}")`)
  if (c.production) {
    if (c.testMode) errors.push('BOOKFLOW_TEST must not be enabled in production (it exposes a database reset endpoint)')
    if (!c.publicBaseUrl.startsWith('https://')) errors.push('PUBLIC_BASE_URL must use https:// in production')
    if (!c.secureCookies) errors.push('SECURE_COOKIES must stay on in production (session cookies over HTTPS only)')
    if (c.demoMode && c.demoPassword === 'bookflow-demo') errors.push('BOOKFLOW_DEMO is on with the default demo password — set BOOKFLOW_DEMO_PASSWORD or turn demo mode off')
    if (c.messaging.simulateMissing) warnings.push('MESSAGING_SIMULATE is on: channels without a provider pretend to send')
    if (!c.backupIntervalHours) warnings.push('Automatic backups are off (BACKUP_INTERVAL_HOURS=0)')
    if (!c.trustProxy) warnings.push('TRUST_PROXY is off: behind a reverse proxy, rate limits will see the proxy address for every client')
  }
  const t = c.messaging.twilio
  if ((t.accountSid || t.authToken) && !(t.accountSid && t.authToken && (t.messagingServiceSid || t.smsFrom || t.whatsappFrom))) {
    errors.push('Twilio is partly configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and one of TWILIO_MESSAGING_SERVICE_SID / TWILIO_SMS_FROM / TWILIO_WHATSAPP_FROM')
  }
  const r = c.messaging.resend
  if ((r.apiKey || r.from) && !(r.apiKey && r.from)) errors.push('Email is partly configured: set both RESEND_API_KEY and EMAIL_FROM')
  if (r.apiKey && !r.webhookSecret) warnings.push('RESEND_WEBHOOK_SECRET is not set: email delivery/bounce events are ignored')
  const b = c.billing
  if (b.stripeSecretKey && !b.stripeWebhookSecret) errors.push('STRIPE_SECRET_KEY is set without STRIPE_WEBHOOK_SECRET (subscription changes would never arrive)')
  if (b.stripeSecretKey && !b.prices.starter && !b.prices.pro) errors.push('Stripe is configured but no plan price is set (STRIPE_PRICE_STARTER / STRIPE_PRICE_PRO)')
  if (c.production && !t.accountSid && !c.messaging.simulateMissing) warnings.push('No SMS provider configured: confirmations and reminders by SMS will fail (configure Twilio)')
  if (c.production && !r.apiKey && !c.messaging.simulateMissing) warnings.push('No email provider configured: password resets, invitations and email confirmations will fail (configure Resend)')
  return { errors, warnings }
}

/** The active configuration (read once at startup). */
export const config = loadConfig()
