import { expect, test, type Page } from '@playwright/test'

// Runs against the real API with seed data (backend/scripts/seed_dev.py).
// Local S3 is not required: nothing here uploads a photo or POSTs with Idempotency-Key.
// Saving an expense from the browser is covered by Vitest with mocked fetch (see PR #100 for the CORS fix).
const PASSWORD = 'devpass123'

async function login(page: Page, phone: string) {
  await page.goto('/login')
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/(owner|caretaker|select-org)/)
}

test('[FE-42/AC1] caretaker: Log expense opens the form and No bill is camera-only', async ({ page }) => {
  await login(page, '9000000002')
  await page.getByRole('button', { name: 'Quick actions' }).click()
  await page.getByRole('dialog', { name: 'Quick actions' }).getByRole('link', { name: /Log expense/ }).click()
  await expect(page).toHaveURL(/\/caretaker\/expenses$/)
  await page.getByRole('link', { name: /Log expense/ }).click()
  await expect(page).toHaveURL(/\/caretaker\/expenses\/new$/)

  await page.getByRole('button', { name: 'No bill' }).click()
  const inputs = page.locator('input[type="file"]')
  await expect(inputs).toHaveCount(1)
  await expect(inputs.first()).toHaveAttribute('capture', 'environment')
  await expect(page.getByRole('radio', { name: 'Lease rent' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})

test('owner expenses page loads with the Needs review filter', async ({ page }) => {
  await login(page, '9000000001')
  await page.goto('/owner/expenses')
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible()
  await page.getByRole('button', { name: 'Needs review' }).click()
  await expect(page.getByRole('button', { name: 'Needs review' })).toHaveAttribute('aria-pressed', 'true')
})
