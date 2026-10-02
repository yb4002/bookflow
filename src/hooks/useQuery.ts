import { useCallback, useEffect, useRef, useState } from 'react'
import { repo, type DataTopic } from '@/data/repositories'

interface QueryState<T> {
  data: T | undefined
  loading: boolean
  error: Error | undefined
  refetch: () => void
}

interface QueryOptions {
  /** Refetch automatically when any of these data topics change (this tab or another). */
  refreshOn?: DataTopic[]
}

/**
 * Minimal async data hook. Keeps showing the previous data while refetching, so live
 * refreshes don't flash loading states. Swap for TanStack Query when caching and
 * request de-duplication are needed.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = [], options: QueryOptions = {}): QueryState<T> {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error>()
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fnRef
      .current()
      .then((d) => !cancelled && (setData(d), setError(undefined)))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  const topics = options.refreshOn?.join(',')
  useEffect(() => {
    if (!topics) return
    const wanted = topics.split(',')
    return repo.onChange((changed) => {
      if (changed.some((t) => wanted.includes(t))) refetch()
    })
  }, [topics, refetch])

  return { data, loading, error, refetch }
}
