import { bookAppointment, lunaDaysFromToday, SLUG } from './helpers'
import { expect, loginAsDemo, test } from './fixtures'

type OutboxEntry = { channel: string; to: string; body: string; locale: string }

test('booking → confirmation & reminders → cancellation, end to end through the notification engine', async ({ page }) => {
  const phone = '(555) 818-4411'
  const e164 = '+15558184411' // what the SMS provider receives
  const { start, manageUrl } = await bookAppointment(page, { lang: 'he', name: 'נועה בר', phone })
  // Hebrew text isolates the phone number with invisible bidi marks, so match the parts.
  const note = page.getByText(/אישור בדרך אליכם למספר/)
  await expect(note).toBeVisible()
  await expect(note).toContainText(phone)

  // The background dispatcher (run now instead of waiting for its interval)
  expect((await page.request.post('/api/__test__/dispatch', { data: {} })).ok()).toBeTruthy()
  const outbox = (await (await page.request.get('/api/__test__/outbox')).json()) as OutboxEntry[]
  const confirmation = outbox.find((m) => m.to === e164)!
  expect(confirmation).toMatchObject({ channel: 'sms', locale: 'he' })
  expect(confirmation.body).toContain('התור שלכם ב-Luna Hair Studio נקבע')
  expect(confirmation.body).toContain(manageUrl)

  // The business sees what was sent and what is scheduled
  await loginAsDemo(page)
  await page.goto('/app/calendar?lang=en')
  await page.getByRole('tab', { name: 'Day' }).click()
  const days = lunaDaysFromToday(start)
  for (let i = 0; i < days; i++) await page.getByRole('button', { name: 'Next' }).click()
  await page.locator('main button[title*="נועה"]').click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('Messages to the client')).toBeVisible()
  await expect(drawer.locator('li').filter({ hasText: 'Booking confirmation' })).toContainText(/Sent|Delivered/)
  await expect(drawer.locator('li').filter({ hasText: 'Reminder' })).toHaveCount(2)
  await expect(drawer.locator('li').filter({ hasText: 'Reminder' }).first()).toContainText('Scheduled')
  await page.keyboard.press('Escape')

  // Customer cancels → reminders are withdrawn, a cancellation message goes out
  await page.goto(`${manageUrl}?lang=he`)
  await page.getByRole('button', { name: 'ביטול התור' }).click()
  await page.getByRole('button', { name: 'כן, לבטל את התור' }).click()
  await expect(page.getByRole('heading', { name: 'התור בוטל' })).toBeVisible()
  await page.request.post('/api/__test__/dispatch', { data: {} })
  const after = (await (await page.request.get('/api/__test__/outbox')).json()) as OutboxEntry[]
  expect(after.filter((m) => m.to === e164).map((m) => m.body.slice(0, 20))).toHaveLength(2)
  expect(after.filter((m) => m.to === e164)[1].body).toContain('בוטל')

  const appointmentId = (await (await page.request.get(`/api/public/${SLUG}/bookings/${manageUrl.split('/').pop()}`)).json()).id as string
  const log = (await (await page.request.get(`/api/app/notifications?appointmentId=${appointmentId}`)).json()) as { kind: string; status: string }[]
  expect(log.map((n) => `${n.kind}:${n.status}`).sort()).toEqual(['cancellation:sent', 'confirmation:sent', 'reminder:cancelled', 'reminder:cancelled'])
})

test('message channel setting persists', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/app/services?tab=policies&lang=en')
  await page.locator('select[name=notificationChannel]').selectOption('whatsapp')
  await page.getByRole('button', { name: 'Save policies' }).click()
  await expect(page.getByText('Booking policies saved')).toBeVisible()
  await page.reload()
  await expect(page.locator('select[name=notificationChannel]')).toHaveValue('whatsapp')
})
