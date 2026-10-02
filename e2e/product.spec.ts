import { expect, loginAsDemo, test } from './fixtures'
import { bookAppointment, expectNoHorizontalOverflow } from './helpers'

type OutboxMessage = { to: string; body: string; channel: string }
const outbox = async (page: import('@playwright/test').Page) => {
  await page.request.post('/api/__test__/dispatch', { data: {} })
  return (await (await page.request.get('/api/__test__/outbox')).json()) as OutboxMessage[]
}

test('public pages: honest landing, legal pages and a real 404', async ({ page }) => {
  await page.goto('/?lang=en')
  await expect(page.getByRole('heading', { name: /Fewer no-shows/ })).toBeVisible()
  // No invented statistics, logos or testimonials
  await expect(page.getByText('38%')).toHaveCount(0)
  await expect(page.getByText(/thousands of/i)).toHaveCount(0)
  await expect(page.getByText('Customer stories')).toHaveCount(0)
  // No prices configured on this server → early access
  await expect(page.getByText('Free during early access').first()).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('link', { name: 'Privacy' }).click()
  await expect(page.getByRole('heading', { name: 'Privacy notice' })).toBeVisible()
  await page.goto('/terms?lang=he')
  await expect(page.getByRole('heading', { name: 'תנאי שימוש' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  await page.goto('/no/such/page?lang=en')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Go to the home page' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('settings: phone-number country, channel status and plan (pilot mode)', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/app/services?tab=profile&lang=en')
  const country = page.locator('select[name=phoneCountry]')
  await expect(country).toHaveValue('US')
  await country.selectOption('IL')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Business profile saved')).toBeVisible()
  await page.reload()
  await expect(page.locator('select[name=phoneCountry]')).toHaveValue('IL')

  await page.goto('/app/services?tab=policies')
  // This test server simulates messages: the business is told so plainly.
  await expect(page.getByTestId('channel-notice')).toContainText('simulated')

  await page.goto('/app/services?tab=billing')
  await expect(page.getByTestId('billing-status')).toHaveText('Billing isn’t set up on this server — every feature is included.')
  await expectNoHorizontalOverflow(page)
})

test('activity menu shows what clients did; Smart Fill offers carry a booking link', async ({ page, context }) => {
  await loginAsDemo(page)
  await page.goto('/app?lang=en')
  const client = await context.newPage()
  await bookAppointment(client, { name: 'Activity Tester', phone: '(555) 606-7070' })
  await client.close()

  // The bell shows an unread dot and the new online booking
  await expect(page.getByTestId('activity-unread')).toBeVisible()
  await page.getByRole('button', { name: /new update/ }).click()
  await expect(page.getByRole('dialog', { name: 'Recent activity' })).toContainText('Activity Tester booked')
  await page.keyboard.press('Escape')

  // Smart Fill: offer the demo's freshly cancelled slot to the best match
  const card = page.locator('#smart-fill')
  await card.getByRole('checkbox').first().click()
  await card.getByRole('button', { name: 'Send availability' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('radio', { name: 'SMS' }).click()
  await drawer.getByRole('button', { name: /Send to 1 client/ }).click()
  await expect(page.getByText(/Availability sent to 1 client/)).toBeVisible()
  const offer = (await outbox(page)).find((m) => m.body.includes('just opened up'))!
  expect(offer.body).toMatch(/Book it here — first come, first served: http\S+\/book\/luna-hair\?service=\S+&staff=\S+&date=\d{4}-\d{2}-\d{2}/)
  // The link opens the booking page on that service and day
  const link = new URL(/http\S+\/book\/luna-hair\?\S+/.exec(offer.body)![0])
  await page.goto(link.pathname + link.search + '&lang=en')
  await expect(page.locator('#step-time')).toBeVisible()
})

test('import clients from a spreadsheet (CSV)', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/app/customers?lang=en')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const csv = ['שם מלא,טלפון,אימייל,הערות', 'Tamar Ofer,052-555-0111,tamar@example.com,Prefers mornings', 'Broken Row,not-a-phone,,', '"Levi, Dana",(555) 600-1234,,'].join('\n')
  await page.getByLabel('Choose CSV file').setInputFiles({ name: 'clients.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('3 clients found in clients.csv')).toBeVisible()
  await expect(drawer.getByTestId('import-columns')).toContainText('Phone ← טלפון')
  await drawer.getByRole('button', { name: 'Import 3 clients' }).click()
  await expect(drawer.getByText('2 clients imported.')).toBeVisible()
  await expect(drawer.getByText(/invalid phone number were skipped: 3\./)).toBeVisible()
  await drawer.getByRole('button', { name: 'Close' }).last().click()
  await page.getByRole('searchbox').fill('Tamar')
  await expect(page.locator('main').getByText('Tamar Ofer').filter({ visible: true }).first()).toBeVisible()
})
