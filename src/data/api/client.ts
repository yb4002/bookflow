import { BookingError, type BookingErrorCode } from '@/domain/errors'

/** Raised when the session is missing or expired (HTTP 401). */
export class AuthError extends Error {
  constructor(public code: string = 'unauthenticated') {
    super(code)
    this.name = 'AuthError'
  }
}

const BOOKING_CODES = new Set<BookingErrorCode>(['slot_unavailable', 'invalid_input', 'not_found', 'already_cancelled', 'not_changeable', 'change_window_closed', 'invalid_slug', 'slug_taken', 'not_published', 'in_use', 'invalid_image', 'not_ready', 'duplicate', 'opted_out', 'no_contact', 'booking_paused', 'plan_limit'])

/** Any other API error, with the server's error code (e.g. `email_taken`, `weak_password`, `rate_limited`). */
export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code)
    this.name = 'ApiError'
  }
}

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()
/** Notified whenever an API call reports the session is gone (e.g. expired) — the app redirects to login. */
export const onUnauthorized = (l: Listener) => {
  unauthorizedListeners.add(l)
  return () => {
    unauthorizedListeners.delete(l)
  }
}

/** JSON fetch wrapper: same-origin cookies, JSON bodies (also our CSRF defence), typed errors. */
export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? { accept: 'application/json' } : { 'content-type': 'application/json', accept: 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T

  const code = ((await res.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code ?? 'internal'
  if (res.status === 401) {
    if (!path.startsWith('/auth/')) unauthorizedListeners.forEach((l) => l())
    throw new AuthError(code)
  }
  if (BOOKING_CODES.has(code as BookingErrorCode)) throw new BookingError(code as BookingErrorCode)
  throw new ApiError(code, res.status)
}
