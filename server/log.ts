/**
 * Structured logging. JSON lines in production (one object per line, for any log collector),
 * readable lines in development. Never log secrets, tokens, passwords or message bodies.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Record<string, unknown>

export interface Logger {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}

const errorFields = (e: unknown) => (e instanceof Error ? { error: e.message, stack: e.stack?.split('\n').slice(0, 8).join('\n') } : { error: String(e) })

export function createLogger(format: 'json' | 'pretty' = 'pretty', base: LogFields = {}, sink: (line: string, level: LogLevel) => void = defaultSink, onError?: (msg: string, fields: LogFields) => void): Logger {
  const write = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    const { err, ...rest } = fields
    const all: LogFields = { ...base, ...rest, ...(err !== undefined ? errorFields(err) : {}) }
    if (format === 'json') sink(JSON.stringify({ time: new Date().toISOString(), level, msg, ...all }), level)
    else {
      const extra = Object.entries(all).filter(([k]) => k !== 'stack').map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ')
      sink(`${level === 'info' ? '' : `${level.toUpperCase()} `}${msg}${extra ? ` ${extra}` : ''}${all.stack ? `\n${all.stack}` : ''}`, level)
    }
    if (level === 'error') onError?.(msg, all)
  }
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (f) => createLogger(format, { ...base, ...f }, sink, onError),
  }
}

function defaultSink(line: string, level: LogLevel) {
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

/** Silent logger for tests. */
export const nullLogger: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => nullLogger }

/**
 * Optional alerting: posts error summaries to a webhook (Slack/Discord/Teams-compatible
 * `{ text }` payload), at most one per `minIntervalMs` per message.
 */
export function createErrorAlerter(url: string | undefined, minIntervalMs = 5 * 60_000, fetchImpl: typeof fetch = fetch) {
  if (!url) return undefined
  const last = new Map<string, number>()
  return (msg: string, fields: LogFields) => {
    const now = Date.now()
    if ((last.get(msg) ?? 0) + minIntervalMs > now) return
    last.set(msg, now)
    const detail = typeof fields.error === 'string' ? `: ${fields.error}` : ''
    void fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `BookFlow error — ${msg}${detail}`.slice(0, 1000) }) }).catch(() => undefined)
  }
}
