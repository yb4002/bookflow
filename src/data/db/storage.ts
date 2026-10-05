/**
 * Persistence boundary. The Database only ever talks to a StorageAdapter, so the
 * browser implementation can be replaced by IndexedDB, a sync engine, or a remote
 * API without touching business logic or UI.
 */
export interface StorageAdapter {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  keys(prefix: string): string[]
  /** Notifies about writes made elsewhere (another tab / process). Optional. */
  subscribe?(listener: (key: string) => void): () => void
  /** True when data survives a reload. */
  readonly durable: boolean
}

export class StorageQuotaError extends Error {
  constructor() {
    super('Storage quota exceeded')
    this.name = 'StorageQuotaError'
  }
}

/** Volatile storage — used in tests and as a fallback when localStorage is unavailable. */
export class MemoryStorage implements StorageAdapter {
  readonly durable = false
  private data = new Map<string, string>()
  get(key: string) {
    return this.data.get(key) ?? null
  }
  set(key: string, value: string) {
    this.data.set(key, value)
  }
  remove(key: string) {
    this.data.delete(key)
  }
  keys(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix))
  }
}

/** Browser localStorage, with cross-tab change notifications. Falls back to memory if unavailable. */
export function createBrowserStorage(): StorageAdapter {
  try {
    const ls = window.localStorage
    const probe = '__bookflow_probe__'
    ls.setItem(probe, '1')
    ls.removeItem(probe)
    return {
      durable: true,
      get: (key) => ls.getItem(key),
      set: (key, value) => {
        try {
          ls.setItem(key, value)
        } catch (e) {
          if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) throw new StorageQuotaError()
          throw e
        }
      },
      remove: (key) => ls.removeItem(key),
      keys: (prefix) => Object.keys(ls).filter((k) => k.startsWith(prefix)),
      subscribe: (listener) => {
        const onStorage = (e: StorageEvent) => {
          if (e.storageArea === ls && e.key) listener(e.key)
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
      },
    }
  } catch {
    console.warn('[BookFlow] localStorage unavailable — data will not persist across reloads.')
    return new MemoryStorage()
  }
}
