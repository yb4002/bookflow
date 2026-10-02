import { describe, expect, it } from 'vitest'
import { DEMO } from './db/seed'
import { addUser, client, PASSWORD, setup, signup } from './testHarness'

const tokenFrom = (body: string, path: string) => new RegExp(`${path}\\?token=([\\w-]+)`).exec(body)![1]

describe('team invitations', () => {
  it('an owner invites a team member, who joins with their own login and staff permissions', async () => {
    const { app, provider } = setup()
    const owner = client(app)
    await owner.post('/api/auth/login', { email: DEMO.luna.ownerEmail, password: PASSWORD })
    const staff = (await owner.get('/api/app/staff')).json as { id: string; name: string }[]
    const priya = staff.find((s) => s.name === 'Priya Shah')!

    const inv = await owner.post('/api/app/team/invitations', { email: 'Priya@LunaHair.studio', role: 'staff', staffId: priya.id, locale: 'en' })
    expect(inv.status).toBe(201)
    expect(inv.json).toMatchObject({ email: 'priya@lunahair.studio', role: 'staff', staffId: priya.id })
    expect(JSON.stringify(inv.json)).not.toMatch(/token/i) // the secret is only in the email
    const mail = provider.outbox.at(-1)!
    expect(mail).toMatchObject({ channel: 'email', to: 'priya@lunahair.studio', subject: 'Maya Cohen invited you to Luna Hair Studio on BookFlow' })
    const token = tokenFrom(mail.body, 'accept-invite')

    // Invalid inputs and permissions
    expect((await owner.post('/api/app/team/invitations', { email: 'nope', role: 'staff' })).json.error.code).toBe('invalid_email')
    expect((await owner.post('/api/app/team/invitations', { email: 'x@y.co', role: 'admin' })).status).toBe(400)
    expect((await owner.post('/api/app/team/invitations', { email: DEMO.luna.ownerEmail, role: 'staff' })).json.error.code).toBe('already_member')

    // The invitee sees what they're joining, then accepts with a new account
    const anon = client(app)
    expect((await anon.get(`/api/auth/invitations/${token}`)).json).toEqual({ businessName: 'Luna Hair Studio', email: 'priya@lunahair.studio', role: 'staff', existingUser: false })
    expect((await anon.post('/api/auth/invitations/accept', { token, name: 'P', password: 'very-secret-pw' })).json.error.code).toBe('invalid_name')
    const joined = await anon.post('/api/auth/invitations/accept', { token, name: 'Priya Shah', password: 'very-secret-pw' })
    expect(joined.json).toMatchObject({ role: 'staff', staffId: priya.id, user: { email: 'priya@lunahair.studio', emailVerified: true }, business: { id: DEMO.luna.businessId } })
    // Single use
    expect((await client(app).post('/api/auth/invitations/accept', { token, name: 'Priya Shah', password: 'very-secret-pw' })).json.error.code).toBe('invalid_token')

    // Staff can work with bookings and clients, but not settings, team or erasure
    expect((await anon.get('/api/app/appointments')).status).toBe(200)
    expect((await anon.get('/api/app/team')).status).toBe(403)
    expect((await anon.patch('/api/app/business', { name: 'Hacked' })).status).toBe(403)
    expect((await anon.post('/api/app/team/invitations', { email: 'friend@x.co', role: 'owner' })).status).toBe(403)
    const [someone] = (await anon.get('/api/app/customers')).json as { id: string }[]
    expect((await anon.del(`/api/app/customers/${someone.id}`)).status).toBe(403)

    // The owner sees the team; removing access ends the member's session at once
    const team = (await owner.get('/api/app/team')).json as { members: { userId: string; email: string; role: string }[]; invitations: unknown[] }
    expect(team.members.map((m) => [m.email, m.role])).toEqual([[DEMO.luna.ownerEmail, 'owner'], ['priya@lunahair.studio', 'staff']])
    expect(team.invitations).toEqual([])
    const priyaUser = team.members.find((m) => m.role === 'staff')!
    expect((await owner.del(`/api/app/team/members/${priyaUser.userId}`)).status).toBe(200)
    expect((await anon.get('/api/app/appointments')).status).toBe(401)
  })

  it('an existing BookFlow user joins a second business with their password, and can switch', async () => {
    const { app, provider } = setup()
    const dana = client(app)
    await signup(dana) // owns "Studio Dana"
    const luna = client(app)
    await luna.post('/api/auth/login', { email: DEMO.luna.ownerEmail, password: PASSWORD })
    await luna.post('/api/app/team/invitations', { email: 'dana@studio.example', role: 'owner' })
    const token = tokenFrom(provider.outbox.at(-1)!.body, 'accept-invite')

    const other = client(app)
    expect((await other.get(`/api/auth/invitations/${token}`)).json.existingUser).toBe(true)
    expect((await other.post('/api/auth/invitations/accept', { token, password: 'wrong-password' })).json.error.code).toBe('wrong_password')
    const accepted = await other.post('/api/auth/invitations/accept', { token, password: 'very-secret-pw' })
    expect(accepted.json).toMatchObject({ role: 'owner', business: { name: 'Luna Hair Studio' } })
    expect((accepted.json.businesses as { name: string }[]).map((b) => b.name)).toEqual(['Luna Hair Studio', 'Studio Dana'])

    // Switch business: a fresh session scoped to the other business
    const studio = (accepted.json.businesses as { id: string; name: string }[]).find((b) => b.name === 'Studio Dana')!
    const switched = await other.post('/api/auth/switch', { businessId: studio.id })
    expect(switched.json.business.name).toBe('Studio Dana')
    expect((await other.get('/api/app/business')).json.name).toBe('Studio Dana')
    expect((await other.post('/api/auth/switch', { businessId: DEMO.glow.businessId })).status).toBe(403) // not a member
  })

  it('invitations can be revoked and expire; a business always keeps an owner', async () => {
    const { app, provider, advance } = setup()
    const owner = client(app)
    await owner.post('/api/auth/login', { email: DEMO.luna.ownerEmail, password: PASSWORD })
    const inv = (await owner.post('/api/app/team/invitations', { email: 'a@x.co', role: 'staff' })).json as { id: string }
    const token = tokenFrom(provider.outbox.at(-1)!.body, 'accept-invite')
    expect((await owner.del(`/api/app/team/invitations/${inv.id}`)).status).toBe(200)
    expect((await client(app).get(`/api/auth/invitations/${token}`)).json.error.code).toBe('invalid_token')

    await owner.post('/api/app/team/invitations', { email: 'b@x.co', role: 'staff' })
    const late = tokenFrom(provider.outbox.at(-1)!.body, 'accept-invite')
    advance(8 * 86_400_000)
    expect((await client(app).post('/api/auth/invitations/accept', { token: late, name: 'Bea', password: 'very-secret-pw' })).json.error.code).toBe('invalid_token')

    const me = (await owner.get('/api/auth/me')).json as { user: { id: string } }
    expect((await owner.patch(`/api/app/team/members/${me.user.id}`, { role: 'staff' })).json.error.code).toBe('last_owner')
    expect((await owner.del(`/api/app/team/members/${me.user.id}`)).json.error.code).toBe('last_owner')
  })

  it("can't reach into another business's team", async () => {
    const { app, sql } = setup()
    addUser(sql, { email: 'staff@glowlab.studio', name: 'Glow Staff', businessId: DEMO.glow.businessId, role: 'staff' })
    const owner = client(app)
    await owner.post('/api/auth/login', { email: DEMO.luna.ownerEmail, password: PASSWORD })
    const glowStaff = sql.get<{ id: string }>("SELECT id FROM users WHERE email = 'staff@glowlab.studio'")!
    expect((await owner.del(`/api/app/team/members/${glowStaff.id}`)).status).toBe(404)
    expect((await owner.patch(`/api/app/team/members/${glowStaff.id}`, { role: 'owner' })).status).toBe(404)
  })
})

describe('account security', () => {
  it('changes the password (current password required) and signs out other devices', async () => {
    const { app } = setup()
    const laptop = client(app)
    await signup(laptop)
    const phone = client(app)
    await phone.post('/api/auth/login', { email: 'dana@studio.example', password: 'very-secret-pw' })

    expect((await laptop.post('/api/auth/change-password', { currentPassword: 'nope', newPassword: 'another-good-pw' })).json.error.code).toBe('wrong_password')
    expect((await laptop.post('/api/auth/change-password', { currentPassword: 'very-secret-pw', newPassword: 'aaaaaaaa' })).json.error.code).toBe('weak_password')
    expect((await laptop.post('/api/auth/change-password', { currentPassword: 'very-secret-pw', newPassword: 'another-good-pw' })).status).toBe(200)
    expect((await laptop.get('/api/app/business')).status).toBe(200) // this device stays signed in
    expect((await phone.get('/api/app/business')).status).toBe(401) // others are signed out
    expect((await client(app).post('/api/auth/login', { email: 'dana@studio.example', password: 'another-good-pw' })).status).toBe(200)

    // "Sign out everywhere else"
    const tablet = client(app)
    await tablet.post('/api/auth/login', { email: 'dana@studio.example', password: 'another-good-pw' })
    expect((await laptop.post('/api/auth/logout-others')).json.signedOut).toBeGreaterThanOrEqual(1)
    expect((await tablet.get('/api/app/business')).status).toBe(401)

    // Name change
    expect((await laptop.patch('/api/auth/profile', { name: '  Dana   Levi-Cohen ' })).json.user.name).toBe('Dana Levi-Cohen')
    expect((await laptop.patch('/api/auth/profile', { name: 'D' })).status).toBe(400)
  })

  it('verifies the email address with a single-use link', async () => {
    const { app, provider } = setup()
    const dana = client(app)
    const created = await signup(dana, { locale: 'he' })
    expect(created.json.user.emailVerified).toBe(false)
    const mail = provider.outbox.at(-1)!
    expect(mail).toMatchObject({ to: 'dana@studio.example', locale: 'he', subject: 'אימות כתובת האימייל ב-BookFlow' })
    const token = tokenFrom(mail.body, 'verify-email')
    expect((await client(app).post('/api/auth/verify-email', { token: 'forged' })).json.error.code).toBe('invalid_token')
    expect((await client(app).post('/api/auth/verify-email', { token })).status).toBe(200)
    expect((await dana.get('/api/auth/me')).json.user.emailVerified).toBe(true)
    expect((await client(app).post('/api/auth/verify-email', { token })).json.error.code).toBe('invalid_token')
    // Resend does nothing once verified
    const before = provider.outbox.length
    await dana.post('/api/auth/verify-email/resend', { locale: 'en' })
    expect(provider.outbox.length).toBe(before)
  })
})

describe('demo safety', () => {
  it("a real business can't be reset to demo data, even on a demo server", async () => {
    const { app } = setup({ demoMode: true })
    const owner = client(app)
    await signup(owner)
    await owner.post('/api/app/services', { name: 'Real service', category: '', description: '', durationMin: 30, bufferMin: 0, price: 50, active: true })
    expect((await owner.post('/api/app/demo/reset')).status).toBe(404)
    expect(((await owner.get('/api/app/services')).json as { name: string }[]).map((s) => s.name)).toEqual(['Real service'])
    // The demo business itself can still be restored
    const demo = client(app)
    expect((await demo.post('/api/auth/demo-login')).status).toBe(200)
    expect((await demo.post('/api/app/demo/reset')).status).toBe(200)
  })
})
