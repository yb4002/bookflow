import { expect, loginAsDemo, test } from './fixtures'
import { SLUG } from './helpers'

/**
 * Luna Hair Studio is in New York (opening hours 9:00–20:00 local). Viewers in other time
 * zones must see the salon's local times — not times shifted into their own zone.
 */
const hour = (label: string) => {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(label.trim())
  if (!m) throw new Error(`unexpected time label "${label}"`)
  return (Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0) + Number(m[2] ?? 0) / 60
}

for (const timezoneId of ['Asia/Tokyo', 'Pacific/Honolulu']) {
  test(`a visitor in ${timezoneId} sees the salon's own hours`, async ({ browser }) => {
    const context = await browser.newContext({ timezoneId, locale: 'en-US' })
    const page = await context.newPage()
    await page.goto(`/book/${SLUG}?lang=en`)
    await page.locator('section[aria-labelledby=step-service] button').first().click()
    const slots = page.locator('section[aria-labelledby=step-time] .grid button')
    await expect(slots.first()).toBeVisible()
    const labels = (await slots.allInnerTexts()).map((s) => s.split('\n')[0])
    expect(labels.length).toBeGreaterThan(3)
    for (const l of labels) {
      const h = hour(l)
      expect(h).toBeGreaterThanOrEqual(9)
      expect(h).toBeLessThan(20)
    }
    // The ISO instant behind the first slot is 9:00+ in New York, whatever the browser's zone.
    const iso = (await slots.first().getAttribute('data-start'))!
    const ny = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso)))
    expect(ny).toBeGreaterThanOrEqual(9)
    await context.close()
  })
}

test('the dashboard schedule is shown on the salon’s clock for an owner travelling abroad', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'en-US' })
  const page = await context.newPage()
  await loginAsDemo(page)
  await page.goto('/app/calendar?lang=en')
  await page.getByRole('tab', { name: 'Day' }).click()
  // Hour labels of the grid and event times are New York wall-clock times.
  const events = page.locator('main button[title]')
  await expect(events.first()).toBeVisible()
  const titles = await events.allInnerTexts()
  const times = titles.map((t) => /(\d{1,2}(?::\d{2})?\s*[AP]M)/i.exec(t)?.[1]).filter(Boolean) as string[]
  for (const t of times) expect(hour(t)).toBeGreaterThanOrEqual(9)
  await context.close()
})
