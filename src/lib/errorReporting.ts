/**
 * Reports front-end crashes to the server log (/api/client-errors) so they show up in
 * monitoring. Best effort, de-duplicated, never throws. Query strings are stripped (tokens).
 */
const sent = new Set<string>()

export function reportError(error: unknown, source: string) {
  try {
    const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error))
    const key = `${source}:${e.message}`
    if (sent.has(key) || sent.size > 20) return
    sent.add(key)
    const body = JSON.stringify({ message: e.message, stack: e.stack, source, url: location.origin + location.pathname })
    if (navigator.sendBeacon?.(`/api/client-errors`, new Blob([body], { type: 'application/json' }))) return
    void fetch('/api/client-errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined)
  } catch {
    /* never let reporting break the app */
  }
}

/** Global listeners for errors React doesn't catch (event handlers, promises). */
export function installGlobalErrorReporting() {
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'window'))
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as { name?: string } | undefined
    // Signed-out sessions and expected API errors are handled by the UI.
    if (reason?.name === 'AuthError' || reason?.name === 'BookingError' || reason?.name === 'ApiError') return
    reportError(e.reason, 'promise')
  })
}
