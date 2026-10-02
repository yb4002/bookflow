import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { createApp, type AppOptions } from './app'
import { hashPassword } from './auth/passwords'
import { migrate } from './db/migrate'
import { demoDatasets, demoUsers, insertDataset, insertUsers } from './db/seed'
import { openSqlite } from './db/sqlite'
import { ProviderRegistry } from './notifications/provider'
import { DevProvider } from './notifications/providers/devProvider'

/** Shared in-process API harness for server integration tests. */
/** Monday 5 Oct 2026 08:00 UTC (tests run with TZ=UTC). */
export const NOW = new Date('2026-10-05T08:00:00.000Z')
export const PASSWORD = 'bookflow-demo'
const dir = mkdtempSync(join(tmpdir(), 'bookflow-onboarding-'))
let passwordHash: string
/** scrypt hash of PASSWORD (ready after beforeAll). */
export const demoPasswordHash = () => passwordHash
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** A 1×1 PNG. */
export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

type Ctx = { sql: ReturnType<typeof openSqlite>; now: () => Date }

/** In-memory database with the demo tenants + the API. Options may be built from the database and clock. */
export function setup(options: Partial<AppOptions> | ((ctx: Ctx) => Partial<AppOptions>) = {}) {
  const sql = openSqlite(':memory:')
  migrate(sql)
  for (const ds of demoDatasets(NOW)) insertDataset(sql, ds)
  insertUsers(sql, demoUsers(passwordHash), NOW)
  let clock = new Date(NOW)
  const now = () => new Date(clock)
  const provider = new DevProvider({ deliveryDelayMs: null })
  const extra = typeof options === 'function' ? options({ sql, now }) : options
  const { app, engine } = createApp({
    sql,
    now,
    providers: new ProviderRegistry([provider]),
    publicBaseUrl: 'https://app.example',
    uploadsDir: join(dir, `uploads-${Math.random().toString(36).slice(2)}`),
    ...extra,
  })
  return { sql, app, engine, provider, now, advance: (ms: number) => (clock = new Date(clock.getTime() + ms)) }
}
export type App = ReturnType<typeof setup>['app']

export function client(app: App) {
  let cookie = ''
  const call = async (method: string, path: string, body?: unknown, raw?: string) => {
    const res = await app.request(path, {
      method,
      headers: { ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: method === 'GET' ? undefined : (raw ?? JSON.stringify(body ?? {})),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = /bf_session=;|Max-Age=0/.test(set) ? '' : set.split(';')[0]
    const type = res.headers.get('content-type') ?? ''
    return { status: res.status, json: type.includes('json') ? await res.json() : undefined, type, bytes: type.startsWith('image/') ? (await res.arrayBuffer()).byteLength : 0 }
  }
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b),
    put: (p: string, b?: unknown) => call('PUT', p, b),
    patch: (p: string, b?: unknown) => call('PATCH', p, b),
    del: (p: string) => call('DELETE', p),
    raw: (method: string, p: string, raw: string) => call(method, p, undefined, raw),
  }
}

export const signup = (c: ReturnType<typeof client>, over: Record<string, string> = {}) =>
  c.post('/api/auth/signup', { name: 'Dana Levi', email: 'dana@studio.example', password: 'very-secret-pw', businessName: 'Studio Dana', locale: 'en', timezone: 'Europe/London', ...over })


/** Adds a user with a membership (e.g. a staff login) to a business. */
export function addUser(sql: ReturnType<typeof setup>['sql'], user: { email: string; name: string; businessId: string; role: 'owner' | 'staff' }, now = NOW) {
  insertUsers(sql, [{ ...user, passwordHash }], now)
}
