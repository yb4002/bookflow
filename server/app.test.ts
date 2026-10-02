import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { hashPassword } from './auth/passwords'
import { migrate } from './db/migrate'
import { DEMO, demoDatasets, demoUsers, insertDataset, insertUsers } from './db/seed'
import { openSqlite } from './db/sqlite'

/** Monday 5 Oct 2026 08:00 UTC (tests run with TZ=UTC). */
const NOW = new Date('2026-10-05T08:00:00.000Z')
const PASSWORD = 'correct horse battery'
let passwordHash: string
const dir = mkdtempSync(join(tmpdir(), 'bookflow-api-'))

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function setup(path = ':memory:', { seed = true } = {}) {
  const sql = openSqlite(path)
  migrate(sql)
  if (seed) {
    for (const ds of demoDatasets(NOW)) insertDataset(sql, ds)
    insertUsers(sql, demoUsers(passwordHash), NOW)
  }
  const { app } = createApp({ sql, now: () => NOW, demoMode: true })
  return { sql, app }
}

type App = ReturnType<typeof setup>['app']

/** Minimal API client with a cookie jar, like a browser tab. */
function client(app: App) {
  let cookie = ''
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { ...(body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.includes('Max-Age=0') || /bf_session=;/.test(set) ? '' : set.split(';')[0]
    const text = await res.text()
    return { status: res.status, json: text ? JSON.parse(text) : undefined, setCookie: set }
  }
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown, headers?: Record<string, string>) => call('POST', path, body, headers),
    patch: (path: string, body?: unknown) => call('PATCH', path, body),
    put: (path: string, body?: unknown) => call('PUT', path, body),
    login: (email: string, password = PASSWORD) => call('POST', '/api/auth/login', { email, password }),
    get cookie() {
      return cookie
    },
  }
}

async function freeSlot(c: ReturnType<typeof client>, slug: string, serviceId: string, minDaysAhead = 3, staffId?: string) {
  const q = new URLSearchParams({ serviceId, from: NOW.toISOString(), days: '14', ...(staffId ? { staffId } : {}) })
  const { json } = await c.get(`/api/public/${slug}/availability?${q}`)
  for (const day of (json as { slots: { start: string; available: boolean; freeStaffIds: string[] }[] }[]).slice(minDaysAhead)) {
    const slot = day.slots.find((s) => s.available)
    if (slot) return slot
  }
  throw new Error('no free slot')
}

describe('authentication', () => {
  it('logs in with valid credentials, sets a secure session cookie and returns the business', async () => {
    const { app } = setup()
    const c = client(app)
    const res = await c.login(DEMO.luna.ownerEmail)
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ user: { email: DEMO.luna.ownerEmail, name: 'Maya Cohen' }, role: 'owner', business: { id: DEMO.luna.businessId, name: 'Luna Hair Studio' } })
    expect(res.setCookie).toMatch(/bf_session=[\w-]{40,}/)
    expect(res.setCookie).toMatch(/HttpOnly/)
    expect(res.setCookie).toMatch(/SameSite=Lax/)
    expect((await c.get('/api/auth/me')).json.user.email).toBe(DEMO.luna.ownerEmail)
  })

  it('is case-insensitive on email and stores only a hash of the session token', async () => {
    const { app, sql } = setup()
    const c = client(app)
    expect((await c.login('MAYA@LunaHair.Studio')).status).toBe(200)
    const token = c.cookie.split('=')[1]
    expect(sql.get('SELECT 1 FROM sessions WHERE id = ?', [token])).toBeUndefined()
    expect(sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')!.n).toBe(1)
  })

  it('rejects wrong passwords and unknown users with the same error', async () => {
    const { app } = setup()
    const c = client(app)
    const wrong = await c.login(DEMO.luna.ownerEmail, 'nope')
    const unknown = await c.login('nobody@example.com', 'nope')
    expect([wrong.status, unknown.status]).toEqual([401, 401])
    expect(wrong.json).toEqual(unknown.json)
    expect((await c.get('/api/auth/me')).status).toBe(401)
  })

  it('rate-limits repeated failed logins', async () => {
    const { app } = setup()
    const c = client(app)
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) statuses.push((await c.login(DEMO.luna.ownerEmail, `wrong-${i}`)).status)
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses.at(-1)).toBe(429)
    expect((await c.login(DEMO.luna.ownerEmail)).status).toBe(429) // still locked for this window
  })

  it('logout ends the session server-side (the old cookie stops working)', async () => {
    const { app } = setup()
    const c = client(app)
    await c.login(DEMO.luna.ownerEmail)
    const stolen = c.cookie
    expect((await c.post('/api/auth/logout')).status).toBe(200)
    expect((await c.get('/api/auth/me')).status).toBe(401)
    const replay = await app.request('/api/app/business', { headers: { cookie: stolen } })
    expect(replay.status).toBe(401)
  })

  it('protects every dashboard endpoint', async () => {
    const { app } = setup()
    const anon = client(app)
    for (const path of ['/api/app/business', '/api/app/staff', '/api/app/services', '/api/app/customers', '/api/app/appointments', '/api/app/offers?appointmentId=x']) {
      expect((await anon.get(path)).status, path).toBe(401)
    }
    expect((await anon.patch('/api/app/business', { name: 'Hacked' })).status).toBe(401)
    expect((await anon.post('/api/app/demo/reset')).status).toBe(401)
  })

  it('rejects state-changing requests that are not JSON (CSRF protection)', async () => {
    const { app } = setup()
    const c = client(app)
    await c.login(DEMO.luna.ownerEmail)
    const res = await app.request('/api/app/business', { method: 'PATCH', headers: { cookie: c.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Hacked' })
    expect(res.status).toBe(415)
    expect((await c.get('/api/app/business')).json.name).toBe('Luna Hair Studio')
  })

  it('demo login signs in as the Luna owner (demo mode only)', async () => {
    const { app } = setup()
    const c = client(app)
    expect((await c.post('/api/auth/demo-login')).json.business.name).toBe('Luna Hair Studio')
    const { sql } = setup()
    const prod = createApp({ sql, now: () => NOW, demoMode: false }).app
    expect((await client(prod).post('/api/auth/demo-login')).status).toBe(404)
  })
})

describe('multi-business isolation', () => {
  async function twoOwners() {
    const { app, sql } = setup()
    const luna = client(app)
    const glow = client(app)
    await luna.login(DEMO.luna.ownerEmail)
    await glow.login(DEMO.glow.ownerEmail)
    return { app, sql, luna, glow }
  }

  it('each owner only ever sees their own business data', async () => {
    const { luna, glow } = await twoOwners()
    expect((await glow.get('/api/app/business')).json.name).toBe('Glow Lab')
    const glowCustomers = (await glow.get('/api/app/customers')).json as { businessId: string }[]
    const lunaCustomers = (await luna.get('/api/app/customers')).json as { businessId: string }[]
    expect(glowCustomers.length).toBe(60)
    expect(lunaCustomers.length).toBe(240)
    expect(glowCustomers.every((c) => c.businessId === DEMO.glow.businessId)).toBe(true)
    expect(lunaCustomers.every((c) => c.businessId === DEMO.luna.businessId)).toBe(true)
    const glowAppts = (await glow.get('/api/app/appointments')).json as { businessId: string }[]
    expect(glowAppts.length).toBeGreaterThan(0)
    expect(glowAppts.every((a) => a.businessId === DEMO.glow.businessId)).toBe(true)
  })

  it("cannot read or change another business's records by id", async () => {
    const { luna, glow, sql } = await twoOwners()
    const lunaAppt = (await luna.get('/api/app/appointments')).json[0] as { id: string; customerId: string; status: string }
    const lunaService = (await luna.get('/api/app/services')).json[0] as { id: string; name: string }

    expect((await glow.get(`/api/app/customers/${lunaAppt.customerId}`)).status).toBe(404)
    expect((await glow.get(`/api/app/appointments?customerId=${lunaAppt.customerId}`)).json).toEqual([])
    expect((await glow.patch(`/api/app/appointments/${lunaAppt.id}/status`, { status: 'cancelled' })).status).toBe(404)
    expect((await glow.put(`/api/app/services/${lunaService.id}`, { ...lunaService, name: 'Hijacked' })).status).toBe(404)

    // Nothing changed in Luna's data
    const row = sql.get<{ status: string }>('SELECT status FROM appointments WHERE id = ?', [lunaAppt.id])!
    expect(row.status).toBe(lunaAppt.status)
    expect(sql.get<{ name: string }>('SELECT name FROM services WHERE id = ?', [lunaService.id])!.name).toBe(lunaService.name)
  })

  it("cannot take another business's booking link", async () => {
    const { glow } = await twoOwners()
    const res = await glow.patch('/api/app/business', { slug: 'luna-hair' })
    expect(res.status).toBe(409)
    expect(res.json.error.code).toBe('slug_taken')
  })

  it("public bookings can't use another business's services or staff", async () => {
    const { luna } = await twoOwners()
    const glowSlot = await freeSlot(luna, 'glow-lab', 'glow_svc_1')
    const res = await luna.post('/api/public/luna-hair/bookings', { serviceId: 'glow_svc_1', start: glowSlot.start, name: 'Mixed Up', phone: '555-000-1111', remindersOptIn: true })
    expect(res.status).toBe(400)
    const staffRes = await luna.get(`/api/public/luna-hair/availability?serviceId=luna_svc_1&staffId=glow_stf_1&from=${NOW.toISOString()}&days=7`)
    expect((staffRes.json as { slots: { available: boolean }[] }[]).every((d) => d.slots.every((s) => !s.available))).toBe(true)
  })

  it('the database itself refuses cross-business references', async () => {
    const { sql } = setup()
    expect(() =>
      sql.run(
        `INSERT INTO appointments (id, business_id, customer_id, staff_id, service_id, start_at, end_at, status, source, price_minor, created_at, updated_at)
         VALUES ('x', ?, 'luna_cus_1', 'luna_stf_1', 'luna_svc_1', '2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z', 'confirmed', 'online', 100, 'n', 'n')`,
        [DEMO.glow.businessId],
      ),
    ).toThrow(/FOREIGN KEY/)
    expect(() => sql.run("INSERT INTO staff_services (business_id, staff_id, service_id) VALUES (?, 'glow_stf_1', 'luna_svc_1')", [DEMO.glow.businessId])).toThrow(/FOREIGN KEY/)
  })

  it('staff members cannot change business settings', async () => {
    const { app, sql } = setup()
    insertUsers(sql, [{ email: 'jordan@lunahair.studio', name: 'Jordan Reyes', passwordHash, businessId: DEMO.luna.businessId, role: 'staff' }], NOW)
    const staff = client(app)
    await staff.login('jordan@lunahair.studio')
    expect((await staff.get('/api/app/appointments')).status).toBe(200)
    expect((await staff.patch('/api/app/business', { name: 'Jordan Hair' })).status).toBe(403)
  })
})

describe('booking lifecycle over the API (persisted in the database)', () => {
  it('book → reschedule → cancel, surviving a server restart, visible to the business', async () => {
    const path = join(dir, 'lifecycle.sqlite')
    let { app, sql } = setup(path)
    let customer = client(app)

    // Book
    const slot = await freeSlot(customer, 'luna-hair', 'luna_svc_1', 3, 'luna_stf_3')
    const created = await customer.post('/api/public/luna-hair/bookings', { serviceId: 'luna_svc_1', staffId: 'luna_stf_3', start: slot.start, name: 'Noa Bar', phone: '(555) 010-4411', notes: 'First visit', remindersOptIn: true })
    expect(created.status).toBe(201)
    const ref = created.json.reference as string
    const token = created.json.manageToken as string
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(created.json).toMatchObject({ status: 'confirmed', source: 'online', price: 85, staffId: 'luna_stf_3', notes: 'First visit' })

    // Double booking the same stylist/time is refused
    const dup = await customer.post('/api/public/luna-hair/bookings', { serviceId: 'luna_svc_1', staffId: 'luna_stf_3', start: slot.start, name: 'Someone Else', phone: '555-222-3333', remindersOptIn: false })
    expect(dup.status).toBe(409)
    expect(dup.json.error.code).toBe('slot_unavailable')

    // "Server restart": close and reopen the database file
    sql.close()
    ;({ app, sql } = setup(path, { seed: false }))
    customer = client(app)
    expect((await customer.get(`/api/public/luna-hair/bookings/${token}`)).json.start).toBe(slot.start)
    // The short reference is not a key (no guessing manage links)
    expect((await customer.get(`/api/public/luna-hair/bookings/${ref}`)).status).toBe(404)

    // Reschedule (same stylist, service, price)
    const options = (await customer.get(`/api/public/luna-hair/bookings/${token}/availability?from=${NOW.toISOString()}&days=14`)).json as { slots: { start: string; available: boolean; freeStaffIds: string[] }[] }[]
    const target = options.slice(6).flatMap((d) => d.slots).find((s) => s.available)!
    expect(target.freeStaffIds).toEqual(['luna_stf_3'])
    const moved = await customer.post(`/api/public/luna-hair/bookings/${token}/reschedule`, { start: target.start })
    expect(moved.status).toBe(200)
    expect(moved.json).toMatchObject({ start: target.start, previousStart: slot.start, staffId: 'luna_stf_3', serviceId: 'luna_svc_1', price: 85 })

    // The business sees it on the dashboard
    const owner = client(app)
    await owner.login(DEMO.luna.ownerEmail)
    const list = (await owner.get(`/api/app/appointments?customerId=${created.json.customerId}`)).json as { reference: string; start: string }[]
    expect(list).toEqual([expect.objectContaining({ reference: ref, start: target.start })])

    // Cancel with a reason; the time becomes bookable again
    const cancelled = await customer.post(`/api/public/luna-hair/bookings/${token}/cancel`, { reason: 'schedule_conflict' })
    expect(cancelled.json).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', cancellationReason: 'schedule_conflict' })
    expect((await customer.post(`/api/public/luna-hair/bookings/${token}/cancel`, {})).json.error.code).toBe('already_cancelled')
    const again = await freeSlot(customer, 'luna-hair', 'luna_svc_1', 0, 'luna_stf_3')
    const day = (await customer.get(`/api/public/luna-hair/availability?serviceId=luna_svc_1&staffId=luna_stf_3&from=${NOW.toISOString()}&days=14`)).json as { slots: { start: string; available: boolean }[] }[]
    expect(day.flatMap((d) => d.slots).find((s) => s.start === target.start)?.available).toBe(true)
    expect(again).toBeDefined()

    // Persisted after another restart
    sql.close()
    ;({ sql } = setup(path, { seed: false }))
    expect(sql.get<{ status: string; cancellation_reason: string }>('SELECT status, cancellation_reason FROM appointments WHERE reference = ?', [ref])).toEqual({ status: 'cancelled', cancellation_reason: 'schedule_conflict' })
    sql.close()
  })

  it('validates public input and reports precise errors', async () => {
    const { app } = setup()
    const c = client(app)
    const slot = await freeSlot(c, 'luna-hair', 'luna_svc_2')
    expect((await c.post('/api/public/luna-hair/bookings', { serviceId: 'luna_svc_2', start: slot.start, name: 'X', phone: '555', remindersOptIn: true })).status).toBe(400)
    expect((await c.post('/api/public/nope/bookings', { serviceId: 'luna_svc_2', start: slot.start, name: 'Dana Levi', phone: '555-123-4567', remindersOptIn: true })).status).toBe(404)
    expect((await c.get('/api/public/luna-hair/bookings/ZZZZZZ')).status).toBe(404)
    expect((await c.post('/api/public/luna-hair/bookings/ZZZZZZ/cancel', { reason: 'not-a-reason' })).status).toBe(400)
  })

  it('settings changes persist and old booking links keep working', async () => {
    const { app } = setup()
    const owner = client(app)
    await owner.login(DEMO.luna.ownerEmail)
    const b = (await owner.get('/api/app/business')).json
    const res = await owner.patch('/api/app/business', { slug: 'luna-studio', settings: { defaultLanguage: 'he', currency: 'ILS' }, hours: { ...b.hours, 3: { open: false, start: '09:00', end: '20:00' } } })
    expect(res.json).toMatchObject({ slug: 'luna-studio', settings: { defaultLanguage: 'he', currency: 'ILS' } })
    const pub = client(app)
    expect((await pub.get('/api/public/luna-studio')).json.business.settings.currency).toBe('ILS')
    expect((await pub.get('/api/public/luna-hair')).json.business.slug).toBe('luna-studio')
    const days = (await pub.get(`/api/public/luna-studio/availability?serviceId=luna_svc_1&from=${NOW.toISOString()}&days=7`)).json as { date: string; slots: unknown[] }[]
    expect(days.find((d) => new Date(d.date).getUTCDay() === 3)?.slots).toEqual([])
  })
})
