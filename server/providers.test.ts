import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createProviders } from './notifications/setup'
import { ProviderRegistry } from './notifications/provider'
import { emailHtml, ResendProvider, verifyResendSignature } from './notifications/providers/resend'
import { TwilioProvider, verifyTwilioSignature } from './notifications/providers/twilio'
import { DEMO } from './db/seed'
import { client, PASSWORD, setup } from './testHarness'

type Call = { url: string; init: RequestInit }
/** A fake HTTP API returning queued responses and recording requests. */
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = responses.shift() ?? Response.json({ error: 'no response queued' }, { status: 500 })
    if (next instanceof Error) throw next
    return next
  }) as typeof fetch
  return { calls, impl }
}
const msg = { idempotencyKey: 'ntf_1', channel: 'sms' as const, to: '+972525550101', body: 'Hi there', locale: 'he' as const }

describe('Twilio provider', () => {
  it('sends SMS through a Messaging Service with a status callback', async () => {
    const f = fakeFetch(Response.json({ sid: 'SM123' }, { status: 201 }))
    const p = new TwilioProvider({ accountSid: 'AC1', authToken: 'tok', messagingServiceSid: 'MG1', statusCallbackUrl: 'https://app.example/api/webhooks/twilio/status', fetch: f.impl })
    expect(p.channels).toEqual(['sms'])
    expect(await p.send(msg)).toEqual({ ok: true, providerMessageId: 'SM123' })
    expect(f.calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json')
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('AC1:tok').toString('base64')}`)
    const form = new URLSearchParams(String(f.calls[0].init.body))
    expect(Object.fromEntries(form)).toEqual({ Body: 'Hi there', To: '+972525550101', MessagingServiceSid: 'MG1', StatusCallback: 'https://app.example/api/webhooks/twilio/status' })
  })

  it('sends WhatsApp with whatsapp: addresses', async () => {
    const f = fakeFetch(Response.json({ sid: 'SM9' }, { status: 201 }))
    const p = new TwilioProvider({ accountSid: 'AC1', authToken: 'tok', smsFrom: '+15550001111', whatsappFrom: '+15550002222', fetch: f.impl })
    expect(p.channels).toEqual(['sms', 'whatsapp'])
    await p.send({ ...msg, channel: 'whatsapp' })
    const form = new URLSearchParams(String(f.calls[0].init.body))
    expect([form.get('To'), form.get('From')]).toEqual(['whatsapp:+972525550101', 'whatsapp:+15550002222'])
  })

  it('classifies failures: rate limits, server errors and network problems retry; bad numbers do not', async () => {
    const f = fakeFetch(
      Response.json({ code: 20429, message: 'Too Many Requests' }, { status: 429 }),
      Response.json({ message: 'boom' }, { status: 503 }),
      new TypeError('fetch failed'),
      Response.json({ code: 21211, message: "The 'To' number is not a valid phone number." }, { status: 400 }),
    )
    const p = new TwilioProvider({ accountSid: 'AC1', authToken: 'tok', smsFrom: '+15550001111', fetch: f.impl })
    expect(await p.send(msg)).toMatchObject({ ok: false, retryable: true, error: '429 20429 Too Many Requests' })
    expect(await p.send(msg)).toMatchObject({ ok: false, retryable: true })
    expect(await p.send(msg)).toMatchObject({ ok: false, retryable: true, error: 'network: fetch failed' })
    expect(await p.send(msg)).toMatchObject({ ok: false, retryable: false, error: "400 21211 The 'To' number is not a valid phone number." })
  })

  it('validates X-Twilio-Signature', () => {
    const url = 'https://app.example/api/webhooks/twilio/status'
    const params = { MessageSid: 'SM1', MessageStatus: 'delivered' }
    const sig = createHmac('sha1', 'tok').update(url + 'MessageSidSM1MessageStatusdelivered').digest('base64')
    expect(verifyTwilioSignature('tok', url, params, sig)).toBe(true)
    expect(verifyTwilioSignature('tok', url, { ...params, MessageStatus: 'failed' }, sig)).toBe(false)
    expect(verifyTwilioSignature('other', url, params, sig)).toBe(false)
    expect(verifyTwilioSignature('tok', url, params, undefined)).toBe(false)
  })
})

describe('Resend provider', () => {
  it('sends text + HTML email with the notification id as idempotency key', async () => {
    const f = fakeFetch(Response.json({ id: 'em_1' }))
    const p = new ResendProvider({ apiKey: 're_123', from: 'BookFlow <bookings@mail.example>', replyTo: 'help@example.com', fetch: f.impl })
    expect(await p.send({ ...msg, channel: 'email', to: 'dana@example.com', subject: 'אישור', body: 'שלום <b> https://x.example/a' })).toEqual({ ok: true, providerMessageId: 'em_1' })
    const headers = f.calls[0].init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer re_123')
    expect(headers['idempotency-key']).toBe('ntf_1')
    const body = JSON.parse(String(f.calls[0].init.body))
    expect(body).toMatchObject({ from: 'BookFlow <bookings@mail.example>', to: ['dana@example.com'], subject: 'אישור', text: 'שלום <b> https://x.example/a', reply_to: 'help@example.com' })
    expect(body.html).toContain('dir="rtl"')
    expect(body.html).toContain('&lt;b&gt;') // escaped
    expect(body.html).toContain('<a href="https://x.example/a">')
  })

  it('verifies Svix webhook signatures with replay protection', () => {
    const secret = `whsec_${Buffer.from('supersecretkey').toString('base64')}`
    const body = '{"type":"email.delivered"}'
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = createHmac('sha256', Buffer.from('supersecretkey')).update(`msg_1.${ts}.${body}`).digest('base64')
    expect(verifyResendSignature(secret, { id: 'msg_1', timestamp: ts, signature: `v1,bogus v1,${sig}` }, body)).toBe(true)
    expect(verifyResendSignature(secret, { id: 'msg_1', timestamp: ts, signature: `v1,${sig}` }, body + ' ')).toBe(false)
    expect(verifyResendSignature(secret, { id: 'msg_1', timestamp: String(Number(ts) - 3600), signature: `v1,${sig}` }, body)).toBe(false)
  })

  it('renders plain HTML safely', () => {
    expect(emailHtml('a\nb', 'en')).toContain('a<br>b')
  })
})

describe('provider setup', () => {
  it('uses real providers where configured and never simulates in production', () => {
    const live = createProviders({ twilio: { accountSid: 'AC1', authToken: 't', smsFrom: '+15550001111' }, resend: { apiKey: 're', from: 'x@y.z' }, simulateMissing: false })
    expect(live.status).toEqual({ sms: 'live', whatsapp: 'off', email: 'live' })
    expect(live.registry.for('whatsapp')).toBeUndefined()
    expect(live.registry.for('sms')?.name).toBe('twilio')
    const dev = createProviders({ simulateMissing: true })
    expect(dev.status).toEqual({ sms: 'simulated', whatsapp: 'simulated', email: 'simulated' })
  })
})

describe('provider webhooks (end to end)', () => {
  const TOKEN = 'twilio-auth-token'
  const twilioPost = async (app: ReturnType<typeof setup>['app'], path: string, params: Record<string, string>, valid = true) => {
    const url = `https://app.example${path}`
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('')
    const sig = createHmac('sha1', valid ? TOKEN : 'wrong').update(data).digest('base64')
    return app.request(path, { method: 'POST', body: new URLSearchParams(params).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig } })
  }

  it('records Twilio delivery receipts and STOP/START replies (signed only)', async () => {
    const env = setup({ webhooks: { twilioAuthToken: TOKEN } })
    const { app, sql, engine } = env
    // A Luna client with a known number; make the dispatcher send them something via a "twilio" provider stub.
    const owner = client(app)
    await owner.post('/api/auth/login', { email: DEMO.luna.ownerEmail, password: PASSWORD })
    const c = (await owner.post('/api/app/customers', { firstName: 'Noa', lastName: 'Bar', phone: '(555) 222-3333', email: '', marketingOptIn: true })).json as { id: string }
    await owner.post(`/api/app/customers/${c.id}/messages`, { body: 'Hello' })
    // Route this send through a stub named "twilio" so the receipt matches.
    const stub = { name: 'twilio', channels: ['sms'] as const, send: async () => ({ ok: true as const, providerMessageId: 'SM777' }) }
    ;(engine as unknown as { options: { providers: ProviderRegistry } }).options.providers = new ProviderRegistry([stub])
    await engine!.dispatchDue()

    expect((await twilioPost(app, '/api/webhooks/twilio/status', { MessageSid: 'SM777', MessageStatus: 'delivered' }, false)).status).toBe(403)
    expect((await twilioPost(app, '/api/webhooks/twilio/status', { MessageSid: 'SM777', MessageStatus: 'delivered' })).status).toBe(204)
    const row = sql.get<{ delivered_at: string | null; status: string }>("SELECT delivered_at, status FROM notifications WHERE provider_message_id = 'SM777'")!
    expect(row.status).toBe('sent')
    expect(row.delivered_at).toBeTruthy()

    // STOP from that phone (E.164) opts the client out; START opts back in
    const stop = await twilioPost(app, '/api/webhooks/twilio/inbound', { From: '+15552223333', To: '+15550001111', Body: 'Stop' })
    expect(stop.headers.get('content-type')).toContain('text/xml')
    expect((await owner.get(`/api/app/customers/${c.id}`)).json.messagingOptOut).toBe(true)
    expect((await owner.post(`/api/app/customers/${c.id}/messages`, { body: 'Hello again' })).json.error.code).toBe('opted_out')
    await twilioPost(app, '/api/webhooks/twilio/inbound', { From: '+15552223333', To: '+15550001111', Body: 'START' })
    expect((await owner.get(`/api/app/customers/${c.id}`)).json.messagingOptOut).toBeUndefined()
    expect(sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM inbound_messages')!.n).toBe(2)
  })

  it('refuses unsigned webhooks and webhooks that are not configured', async () => {
    const { app } = setup()
    expect((await app.request('/api/webhooks/twilio/status', { method: 'POST', body: 'MessageSid=SM1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(403)
    expect((await app.request('/api/webhooks/resend', { method: 'POST', body: '{}' })).status).toBe(403)
    expect((await app.request('/api/webhooks/stripe', { method: 'POST', body: '{}' })).status).toBe(404)
  })
})

describe('backups', () => {
  it('writes a consistent, verifiable copy and keeps only the newest', async () => {
    const { mkdtempSync, readdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { backupDatabase, integrityOk } = await import('./db/backup')
    const { openSqlite } = await import('./db/sqlite')
    const { sql } = setup()
    const dir = mkdtempSync(join(tmpdir(), 'bookflow-backup-'))
    for (let i = 0; i < 3; i++) backupDatabase(sql, dir, 2, new Date(Date.UTC(2026, 9, 1, i)))
    const files = readdirSync(dir)
    expect(files).toHaveLength(2)
    const copy = openSqlite(join(dir, files.sort().at(-1)!))
    expect(integrityOk(copy)).toBe(true)
    expect(copy.get<{ n: number }>('SELECT COUNT(*) AS n FROM appointments')!.n).toBe(sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM appointments')!.n)
    copy.close()
  })
})
