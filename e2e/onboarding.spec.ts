import { expect, test } from './fixtures'

/** A real 8×8 PNG (generated) — exercises the browser resize + server signature checks. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPwd3uKFTEMLQkAx2Rege9i6lUAAAAASUVORK5CYII=',
  'base64',
)

test('a new business signs up, completes onboarding, publishes and takes a real booking', async ({ page, browser }) => {
  const email = `owner-${Date.now()}@example.com`

  // 1. Sign up
  await page.goto('/signup?lang=en')
  await page.getByLabel('Your name').fill('Dana Levi')
  await page.getByLabel('Business name').fill('Studio Dana')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('very-secret-pw')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByText('Welcome, Dana!')).toBeVisible()

  // The dashboard stays closed until setup is finished
  await page.goto('/app')
  await expect(page).toHaveURL(/\/onboarding$/)

  // 2. Business details
  await page.locator('input[name=category]').fill('Barbershop')
  await page.locator('textarea[name=description]').fill('Classic cuts and hot-towel shaves.')
  await page.locator('input[name=phone]').fill('(555) 300-1000')
  await page.locator('input[name=address]').fill('1 Main St, Springfield')
  await page.getByRole('button', { name: 'Save & continue' }).click()

  // 3. Logo (real upload through the browser resize + server validation)
  await expect(page.getByRole('heading', { name: 'Add your logo and a cover photo' })).toBeVisible()
  await page.locator('input[data-kind=logo]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('img', { name: 'Logo' })).toHaveAttribute('src', /\/api\/assets\/biz_\w+\/logo-[a-f0-9]{16}\.(webp|png)$/)
  await page.getByRole('button', { name: 'Save & continue' }).click()

  // 4. Region
  await page.locator('select[name=timezone]').selectOption('Asia/Jerusalem')
  await page.locator('select[name=currency]').selectOption('USD')
  await page.getByRole('button', { name: 'Save & continue' }).click()

  // 5. Hours: open Saturdays too
  await expect(page.getByRole('heading', { name: 'When are you open?' })).toBeVisible()
  await page.getByRole('switch', { name: 'Saturday open' }).click()
  await page.getByRole('button', { name: 'Save & continue' }).click()

  // 6. Services — can't continue without one
  await expect(page.getByRole('heading', { name: 'What do clients book?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save & continue' })).toBeDisabled()
  await page.getByRole('button', { name: 'Add service' }).click()
  const svc = page.getByRole('dialog')
  await svc.locator('input[name=serviceName]').fill('Skin fade')
  await svc.locator('input[name=serviceCategory]').fill('Cuts')
  await svc.locator('input[name=serviceDuration]').fill('30')
  await svc.locator('input[name=servicePrice]').fill('35')
  await svc.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.locator('main').getByText('Skin fade')).toBeVisible()
  await page.getByRole('button', { name: 'Save & continue' }).click()

  // 7. Team: add the owner, with custom hours (Wednesdays only)
  await expect(page.getByRole('heading', { name: 'Who takes the appointments?' })).toBeVisible()
  await page.getByRole('button', { name: 'Add me (Dana)' }).click()
  const staff = page.getByRole('dialog')
  await expect(staff.locator('input[name=staffName]')).toHaveValue('Dana Levi')
  await staff.getByRole('tab', { name: 'Custom hours' }).click()
  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Thursday', 'Friday', 'Saturday']) {
    const sw = staff.getByRole('switch', { name: `Dana Levi: ${day} open` })
    if ((await sw.getAttribute('aria-checked')) === 'true') await sw.click()
  }
  await staff.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('main').getByText('Custom working hours')).toBeVisible()
  await page.getByRole('button', { name: 'Save & continue' }).click()

  // 8. Booking rules
  await expect(page.getByRole('heading', { level: 1, name: 'Booking rules' })).toBeVisible()
  await page.getByRole('button', { name: 'Save & continue' }).click()

  // 9. Booking page: auto-generated link, preview while unpublished
  await expect(page.getByRole('heading', { name: 'Your booking page' })).toBeVisible()
  const slug = await page.locator('input[name=slug]').inputValue()
  expect(slug).toBe('studio-dana')
  const preview = await page.context().newPage()
  await preview.goto(`/book/${slug}`)
  await expect(preview.getByTestId('preview-banner')).toBeVisible()
  await expect(preview.getByRole('heading', { name: 'Studio Dana' })).toBeVisible()
  await preview.close()
  // …while the public can't see it yet
  const visitor = await browser.newPage()
  await visitor.goto(`/book/${slug}?lang=en`)
  await expect(visitor.getByText('Booking page not found')).toBeVisible()

  await page.getByRole('button', { name: 'Publish & open dashboard' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByRole('heading', { name: /Dana$/ })).toBeVisible()
  await expect(page.locator('main').getByText('Here’s how Studio Dana is doing.')).toBeVisible()
  await expect(page.getByText('Demo business')).toHaveCount(0)

  // 10. A real customer books on the live page (anonymous browser)
  await visitor.goto(`/book/${slug}?lang=en`)
  await expect(visitor.getByRole('heading', { name: 'Studio Dana' })).toBeVisible()
  await expect(visitor.getByRole('img', { name: 'Studio Dana' })).toBeVisible()
  await visitor.locator('section[aria-labelledby=step-service] button').filter({ hasText: 'Skin fade' }).click()
  const free = visitor.locator('section[aria-labelledby=step-time] .grid button:not([disabled])').first()
  await expect(free).toBeVisible()
  const start = new Date((await free.getAttribute('data-start'))!)
  // Only Wednesdays (Dana's custom hours)
  expect(start.getDay()).toBe(3)
  await free.click()
  await visitor.locator('input[autocomplete=name]').fill('Real Customer')
  await visitor.locator('input[type=tel]').fill('(555) 987-6543')
  await visitor.locator('form button[type=submit]').click()
  await expect(visitor.getByText("You're booked!")).toBeVisible()
  await visitor.close()

  // 11. The owner sees exactly their own data
  await page.goto('/app/customers')
  await expect(page.getByText(/Showing 1 of 1 clients/)).toBeVisible()
  await expect(page.locator('main').getByText('Real Customer').filter({ visible: true }).first()).toBeVisible()
  await page.goto('/app/services?tab=profile')
  await expect(page.getByTestId('publish-status')).toContainText('Published')
})

test('password reset by email', async ({ page }) => {
  const email = `reset-${Date.now()}@example.com`
  await page.goto('/signup?lang=en')
  await page.getByLabel('Your name').fill('Rina Shapiro')
  await page.getByLabel('Business name').fill('Rina Nails')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('first-password-1')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login/)

  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('status')).toContainText('reset link is on its way')

  const outbox = (await (await page.request.get('/api/__test__/outbox')).json()) as { to: string; body: string; channel: string }[]
  const mail = outbox.find((m) => m.to === email && m.channel === 'email')!
  const link = /https?:\/\/[^\s]+\/reset-password\?token=[\w-]+/.exec(mail.body)![0]
  await page.goto(new URL(link).pathname + new URL(link).search)
  await page.getByLabel('New password').fill('second-password-2')
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page).toHaveURL(/\/onboarding$/) // signed in, setup not finished yet

  // Old password no longer works; the new one does
  expect((await page.request.post('/api/auth/login', { data: { email, password: 'first-password-1' } })).status()).toBe(401)
  expect((await page.request.post('/api/auth/login', { data: { email, password: 'second-password-2' } })).status()).toBe(200)
})

test('Hebrew sign-up runs the wizard right-to-left', async ({ page }) => {
  await page.goto('/signup?lang=he')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.getByLabel('השם שלכם').fill('נגה כהן')
  await page.getByLabel('שם העסק').fill('סטודיו נוגה')
  await page.getByLabel('אימייל').fill(`noga-${Date.now()}@example.com`)
  await page.getByLabel('סיסמה').fill('very-secret-pw')
  await page.getByRole('button', { name: 'יצירת חשבון' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByRole('heading', { name: 'ספרו ללקוחות על העסק' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  const biz = await (await page.request.get('/api/app/business')).json()
  expect(biz.slug).toMatch(/^book-[a-f0-9]{6}$/)
  expect(biz.settings.defaultLanguage).toBe('he')
})
