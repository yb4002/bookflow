import { expect, loginAsDemo, test } from './fixtures'
import { bookAppointment, expectNoHorizontalOverflow, lunaDaysFromToday, SLUG } from './helpers'

test('books with a chosen stylist; the booking persists and appears on the dashboard', async ({ page }) => {
  const { reference, start, manageUrl } = await bookAppointment(page, { staffName: 'Priya', name: 'Taylor Brooks', phone: '(555) 777-1212' })
  await expect(page.getByText('with Priya')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // Survives a full reload (persistent storage, not page state)
  await page.goto(manageUrl)
  await page.reload()
  await expect(page.locator('span.font-mono')).toHaveText(reference)
  await expect(page.getByText('with Priya')).toBeVisible()

  // Same data on the business side
  await loginAsDemo(page)
  await page.goto('/app/customers')
  await page.getByRole('searchbox').fill('Taylor')
  // Phone layout renders a card list (the desktop table is hidden), so match visible elements only.
  await expect(page.locator('main').getByText('Taylor Brooks').filter({ visible: true }).first()).toBeVisible()

  await page.goto('/app/calendar')
  await page.getByRole('tab', { name: 'Day' }).click()
  const days = lunaDaysFromToday(start)
  for (let i = 0; i < days; i++) await page.getByRole('button', { name: 'Next' }).click()
  await page.locator('main button[title*="Taylor Brooks"]').click()
  await expect(page.getByRole('dialog')).toContainText('Online booking page')
  await expect(page.getByRole('dialog')).toContainText('Priya Shah')
})

test('already-booked times cannot be selected', async ({ page }) => {
  await page.goto(`/book/${SLUG}?lang=en`)
  await page.locator('section[aria-labelledby=step-service] button').first().click()
  const booked = page.locator('section[aria-labelledby=step-time] .grid button[disabled]').first()
  await expect(booked).toBeVisible()
  await booked.click({ force: true })
  await expect(page.locator('#step-time')).toBeVisible() // still on the time step
  await expect(page.locator('#step-details')).toHaveCount(0)
})

test('a booking made in another tab shows up on the dashboard without reloading', async ({ page, context }) => {
  await loginAsDemo(page)
  await page.goto('/app/customers')
  await page.getByRole('searchbox').fill('Robin Park')
  await expect(page.getByText('No clients match')).toBeVisible()

  const customerTab = await context.newPage()
  await bookAppointment(customerTab, { name: 'Robin Park', phone: '(555) 404-5050' })

  await expect(page.locator('main').getByText('Robin Park').filter({ visible: true }).first()).toBeVisible()
})
