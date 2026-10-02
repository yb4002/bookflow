import type { DataTopic } from '../src/data/repositories/types'

type Listener = (topics: DataTopic[]) => void

/**
 * In-process pub/sub, keyed by business. Feeds the dashboard's live-update stream
 * (SSE). With several server instances this becomes Redis/Postgres LISTEN/NOTIFY.
 */
export class EventBus {
  private listeners = new Map<string, Set<Listener>>()

  subscribe(businessId: string, listener: Listener): () => void {
    let set = this.listeners.get(businessId)
    if (!set) this.listeners.set(businessId, (set = new Set()))
    set.add(listener)
    return () => set.delete(listener)
  }

  publish(businessId: string, topics: DataTopic[]) {
    for (const l of this.listeners.get(businessId) ?? []) l(topics)
  }
}
