import { expect, loginAsDemo, test } from './fixtures'
import { SLUG } from './helpers'

test('opening hours persist and change public availability', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/app/services?tab=hours&lang=en')
  const wednesday = page.getByRole('switch', { name: 'Wednesday open' })
  await expect(wednesday).toBeChecked()
  await wednesday.click()
  await page.getByRole('button', { name: 'Save hours' }).click()
  await expect(page.getByText('Opening hours saved')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Wednesday open' })).not.toBeChecked()

  // Public page: every Wednesday is now closed
  await page.goto(`/book/${SLUG}`)
  await page.locator('section[aria-labelledby=step-service] button').first().click()
  const wedChips = page.locator('section[aria-labelledby=step-time] .scrollbar-none button').filter({ hasText: 'Wed' })
  await expect(wedChips.first()).toContainText('Closed')
  await expect(wedChips.first()).toBeDisabled()
})

test('profile, booking link, language and currency persist and take effect', async ({ page, browser }) => {
  await loginAsDemo(page)
  await page.goto('/app/services?tab=profile&lang=en')
  await page.locator('input[name=slug]').fill('Not Valid!')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByRole('alert')).toContainText('lowercase')

  await page.locator('input[name=slug]').fill('luna-studio')
  await page.locator('select[name=defaultLanguage]').selectOption('he')
  await page.locator('select[name=currency]').selectOption('ILS')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Business profile saved')).toBeVisible()
  await page.reload()
  await expect(page.locator('input[name=slug]')).toHaveValue('luna-studio')
  await expect(page.locator('select[name=currency]')).toHaveValue('ILS')

  // Dashboard prices now use the business currency even in English
  await page.goto('/app')
  await expect(page.locator('main').getByText(/₪/).first()).toBeVisible()

  // New link works, and the previously shared link keeps working
  await page.goto('/book/luna-studio')
  await expect(page.getByRole('heading', { name: 'Luna Hair Studio' })).toBeVisible()
  await page.goto(`/book/${SLUG}`)
  await expect(page.getByRole('heading', { name: 'Luna Hair Studio' })).toBeVisible()

  // A first-time visitor (fresh browser, no language chosen) sees the business default: Hebrew, RTL.
  const visitor = await browser.newPage()
  await visitor.goto('/book/luna-studio')
  await expect(visitor.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(visitor.getByRole('heading', { name: 'בחרו שירות' })).toBeVisible()
  await visitor.close()
})

test('restore demo data resets everything', async ({ page }) => {
  await loginAsDemo(page)
  await page.goto('/app/services?tab=profile&lang=en')
  await page.locator('#profile-form input').first().fill('Temporary Name')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Business profile saved')).toBeVisible()
  await page.getByRole('button', { name: 'Restore demo data' }).click()
  await page.getByRole('button', { name: 'Yes, restore' }).click()
  await expect(page.getByText('Demo data restored')).toBeVisible()
  await expect(page.locator('#profile-form input').first()).toHaveValue('Luna Hair Studio')
})
