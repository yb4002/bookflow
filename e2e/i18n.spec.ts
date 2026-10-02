import { expect, test } from './fixtures'
import { bookAppointment, expectNoHorizontalOverflow, SLUG } from './helpers'

test('Hebrew booking flow is right-to-left with shekel prices', async ({ page }) => {
  await page.goto(`/book/${SLUG}?lang=he`)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'he')
  await expect(page.locator('section[aria-labelledby=step-service]')).toContainText('₪')
  await expectNoHorizontalOverflow(page)

  const { manageUrl } = await bookAppointment(page, { lang: 'he', name: 'נועה בר', phone: '(555) 010-4411' })
  await expect(page.getByText('התור נקבע!')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(manageUrl)
  await expect(page.getByRole('button', { name: 'שינוי מועד' })).toBeVisible()
  await expect(page.locator('dl')).toContainText('₪')
})

test('English stays left-to-right with dollar prices', async ({ page }) => {
  await page.goto(`/book/${SLUG}?lang=en`)
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('section[aria-labelledby=step-service]')).toContainText('$')
  await expectNoHorizontalOverflow(page)
})
