import { expect, loginAsDemo, test } from './fixtures'
import { expectNoHorizontalOverflow } from './helpers'
import type { Page } from '@playwright/test'

/** Luna Hair Studio's calendar day `n` days from now, as YYYY-MM-DD (its zone, not the browser's). */
const lunaDate = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() + n * 86_400_000))

type OutboxMessage = { to: string; body: string; channel: string }
const outbox = async (page: Page) => {
  await page.request.post('/api/__test__/dispatch', { data: {} })
  return (await (await page.request.get('/api/__test__/outbox')).json()) as OutboxMessage[]
}

/** Picks the first day (from 2 days out) with a free time in the open form, then that time. */
async function pickFreeTime(form: ReturnType<Page['getByRole']>) {
  for (let n = 2; n < 12; n++) {
    await form.locator('input[name=date]').fill(lunaDate(n))
    const slots = form.getByTestId('form-slots')
    const closed = form.getByText(/Closed on this day|No free times/)
    await expect(slots.or(closed)).toBeVisible()
    if (await slots.isVisible()) {
      await slots.locator('button').first().click()
      return
    }
  }
  throw new Error('no free time')
}

test('the business books a phone appointment for a new client, then moves and cancels it', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/app/calendar?lang=en')
  await page.getByRole('button', { name: 'New appointment' }).click()
  const form = page.getByRole('dialog')
  await expect(form.getByRole('heading', { name: 'New appointment' })).toBeVisible()
  await form.getByRole('tab', { name: 'New client' }).click()
  await form.locator('input[name=firstName]').fill('Noa')
  await form.locator('input[name=lastName]').fill('Peretz')
  await form.locator('input[name=phone]').fill('(555) 246-8100')
  await form.locator('select[name=service]').selectOption({ label: "Men's haircut · 30 min" })
  await form.locator('select[name=staff]').selectOption({ label: 'Priya Shah' })
  await pickFreeTime(form)
  await form.locator('textarea[name=notes]').fill('First visit — referred by Dana')
  await expect(page).toHaveURL(/calendar/)
  await expectNoHorizontalOverflow(page)
  await form.getByRole('button', { name: 'Book appointment' }).click()
  await expect(page.getByText('Appointment booked')).toBeVisible()

  // The client got a confirmation with a link to manage the booking online.
  const confirmation = (await outbox(page)).find((m) => m.to === '+15552468100')!
  expect(confirmation.body).toMatch(/^Hi Noa, you're booked at Luna Hair Studio: Men's haircut with Priya on .+ Manage or cancel: http.+\/book\/luna-hair\/manage\/[0-9a-f]{32}$/)

  // Find it in the client's profile and open the appointment there.
  await page.goto('/app/customers')
  await page.getByRole('searchbox').fill('Noa Peretz')
  await page.locator('main').getByText('Noa Peretz').filter({ visible: true }).first().click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText("Men's haircut")).toBeVisible()
  await expect(drawer.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible()
  await expect(drawer.getByText('Booking confirmation')).toBeVisible()

  // Move it from the calendar's appointment drawer (via the API list for the id → calendar day view).
  const appts = (await (await page.request.get('/api/app/appointments?customerId=' + (await (await page.request.get('/api/app/customers')).json() as { id: string; firstName: string }[]).find((c) => c.firstName === 'Noa')!.id)).json()) as { id: string; start: string }[]
  expect(appts).toHaveLength(1)
  await page.goto('/app/calendar')
  await page.getByRole('tab', { name: 'Day' }).click()
  const target = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(appts[0].start))
  const ahead = Math.round((Date.parse(target + 'T12:00:00Z') - Date.parse(lunaDate(0) + 'T12:00:00Z')) / 864e5)
  for (let i = 0; i < ahead; i++) await page.getByRole('button', { name: 'Next' }).click()
  await page.locator('main button[title*="Noa Peretz"]').click()
  const appt = page.getByRole('dialog')
  await expect(appt.getByText('First visit — referred by Dana')).toBeVisible()

  await appt.getByRole('button', { name: 'Move' }).click()
  const move = page.getByRole('dialog')
  await expect(move.getByRole('heading', { name: 'Move appointment' })).toBeVisible()
  await move.locator('select[name=moveStaff]').selectOption({ label: 'Maya Cohen' })
  const moveSlots = move.getByTestId('move-slots')
  for (let n = 2; n < 12 && !(await moveSlots.isVisible()); n++) {
    await move.locator('input[name=moveDate]').fill(lunaDate(n))
    await expect(moveSlots.or(move.getByText(/Closed on this day|No free times/))).toBeVisible()
  }
  await moveSlots.locator('button').last().click()
  await move.getByRole('button', { name: 'Move appointment' }).click()
  await expect(page.getByText('Appointment moved')).toBeVisible()
  const moved = (await outbox(page)).filter((m) => m.to === '+15552468100').at(-1)!
  expect(moved.body).toMatch(/^Your Men's haircut at Luna Hair Studio is now on .+ \(was .+\)\./)

  // Cancel without telling the client: no new message.
  const before = (await outbox(page)).length
  const after = (await (await page.request.get('/api/app/appointments?customerId=' + (await (await page.request.get('/api/app/customers')).json() as { id: string; firstName: string }[]).find((c) => c.firstName === 'Noa')!.id)).json()) as { id: string; start: string; staffId: string }[]
  expect(after[0].staffId).toMatch(/stf_1$/)
  const cancel = await page.request.post(`/api/app/appointments/${after[0].id}/cancel`, { data: { notify: false } })
  expect(cancel.ok()).toBe(true)
  expect((await outbox(page)).length).toBe(before)
})

test('clients: add, edit, message, opt out, export and erase', async ({ page }) => {
  test.slow() // several flows in one test: add/edit, duplicate check, message, opt-out, export, erase
  await loginAsDemo(page)
  await page.goto('/app/customers?lang=en')
  await page.getByRole('button', { name: 'Add client' }).click()
  const form = page.getByRole('dialog')
  await form.locator('input[name=firstName]').fill('Shira')
  await form.locator('input[name=lastName]').fill('Katz')
  await form.locator('input[name=phone]').fill('(555) 321-7788')
  await form.locator('input[name=email]').fill('shira@example.com')
  await form.locator('textarea[name=notes]').fill('Sensitive scalp')
  await form.getByRole('button', { name: 'Save client' }).click()

  // The new client's profile opens; edit it
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('heading', { name: 'Client profile' })).toBeVisible()
  await expect(drawer.getByText('Shira Katz')).toBeVisible()
  await expect(drawer.getByText('Sensitive scalp')).toBeVisible()
  await drawer.getByRole('button', { name: /Edit Shira Katz/ }).click()
  await page.getByRole('dialog').locator('input[name=lastName]').fill('Katz-Levi')
  await page.getByRole('dialog').getByRole('button', { name: 'Save client' }).click()
  await expect(page.getByText('Client saved')).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Shira Katz-Levi')).toBeVisible()

  // A duplicate phone number is refused with a clear message
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Add client' }).click()
  await page.getByRole('dialog').locator('input[name=firstName]').fill('Other')
  await page.getByRole('dialog').locator('input[name=phone]').fill('555 321 7788')
  await page.getByRole('dialog').getByRole('button', { name: 'Save client' }).click()
  await expect(page.getByRole('alert')).toHaveText('A client with this phone number already exists.')
  await page.keyboard.press('Escape')

  // Message the client
  await page.getByRole('searchbox').fill('Shira')
  await page.locator('main').getByText('Shira Katz-Levi').filter({ visible: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Message' }).click()
  await page.getByRole('dialog').locator('textarea[name=message]').fill('Hi Shira, we have a new scalp treatment you might like.')
  await page.getByRole('dialog').getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('Message on its way')).toBeVisible()
  expect((await outbox(page)).find((m) => m.to === '+15553217788')?.body).toBe('Hi Shira, we have a new scalp treatment you might like.')

  // Opt out: messaging is disabled
  await page.locator('main').getByText('Shira Katz-Levi').filter({ visible: true }).first().click()
  await page.getByRole('dialog').getByRole('switch', { name: 'Don’t message this client' }).click()
  await expect(page.getByRole('dialog').getByText('No messages', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Message' })).toBeDisabled()

  // Export (real file download)
  await page.keyboard.press('Escape')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = await (await download.createReadStream()).toArray()
  const text = Buffer.concat(csv as Buffer[]).toString('utf8')
  expect(text).toContain('Shira,Katz-Levi,(555) 321-7788,shira@example.com')

  // Erase
  await page.locator('main').getByText('Shira Katz-Levi').filter({ visible: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Erase client data' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Erase permanently' }).click()
  await expect(page.getByText('Client data erased')).toBeVisible()
  await expect(page.getByText('No clients match')).toBeVisible()
})

test('Hebrew: the booking form and client form work right-to-left', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/app/customers?lang=he')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.getByRole('button', { name: 'הוספת לקוח' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'הוספת לקוח' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.keyboard.press('Escape')
  await page.goto('/app')
  await page.getByRole('button', { name: 'תור חדש' }).first().click()
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'לקוח חדש' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
