/**
 * Background job runner for periodic work (dispatching due notifications, housekeeping).
 * Each job runs on its own interval and never overlaps with itself; a failing run is
 * logged and retried on the next tick. Durable state lives in the database (the
 * notifications outbox), so a restart loses nothing — due work is picked up on the next run.
 * Scaling out: run it in every instance (rows are leased) or in one dedicated worker process.
 */
export interface Job {
  name: string
  intervalMs: number
  run: () => Promise<unknown> | unknown
}

export interface Scheduler {
  start(): void
  stop(): Promise<void>
  /** Runs a job immediately (tests, admin "run now"). */
  runNow(name: string): Promise<void>
}

export function createScheduler(jobs: Job[], log: (m: string) => void = console.error): Scheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const running = new Map<string, Promise<void>>()
  let stopped = true

  const execute = (job: Job): Promise<void> => {
    const current = running.get(job.name)
    if (current) return current // no overlap
    const p = (async () => {
      try {
        await job.run()
      } catch (e) {
        log(`[jobs] ${job.name} failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        running.delete(job.name)
      }
    })()
    running.set(job.name, p)
    return p
  }

  const loop = (job: Job) => {
    timers.set(
      job.name,
      setTimeout(async () => {
        await execute(job)
        if (!stopped) loop(job)
      }, job.intervalMs),
    )
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      jobs.forEach(loop)
    },
    async stop() {
      stopped = true
      timers.forEach(clearTimeout)
      timers.clear()
      await Promise.all(running.values())
    },
    async runNow(name) {
      const job = jobs.find((j) => j.name === name)
      if (!job) throw new Error(`Unknown job ${name}`)
      await execute(job)
    },
  }
}
