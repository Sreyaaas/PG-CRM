import { expect, test, type Page } from '@playwright/test'

// Runs against the real API with seed data (backend/scripts/seed_dev.py).
const PASSWORD = 'devpass123'

async function login(page: Page, phone: string) {
  await page.goto('/login')
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/(owner|caretaker|select-org)/)
  if (/select-org/.test(page.url())) {
    await page.getByRole('button').nth(1).click()
  }
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test('[FE-03/AC3] owner: the centre + opens Add property, Add caretaker and Approvals', async ({ page }) => {
  await login(page, '9000000001')
  await expect(page).toHaveURL(/\/owner$/)
  await page.getByRole('button', { name: 'Quick actions' }).click()
  const sheet = page.getByRole('dialog', { name: 'Quick actions' })
  await expect(sheet.getByRole('link', { name: /Add property/ })).toBeVisible()
  await expect(sheet.getByRole('link', { name: /Add caretaker/ })).toBeVisible()
  await expect(sheet.getByRole('link', { name: /Approvals/ })).toBeVisible()
  await sheet.getByRole('link', { name: /Add property/ }).click()
  await expect(page).toHaveURL(/\/owner\/properties\/new$/)
  await expect(sheet).toBeHidden()
})

test('[FE-03/AC3] caretaker: the centre + opens Log payment, Log expense and Approve check-in', async ({ page }) => {
  await login(page, '9000000002')
  await expect(page).toHaveURL(/\/caretaker$/)
  await page.getByRole('button', { name: 'Quick actions' }).click()
  const sheet = page.getByRole('dialog', { name: 'Quick actions' })
  await expect(sheet.getByRole('link', { name: /Log payment/ })).toBeVisible()
  await expect(sheet.getByRole('link', { name: /Log expense/ })).toBeVisible()
  await expect(sheet.getByRole('link', { name: /Approve check-in/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

for (const width of [320, 375, 390, 412]) {
  test(`shells and sign-in have no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 })
    await page.goto('/login')
    await noHorizontalScroll(page)
    await page.goto('/dev/ui')
    await noHorizontalScroll(page)
    await login(page, '9000000001')
    await expect(page).toHaveURL(/\/owner$/)
    await noHorizontalScroll(page)
  })
}
