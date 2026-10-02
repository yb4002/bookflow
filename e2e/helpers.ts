import { expect, type Page } from '@playwright/test'

export const SLUG = 'luna-hair'

/** Fails the test if the page scrolls sideways (broken layout). */
export async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
}

/** Picks the first enabled date chip at least `minDaysAhead` days out, then the first free time. */
export async function pickTime(page: Page, minDaysAhead = 3) {
  const dates = page.locator('section[aria-labelledby=step-time] .scrollbar-none button')
  await expect(page.locator('section[aria-labelledby=step-time] .grid button').first()).toBeVisible()
  const count = await dates.count()
  for (let i = minDaysAhead; i < count; i++) {
    if (await dates.nth(i).isEnabled()) {
      await dates.nth(i).click()
      break
    }
  }
  const free = page.locator('section[aria-labelledby=step-time] .grid button:not([disabled])').first()
  const start = await free.getAttribute('data-start')
  await free.click()
  return start!
}

/** Books an appointment through the public page and returns its reference and start time. */
export async function bookAppointment(page: Page, opts: { lang?: 'en' | 'he'; serviceIndex?: number; staffName?: string; name?: string; phone?: string; minDaysAhead?: number } = {}) {
  const { lang = 'en', serviceIndex = 0, staffName, name = 'Jamie Rivera', phone = '(555) 010-2233', minDaysAhead = 3 } = opts
  await page.goto(`/book/${SLUG}?lang=${lang}`)
  await page.locator('section[aria-labelledby=step-service] button').nth(serviceIndex).click()
  if (staffName) await page.getByRole('radio', { name: staffName }).click()
  const start = await pickTime(page, minDaysAhead)
  await page.locator('input[autocomplete=name]').fill(name)
  await page.locator('input[type=tel]').fill(phone)
  await page.locator('form button[type=submit]').click()
  const reference = (await page.locator('p.font-mono').innerText()).trim()
  expect(reference).toMatch(/^[A-Z2-9]{6}$/)
  // The private manage link carries an unguessable token, not the short reference.
  const manageUrl = (await page.locator('a[href*="/manage/"]').first().getAttribute('href'))!
  expect(manageUrl).toMatch(new RegExp(`^/book/${SLUG}/manage/[0-9a-f]{32}$`))
  return { reference, start, manageUrl }
}

/** Luna Hair Studio is in New York: calendar days and times are New York's. */
export const LUNA_ZONE = 'America/New_York'
const lunaYmd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: LUNA_ZONE }).format(d)
/** Whole days from today to `iso` on Luna's calendar (for "Next" clicks in the day view). */
export const lunaDaysFromToday = (iso: string) => Math.round((Date.parse(`${lunaYmd(new Date(iso))}T12:00:00Z`) - Date.parse(`${lunaYmd(new Date())}T12:00:00Z`)) / 864e5)
/** "9:30 AM" as Luna's booking page shows it. */
export const lunaTime = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: LUNA_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
