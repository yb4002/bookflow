/** Fixed-window limiter for login attempts (per client + email). In-memory; use Redis when scaling out. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt; returns false when the key is over the limit. */
  attempt(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    entry.count++
    return entry.count <= this.max
  }

  reset(key: string) {
    this.hits.delete(key)
  }

  clear() {
    this.hits.clear()
  }
}
