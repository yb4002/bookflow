import { minutesIntoZonedDay, zonedWeekday } from '../src/domain/time'
import { describe, expect, it } from 'vitest'
import { DEMO } from './db/seed'
import { addUser, client, NOW, PASSWORD, PNG, setup, signup } from './testHarness'

const NY = 'America/New_York'

describe('sign-up', () => {
  it('creates the user, their own unpublished business and an owner session', async () => {
    const { app, sql } = setup()
    const c = client(app)
    const res = await signup(c)
    expect(res.status).toBe(201)
    expect(res.json).toMatchObject({ user: { email: 'dana@studio.example', name: 'Dana Levi' }, role: 'owner', business: { name: 'Studio Dana', onboardingCompleted: false, published: false } })
    const biz = (await c.get('/api/app/business')).json
    expect(biz).toMatchObject({ name: 'Studio Dana', slug: 'studio-dana', timezone: 'Europe/London', email: 'dana@studio.example', settings: { defaultLanguage: 'en', currency: 'auto' } })
    expect(biz.publishedAt).toBeUndefined()
    expect([1, 2, 3, 4, 5].every((d) => biz.hours[d].open) && !biz.hours[0].open && !biz.hours[6].open).toBe(true)
    // Starts empty — no demo data
    expect((await c.get('/api/app/services')).json).toEqual([])
    expect((await c.get('/api/app/customers')).json).toEqual([])
    expect((await c.get('/api/app/appointments')).json).toEqual([])
    expect(sql.get<{ role: string }>("SELECT role FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'dana@studio.example'")!.role).toBe('owner')
  })

  it('validates input and refuses duplicate emails', async () => {
    const { app } = setup()
    const c = client(app)
    expect((await signup(c, { email: 'not-an-email' })).json.error.code).toBe('invalid_email')
    expect((await signup(c, { password: 'short' })).json.error.code).toBe('weak_password')
    expect((await signup(c, { password: 'aaaaaaaaaa' })).json.error.code).toBe('weak_password')
    expect((await signup(c, { businessName: 'X' })).json.error.code).toBe('invalid_name')
    expect((await signup(c, { email: DEMO.luna.ownerEmail.toUpperCase() })).status).toBe(409)
    expect((await signup(c, { acceptTerms: undefined })).json.error.code).toBe('terms_required')
    // Honeypot: bots fill the hidden "website" field
    expect((await signup(c, { email: 'bot@x.example', website: 'http://spam.example' })).json.error.code).toBe('invalid_input')
  })

  it('records when the terms were accepted', async () => {
    const { app, sql } = setup()
    await signup(client(app))
    expect(sql.get<{ terms_accepted_at: string }>("SELECT terms_accepted_at FROM users WHERE email = 'dana@studio.example'")!.terms_accepted_at).toBe(NOW.toISOString())
  })

  it('generates a unique booking link (and a random one for non-Latin names)', async () => {
    const { app } = setup()
    expect((await (async () => { const c = client(app); await signup(c, { email: 'a@x.example', businessName: 'Glow Lab' }); return (await c.get('/api/app/business')).json.slug })())).toMatch(/^glow-lab-[a-f0-9]{6}$/)
    const he = client(app)
    await signup(he, { email: 'b@x.example', businessName: 'סטודיו נוגה', locale: 'he' })
    const heBiz = (await he.get('/api/app/business')).json
    expect(heBiz.slug).toMatch(/^book-[a-f0-9]{6}$/)
    expect(heBiz.settings.defaultLanguage).toBe('he')
    expect([0, 1, 2, 3, 4].every((d) => heBiz.hours[d].open) && !heBiz.hours[5].open && !heBiz.hours[6].open).toBe(true)
  })
})

describe('multi-tenant isolation for new businesses', () => {
  it('a new business and an existing one never see each other', async () => {
    const { app } = setup()
    const dana = client(app)
    await signup(dana)
    const luna = client(app)
    await luna.post('/api/auth/login', { email: DEMO.luna.ownerEmail, password: PASSWORD })
    const svc = (await dana.post('/api/app/services', { name: 'Cut', category: 'Hair', description: '', durationMin: 30, bufferMin: 0, price: 40, active: true })).json

    expect((await luna.get('/api/app/services')).json.some((s: { id: string }) => s.id === svc.id)).toBe(false)
    expect((await luna.put(`/api/app/services/${svc.id}`, { ...svc, name: 'Hijack' })).status).toBe(404)
    expect((await luna.del(`/api/app/services/${svc.id}`)).status).toBe(404)
    const lunaStaff = (await luna.get('/api/app/staff')).json[0]
    expect((await dana.put(`/api/app/staff/${lunaStaff.id}`, { name: 'Taken Over', role: '', color: 'rose', serviceIds: [] })).status).toBe(404)
    expect((await dana.post('/api/app/staff', { name: 'Sneaky', role: '', color: 'rose', serviceIds: ['luna_svc_1'] })).status).toBe(400) // can't attach another business's service
    expect((await dana.get('/api/app/customers')).json).toEqual([])
  })
})

describe('onboarding to a live booking page', () => {
  it('preview while unpublished, then publish and take a real booking within staff hours', async () => {
    const { app, provider } = setup()
    const owner = client(app)
    await signup(owner)
    const slug = (await owner.get('/api/app/business')).json.slug as string
    const anon = client(app)
    const otherOwner = client(app)
    await otherOwner.post('/api/auth/login', { email: DEMO.glow.ownerEmail, password: PASSWORD })

    // Profile, region, hours, booking rules
    const b = (await owner.get('/api/app/business')).json
    const patched = await owner.patch('/api/app/business', {
      category: 'Barbershop', description: 'Classic cuts.', phone: '(555) 300-1000', address: '1 Main St',
      timezone: 'America/New_York', settings: { defaultLanguage: 'en', currency: 'USD' },
      hours: { ...b.hours, 3: { open: true, start: '09:00', end: '18:00' } },
      policies: { ...b.policies, minNoticeHours: 1, reminderHoursBefore: [24] },
    })
    expect(patched.json).toMatchObject({ category: 'Barbershop', timezone: 'America/New_York', settings: { currency: 'USD' } })
    expect((await owner.patch('/api/app/business', { timezone: 'Nowhere/Land' })).status).toBe(400)
    expect((await owner.patch('/api/app/business', { hours: { ...b.hours, 1: { open: true, start: '18:00', end: '09:00' } } })).status).toBe(400)

    // Branding
    const logo = await owner.put('/api/app/business/images/logo', { dataUrl: PNG })
    expect(logo.json.logoUrl).toMatch(/^\/api\/assets\/biz_[\w]+\/logo-[a-f0-9]{16}\.png$/)
    const served = await anon.get(logo.json.logoUrl)
    expect([served.status, served.type, served.bytes]).toEqual([200, 'image/png', 70])
    expect((await owner.put('/api/app/business/images/cover', { dataUrl: 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') })).json.error.code).toBe('invalid_image')
    expect((await owner.raw('PUT', '/api/app/business/images/cover', JSON.stringify({ dataUrl: 'data:image/png;base64,' + 'A'.repeat(3.2 * 1024 * 1024) }))).status).toBe(413)
    expect((await anon.get('/api/assets/..%2F..%2Fetc/passwd')).status).toBe(404)

    // Publishing needs a verified email: follow the link from the sign-up email
    expect((await owner.post('/api/app/business/publish', { published: true })).json.error.code).toBe('email_unverified')
    const mail = provider.outbox.find((m) => m.to === 'dana@studio.example' && m.body.includes('/verify-email?token='))!
    expect(mail.subject).toBe('Confirm your BookFlow email')
    expect((await anon.post('/api/auth/verify-email', { token: /token=([\w-]+)/.exec(mail.body)![1] })).status).toBe(200)
    expect((await owner.get('/api/auth/me')).json.user.emailVerified).toBe(true)

    // Not bookable yet: can't publish without a service and someone to do it
    expect((await owner.post('/api/app/business/publish', { published: true })).json.error.code).toBe('not_ready')

    // Services & team with personal hours (Wednesdays 10:00–12:00)
    const svc = (await owner.post('/api/app/services', { name: 'Skin fade', category: 'Cuts', description: '', durationMin: 30, bufferMin: 0, price: 35, active: true })).json
    const closed = { open: false, start: '09:00', end: '17:00' }
    const week = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, d === 3 ? { open: true, start: '10:00', end: '12:00' } : closed]))
    const barber = (await owner.post('/api/app/staff', { name: 'Avi Cohen', role: 'Barber', color: 'teal', serviceIds: [svc.id], availability: week })).json
    expect(barber).toMatchObject({ avatarInitials: 'AC', serviceIds: [svc.id] })

    // Unpublished: hidden from the public and from other businesses, previewable by its owner, not bookable
    expect((await anon.get(`/api/public/${slug}`)).status).toBe(404)
    expect((await otherOwner.get(`/api/public/${slug}`)).status).toBe(404)
    const preview = await owner.get(`/api/public/${slug}`)
    expect(preview.json.business).toMatchObject({ name: 'Studio Dana', logoUrl: logo.json.logoUrl })
    expect(preview.json.business.publishedAt).toBeUndefined()
    const pAvail = (await owner.get(`/api/public/${slug}/availability?serviceId=${svc.id}&from=${NOW.toISOString()}&days=7`)).json as { slots: { start: string; available: boolean }[] }[]
    const slot = pAvail.flatMap((d) => d.slots).find((s) => s.available)!
    expect(zonedWeekday(slot.start, NY)).toBe(3)
    expect((await owner.post(`/api/public/${slug}/bookings`, { serviceId: svc.id, start: slot.start, name: 'Test Client', phone: '555-123-4567', remindersOptIn: true })).json.error.code).toBe('not_published')

    // Publish → live for everyone
    expect((await owner.post('/api/app/business/publish', { published: true })).json.publishedAt).toBe(NOW.toISOString())
    const live = await anon.get(`/api/public/${slug}`)
    expect(live.json.services.map((s: { name: string }) => s.name)).toEqual(['Skin fade'])
    const avail = (await anon.get(`/api/public/${slug}/availability?serviceId=${svc.id}&from=${NOW.toISOString()}&days=7`)).json as { slots: { start: string; end: string; available: boolean }[] }[]
    const free = avail.flatMap((d) => d.slots).filter((s) => s.available)
    // Staff hours are New York wall-clock time (the business's zone), not the server's.
    expect(free.every((s) => zonedWeekday(s.start, NY) === 3 && minutesIntoZonedDay(s.start, NY) >= 600 && minutesIntoZonedDay(s.end, NY) <= 720)).toBe(true)
    expect(minutesIntoZonedDay(free[0].start, NY)).toBe(600)
    const booking = await anon.post(`/api/public/${slug}/bookings`, { serviceId: svc.id, start: free[0].start, name: 'Real Customer', phone: '555-987-6543', remindersOptIn: true, locale: 'en' })
    expect(booking.status).toBe(201)
    expect(booking.json).toMatchObject({ staffId: barber.id, price: 35 })
    expect((await owner.get('/api/app/appointments')).json.map((a: { id: string }) => a.id)).toEqual([booking.json.id])
    expect((await owner.get(`/api/app/notifications?appointmentId=${booking.json.id}`)).json.map((n: { kind: string }) => n.kind)).toContain('confirmation')

    // Finish onboarding
    expect((await owner.get('/api/auth/me')).json.business.onboardingCompleted).toBe(false)
    await owner.post('/api/app/business/onboarding/complete')
    expect((await owner.get('/api/auth/me')).json.business).toMatchObject({ onboardingCompleted: true, published: true })
  })

  it('only owners can change the catalog, team and publishing', async () => {
    const { app, sql } = setup()
    addUser(sql, { email: 'staff@lunahair.studio', name: 'Staff User', businessId: DEMO.luna.businessId, role: 'staff' })
    const staff = client(app)
    await staff.post('/api/auth/login', { email: 'staff@lunahair.studio', password: PASSWORD })
    expect((await staff.post('/api/app/services', { name: 'X', category: '', description: '', durationMin: 30, bufferMin: 0, price: 1, active: true })).status).toBe(403)
    expect((await staff.post('/api/app/business/publish', { published: false })).status).toBe(403)
    expect((await staff.put('/api/app/business/images/logo', { dataUrl: PNG })).status).toBe(403)
  })
})

describe('password reset', () => {
  it('emails a single-use link, sets the new password and signs out other sessions', async () => {
    const { app, provider, advance } = setup()
    const laptop = client(app)
    await signup(laptop)
    const phone = client(app)
    await phone.post('/api/auth/login', { email: 'dana@studio.example', password: 'very-secret-pw' })

    // Sign-up sent an email-verification link; nothing else yet.
    expect(provider.outbox.map((m) => m.subject)).toEqual(['Confirm your BookFlow email'])
    provider.clear()
    // Unknown emails get the same answer and no email (no account enumeration)
    expect((await client(app).post('/api/auth/forgot-password', { email: 'nobody@example.com' })).json).toEqual({ ok: true })
    expect(provider.outbox).toHaveLength(0)

    expect((await client(app).post('/api/auth/forgot-password', { email: 'dana@studio.example', locale: 'he' })).json).toEqual({ ok: true })
    const mail = provider.outbox.at(-1)!
    expect(mail).toMatchObject({ channel: 'email', to: 'dana@studio.example', locale: 'he' })
    const token = /reset-password\?token=([\w-]+)/.exec(mail.body)![1]
    expect(mail.body).toContain('https://app.example/reset-password?token=')

    const visitor = client(app)
    expect((await visitor.post('/api/auth/reset-password', { token, password: 'short' })).json.error.code).toBe('weak_password')
    const done = await visitor.post('/api/auth/reset-password', { token, password: 'brand-new-password' })
    expect(done.json.user.email).toBe('dana@studio.example') // signed in on this device
    expect((await visitor.get('/api/app/business')).status).toBe(200)

    // Old sessions are revoked; old password no longer works; the link can't be reused
    expect((await laptop.get('/api/app/business')).status).toBe(401)
    expect((await phone.get('/api/app/business')).status).toBe(401)
    expect((await client(app).post('/api/auth/login', { email: 'dana@studio.example', password: 'very-secret-pw' })).status).toBe(401)
    expect((await client(app).post('/api/auth/login', { email: 'dana@studio.example', password: 'brand-new-password' })).status).toBe(200)
    expect((await client(app).post('/api/auth/reset-password', { token, password: 'another-password-1' })).json.error.code).toBe('invalid_token')

    // Expired links are refused
    await client(app).post('/api/auth/forgot-password', { email: 'dana@studio.example' })
    const second = /token=([\w-]+)/.exec(provider.outbox.at(-1)!.body)![1]
    advance(61 * 60_000)
    expect((await client(app).post('/api/auth/reset-password', { token: second, password: 'another-password-1' })).json.error.code).toBe('invalid_token')
  })
})
