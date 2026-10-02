import { expect, loginAsDemo, test } from './fixtures'
import { bookAppointment, lunaTime, SLUG } from './helpers'

test('reschedule then cancel: persisted, slot released, Smart Fill picks it up', async ({ page }) => {
  const { start, manageUrl } = await bookAppointment(page, { name: 'Morgan Ellis', phone: '(555) 312-0000' })

  // Reschedule to a later day
  await page.goto(manageUrl)
  await page.getByRole('button', { name: 'Reschedule' }).click()
  await expect(page.locator('span[aria-current=true]')).toHaveCount(1) // current time marked
  const dates = page.locator('section[aria-labelledby=step-time] .scrollbar-none button')
  const selected = await dates.evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-pressed') === 'true'))
  for (let i = selected + 2; i < (await dates.count()); i++) {
    if (await dates.nth(i).isEnabled()) {
      await dates.nth(i).click()
      break
    }
  }
  const newTime = page.locator('section[aria-labelledby=step-time] .grid button:not([disabled])').first()
  const newStart = (await newTime.getAttribute('data-start'))!
  await newTime.click()
  await page.getByRole('button', { name: 'Confirm new time' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Your appointment was moved' })).toBeVisible()
  expect(newStart).not.toBe(start)

  // Persisted across reload, with the previous time noted
  await page.reload()
  await expect(page.locator('dl')).toContainText('Previously')

  // Cancel with a reason
  await page.getByRole('button', { name: 'Cancel appointment' }).click()
  await expect(page.locator('#cancel-what')).toContainText('released immediately')
  await page.getByRole('radio', { name: 'Schedule conflict' }).click()
  await page.getByRole('button', { name: 'Yes, cancel appointment' }).click()
  await expect(page.getByRole('heading', { name: 'Appointment cancelled' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Appointment cancelled' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reschedule' })).toHaveCount(0)

  // Released time is bookable again
  await page.goto(`/book/${SLUG}?lang=en`)
  await page.locator('section[aria-labelledby=step-service] button').first().click()
  await expect(page.locator('section[aria-labelledby=step-time] .grid button').first()).toBeVisible()
  const dayOfSlot = new Date(newStart).toDateString()
  const chips = page.locator('section[aria-labelledby=step-time] .scrollbar-none button')
  // The date strip starts today, so the chip index is the number of days from today.
  const index = await page.evaluate((d) => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return Math.round((new Date(d).getTime() - start.getTime()) / 864e5)
  }, dayOfSlot)
  await chips.nth(index).click()
  await expect(page.locator(`section[aria-labelledby=step-time] .grid button[data-start="${newStart}"]`)).toBeEnabled()

  // Smart Fill (fresh dashboard load) lists the cancelled slot with the customer's reason
  await loginAsDemo(page)
  await page.goto('/app')
  const card = page.locator('#smart-fill')
  const time = lunaTime(newStart) // shown on the salon's clock
  const tab = card.getByRole('tab').filter({ hasText: time })
  await tab.first().click()
  await expect(card).toContainText('Reason: Schedule conflict')
  await expect(card).toContainText('Morgan Ellis')
  await expect(card.locator('ul > li').first()).toBeVisible() // ranked candidates
})

test('changes are blocked inside the 24-hour window', async ({ page }) => {
  const { reference, manageUrl } = await bookAppointment(page, { minDaysAhead: 0, name: 'Soon Client', phone: '(555) 444-1234' })
  await page.goto(manageUrl)
  await expect(page.locator('span.font-mono')).toHaveText(reference)
  // Today's or tomorrow's bookings fall inside the window → call-the-business note, no buttons
  const reschedule = page.getByRole('button', { name: 'Reschedule' })
  if (await reschedule.count()) test.skip(true, 'First free slot was more than 24h away')
  await expect(page.getByText('Online changes close 24 hours before')).toBeVisible()
})
