import { describe, expect, it } from 'vitest'
import { DEMO } from './db/seed'
import { client, PASSWORD, setup } from './testHarness'

async function freeSlot(c: ReturnType<typeof client>, minDaysAhead = 3) {
  const days = (await c.get(`/api/public/luna-hair/availability?serviceId=luna_svc_2&staffId=luna_stf_3&days=14`)).json as { slots: { start: string; available: boolean }[] }[]
  return days.slice(minDaysAhead).flatMap((d) => d.slots).filter((s) => s.available)
}

describe('activity feed', () => {
  it("lists what clients did online (not the business's own actions), newest first", async () => {
    const { app, advance } = setup()
    const owner = client(app)
    await owner.post('/api/auth/login', { email: DEMO.luna.ownerEmail, password: PASSWORD })

    const anon = client(app)
    const [s1, , , s4] = await freeSlot(anon)
    const booked = (await anon.post('/api/public/luna-hair/bookings', { serviceId: 'luna_svc_2', staffId: 'luna_stf_3', start: s1.start, name: 'Feed Tester', phone: '(555) 700-0001', remindersOptIn: true })).json
    advance(60_000)
    await anon.post(`/api/public/luna-hair/bookings/${booked.manageToken}/reschedule`, { start: s4.start })
    advance(60_000)
    await anon.post(`/api/public/luna-hair/bookings/${booked.manageToken}/cancel`, { reason: 'unwell' })
    // A booking entered by the business itself is not "activity"
    await owner.post('/api/app/appointments', { customer: { firstName: 'Phone', lastName: 'Client', phone: '(555) 700-0002', email: '', marketingOptIn: false }, serviceId: 'luna_svc_2', staffId: 'luna_stf_1', start: s1.start, source: 'phone', notify: false })

    const feed = (await owner.get('/api/app/activity')).json as { type: string; customerName: string; serviceName?: string }[]
    const mine = feed.filter((i) => i.customerName === 'Feed Tester')
    expect(mine.map((i) => i.type)).toEqual(['cancelled', 'rescheduled', 'booked'])
    expect(mine[0].serviceName).toBe("Men's haircut")
    expect(feed.some((i) => i.customerName === 'Phone Client')).toBe(false)
    // Newest first: the three things this client just did head the (capped) feed.
    expect(feed.slice(0, 3).map((i) => i.customerName)).toEqual(['Feed Tester', 'Feed Tester', 'Feed Tester'])

    // Another business sees none of it
    const glow = client(app)
    await glow.post('/api/auth/login', { email: DEMO.glow.ownerEmail, password: PASSWORD })
    expect(((await glow.get('/api/app/activity')).json as { customerName: string }[]).some((i) => i.customerName === 'Feed Tester')).toBe(false)
  })
})

describe('public abuse limits', () => {
  it('rate-limits guessing manage links', async () => {
    const { app } = setup()
    const anon = client(app)
    let last = 0
    for (let i = 0; i < 125; i++) last = (await anon.get(`/api/public/luna-hair/bookings/${'0'.repeat(31)}${(i % 10).toString()}`)).status
    expect(last).toBe(429)
  })
})
