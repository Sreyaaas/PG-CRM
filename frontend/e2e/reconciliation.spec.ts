import { expect, test, type Page } from '@playwright/test'

// Runs against the real API with seed data (backend/scripts/seed_dev.py).
const OWNER_PHONE = '9000000001'
const PASSWORD = 'devpass123'
const FIXTURE = 'e2e/fixtures/statement-paytm.csv'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Mobile number').fill(OWNER_PHONE)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/owner$/)
}

test.describe('Reconciliation, end to end', () => {
  test('[FE-40/AC1,AC2] uploading the backend mock CSV shows the API counts, and rows filter by result', async ({ page }) => {
    await login(page)
    await page.goto('/owner/money/reconcile')

    await page.getByLabel('Statement source').selectOption('paytm_business')
    await page.getByLabel('Statement CSV').setInputFiles(FIXTURE)
    const responsePromise = page.waitForResponse(
      (r) => r.url().endsWith('/reconciliation/imports') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Upload and reconcile' }).click()
    const response = await responsePromise
    expect(response.status()).toBe(201)
    const result = await response.json()

    await expect(page.getByTestId('count-matched')).toHaveText(String(result.matched_count))
    await expect(page.getByTestId('count-mismatch')).toHaveText(String(result.mismatch_count))
    await expect(page.getByTestId('count-unmatched')).toHaveText(String(result.unmatched_count))

    const rows = page.getByTestId('statement-row')
    await expect(rows.first()).toBeVisible()
    await expect(rows).toHaveCount(result.row_count)

    // Each filter shows only its own result
    for (const [label, match] of [
      ['Mismatch', 'amount_mismatch'],
      ['Not logged', 'unmatched'],
      ['Matched', 'matched'],
    ] as const) {
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
      const shown = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.match))
      expect(shown.every((m) => m === match)).toBe(true)
    }

    // Mismatch rows carry the danger tone
    await page.getByRole('button', { name: /^Mismatch/ }).click()
    for (const badge of await page.getByTestId('match-badge').all()) {
      await expect(badge).toHaveAttribute('data-tone', 'danger')
    }
  })

  test('[FE-40/AC3] "Not in any statement" tab loads from the real API', async ({ page }) => {
    await login(page)
    await page.goto('/owner/money/reconcile')
    await page.getByRole('tab', { name: 'Not in any statement' }).click()
    const items = page.getByTestId('unverified-payment')
    const empty = page.getByText('Every older payment appears in a statement.')
    await expect(items.first().or(empty)).toBeVisible()
    if ((await items.count()) > 0) {
      await expect(items.first().getByRole('button', { name: 'Flag' })).toBeVisible()
      await expect(items.first().getByRole('button', { name: 'Verify manually' })).toBeVisible()
    }
  })
})
