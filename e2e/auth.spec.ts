import { DEMO_PASSWORD, expect, GLOW_OWNER, LUNA_OWNER, loginWithForm, test } from './fixtures'

test('dashboard routes require login and return to the requested page', async ({ page }) => {
  await page.goto('/app/customers?lang=en')
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fcustomers/)
  await expect(page.getByRole('heading', { name: 'Log in to BookFlow' })).toBeVisible()

  await page.getByLabel('Email').fill(LUNA_OWNER)
  await page.getByLabel('Password').fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/customers(\?lang=en)?$/)
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible()
})

test('wrong password shows an error and does not sign in', async ({ page }) => {
  await loginWithForm(page, LUNA_OWNER, 'wrong-password')
  await expect(page.getByRole('alert')).toContainText('don’t match')
  await page.goto('/app')
  await expect(page).toHaveURL(/\/login/)
})

test('signed-in owner sees their own name and business; logout ends the session', async ({ page }) => {
  await loginWithForm(page, LUNA_OWNER)
  await expect(page.getByRole('heading', { name: /Maya$/ })).toBeVisible()
  await expect(page.locator('main')).toContainText('Luna Hair Studio')

  // Log out (desktop sidebar button or mobile account menu)
  const sidebarLogout = page.locator('aside').getByRole('button', { name: 'Log out' })
  if (await sidebarLogout.isVisible()) await sidebarLogout.click()
  else {
    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
  }
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/app/calendar')
  await expect(page).toHaveURL(/\/login/)
  expect((await page.request.get('/api/app/business')).status()).toBe(401)
})

test("another business's owner sees only their own business", async ({ page }) => {
  await loginWithForm(page, GLOW_OWNER)
  await expect(page.getByRole('heading', { name: /Lena$/ })).toBeVisible()
  await expect(page.locator('main')).toContainText('Glow Lab')

  await page.goto('/app/customers')
  await expect(page.getByText(/Showing 60 of 60 clients/)).toBeVisible()
  // A Luna-only client name is not reachable from Glow Lab's account
  const lunaOnly = await page.request.get('/api/app/customers/luna_cus_200')
  expect(lunaOnly.status()).toBe(404)
  expect((await page.request.patch('/api/app/business', { data: { slug: 'luna-hair' } })).status()).toBe(409)
})

test('demo button signs into Luna Hair Studio', async ({ page }) => {
  await page.goto('/login?lang=en')
  await page.getByRole('button', { name: 'Explore the demo business' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.locator('main')).toContainText('Luna Hair Studio')
})

test('login page is right-to-left in Hebrew', async ({ page }) => {
  await page.goto('/login?lang=he')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('heading', { name: 'התחברות ל-BookFlow' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
})
