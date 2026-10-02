import type { Context, MiddlewareHandler } from 'hono'

/**
 * HTTP security headers for every response. The SPA is entirely same-origin (self-hosted
 * fonts, no third-party scripts), so the Content-Security-Policy can be strict.
 */
export function securityHeaders({ hsts }: { hsts: boolean }): MiddlewareHandler {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // Tailwind emits a stylesheet; inline `style` attributes are set via the CSSOM by React.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
  return async (c, next) => {
    await next()
    const h = c.res.headers
    h.set('x-content-type-options', 'nosniff')
    h.set('x-frame-options', 'DENY')
    h.set('referrer-policy', 'strict-origin-when-cross-origin')
    h.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    h.set('cross-origin-opener-policy', 'same-origin')
    if (!h.has('content-security-policy')) h.set('content-security-policy', csp)
    if (hsts) h.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
  }
}

/**
 * The client's IP. Behind one trusted reverse proxy (TRUST_PROXY=1) it's the last
 * X-Forwarded-For entry — the one our proxy appended; earlier entries are client-controlled.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim()
    if (fwd) return fwd
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return env?.incoming?.socket?.remoteAddress ?? 'local'
}

/**
 * Defence in depth against CSRF: state-changing API requests from a browser must come from
 * our own origin (in addition to the JSON-only rule and SameSite cookies).
 */
export function originCheck(allowedOrigin: string): MiddlewareHandler {
  return async (c, next) => {
    const m = c.req.method
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || c.req.path.startsWith('/api/webhooks/')) return next()
    const origin = c.req.header('origin')
    if (origin && origin !== allowedOrigin) return c.json({ error: { code: 'bad_origin' } }, 403)
    return next()
  }
}
