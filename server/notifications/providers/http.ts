import type { SendResult } from '../provider'

export type Fetch = typeof fetch

/** Calls a provider API with a timeout and classifies failures (retryable vs permanent). */
export async function callProvider(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parse: (json: Record<string, unknown>) => string | undefined,
): Promise<SendResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetchImpl(url, { ...init, signal: controller.signal })
  } catch (e) {
    // Network error or timeout: the message may or may not have gone out — retry (idempotency
    // keys make that safe where the provider supports them).
    return { ok: false, retryable: true, error: controller.signal.aborted ? `timeout after ${timeoutMs}ms` : `network: ${(e as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
  const json = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  if (res.ok) {
    const id = parse(json)
    return id ? { ok: true, providerMessageId: id } : { ok: false, retryable: false, error: `unexpected response ${res.status}` }
  }
  const detail = [json.code, json.message ?? json.name ?? json.error].filter(Boolean).join(' ')
  // 408/409/425/429 and 5xx are transient; other 4xx (bad number, unverified sender…) are permanent.
  const retryable = res.status >= 500 || [408, 409, 425, 429].includes(res.status)
  return { ok: false, retryable, error: `${res.status}${detail ? ` ${detail}` : ''}`.slice(0, 300) }
}
