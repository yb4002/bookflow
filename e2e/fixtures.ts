import { test as base, expect, type Page } from '@playwright/test'

/** Every test starts from a freshly seeded database. */
export const test = base.extend<{ resetDb: void }>({
  resetDb: [
    async ({ request }, use) => {
      const res = await request.post('/api/__test__/reset', { data: {} })
      expect(res.ok()).toBeTruthy()
      await use()
    },
    { auto: true },
  ],
})
export { expect }

export const DEMO_PASSWORD = 'bookflow-demo'
export const LUNA_OWNER = 'maya@lunahair.studio'
export const GLOW_OWNER = 'lena@glowlab.studio'

/** Signs this browser context in (session cookie) as the demo business owner. */
export async function loginAsDemo(page: Page) {
  const res = await page.request.post('/api/auth/demo-login', { data: {} })
  expect(res.ok()).toBeTruthy()
}

/** Signs in through the real login form. */
export async function loginWithForm(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto('/login?lang=en')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
}
