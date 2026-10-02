import { expect, loginWithForm, LUNA_OWNER, test } from './fixtures'
import { expectNoHorizontalOverflow } from './helpers'

type OutboxMessage = { to: string; body: string; subject?: string }
const lastMailTo = async (page: import('@playwright/test').Page, to: string) => {
  const all = (await (await page.request.get('/api/__test__/outbox')).json()) as OutboxMessage[]
  return all.filter((m) => m.to === to).at(-1)!
}

test('an owner invites a stylist, who joins with their own login and sees only what staff may see', async ({ page, browser }) => {
  await loginWithForm(page, LUNA_OWNER)
  await expect(page).toHaveURL(/\/app$/)
  await page.goto('/app/services?tab=team&lang=en')
  const access = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Logins & access' }) }).last()
  await expect(page.getByRole('heading', { name: 'Logins & access' })).toBeVisible()
  await page.locator('input[name=inviteEmail]').fill('priya@lunahair.studio')
  await page.locator('select[name=inviteStaff]').selectOption({ label: 'Priya Shah' })
  await page.getByRole('button', { name: 'Send invitation' }).click()
  await expect(page.getByText('Invitation sent to priya@lunahair.studio')).toBeVisible()
  await expect(page.getByTestId('team-invitation')).toContainText('priya@lunahair.studio')
  await expectNoHorizontalOverflow(page)
  void access

  // The invitee opens the emailed link in their own browser
  const mail = await lastMailTo(page, 'priya@lunahair.studio')
  expect(mail.subject).toBe('Maya Cohen invited you to Luna Hair Studio on BookFlow')
  const link = new URL(/https?:\/\/\S+accept-invite\?token=[\w-]+/.exec(mail.body)![0])
  const priya = await (await browser.newContext({ viewport: page.viewportSize()! })).newPage()
  await priya.goto(`${link.pathname}${link.search}&lang=en`)
  await expect(priya.getByRole('heading', { name: 'Join Luna Hair Studio' })).toBeVisible()
  await priya.getByLabel('Your name').fill('Priya Shah')
  await priya.getByLabel('Password').fill('priya-strong-pw')
  await priya.getByRole('button', { name: 'Accept & sign in' }).click()
  await expect(priya).toHaveURL(/\/app$/)
  await expect(priya.getByRole('heading', { name: /Priya$/ })).toBeVisible()

  // Team members have no settings
  await expect(priya.getByRole('link', { name: /Services/ })).toHaveCount(0)
  await priya.goto('/app/services')
  await expect(priya).toHaveURL(/\/app$/)

  // The owner sees them as a member and removes their access → they're signed out
  await page.reload()
  await expect(page.getByTestId('team-member').filter({ hasText: 'priya@lunahair.studio' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove access: Priya Shah' }).click()
  await expect(page.getByText('Access removed')).toBeVisible()
  await priya.goto('/app/customers')
  await expect(priya).toHaveURL(/\/login/)
})

test('account page: change password, then sign in with the new one', async ({ page }) => {
  await loginWithForm(page, LUNA_OWNER)
  await expect(page).toHaveURL(/\/app$/)
  await page.goto('/app/account?lang=en')
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible()
  await expect(page.getByText('Verified')).toBeVisible()
  await page.locator('input[name=currentPassword]').fill('wrong-one')
  await page.locator('input[name=newPassword]').fill('a-brand-new-pass')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('alert')).toHaveText('Your current password isn’t right.')
  await page.locator('input[name=currentPassword]').fill('bookflow-demo')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Password changed. Other devices were signed out.')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.context().clearCookies()
  await loginWithForm(page, LUNA_OWNER, 'a-brand-new-pass')
  await expect(page).toHaveURL(/\/app$/)
})

test('a new owner confirms their email from the verification link', async ({ page }) => {
  const email = `verify-${Date.now()}@example.com`
  await page.goto('/signup?lang=en')
  await page.getByLabel('Your name').fill('Tal Ben-Ami')
  await page.getByLabel('Business name').fill('Tal Barbers')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('very-secret-pw')
  await page.getByRole('checkbox').check() // Terms of Service & Privacy Policy
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  const mail = await lastMailTo(page, email)
  expect(mail.subject).toBe('Confirm your BookFlow email')
  const link = new URL(/https?:\/\/\S+verify-email\?token=[\w-]+/.exec(mail.body)![0])
  await page.goto(link.pathname + link.search)
  await expect(page.getByText('Thanks — your email is confirmed.')).toBeVisible()
  expect((await (await page.request.get('/api/auth/me')).json()).user.emailVerified).toBe(true)
})
