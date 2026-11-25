import { expect, test, type Page } from '@playwright/test'

// Runs against the real API with seed data (backend/scripts/seed_dev.py). Each run logs real payments (Rs 1 each).
const PASSWORD = 'devpass123'

async function login(page: Page, phone: string) {
  await page.goto('/login')
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function openFirstDue(page: Page) {
  await page.goto('/caretaker/payments')
  const row = page.getByTestId('due-row').first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /^Log payment for / }).click()
  const dialog = page.getByRole('dialog', { name: 'Log payment' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Amount').fill('1')
  return dialog
}

function uniqueUtr(): string {
  return String(Date.now()).padStart(12, '0').slice(-12)
}

test.describe.serial('Log payment, end to end', () => {
  test('[FE-31/AC1] caretaker logs a cash payment and gets the Cash badge and a WhatsApp link', async ({ page }) => {
    await login(page, '9000000002')
    await expect(page).toHaveURL(/\/caretaker$/)
    const dialog = await openFirstDue(page)
    await dialog.getByRole('button', { name: 'Log payment', exact: true }).click()

    await expect(page.getByText('Payment logged')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Cash', { exact: true })).toBeVisible()
    const share = page.getByRole('link', { name: /Share receipt on WhatsApp/ })
    await expect(share).toHaveAttribute('href', /^https:\/\/wa\.me\//)
  })

  test('[FE-31/AC2,AC4] UPI with a 12-digit UTR is Provisional, and reusing the UTR shows the API message', async ({
    page,
  }) => {
    await login(page, '9000000002')
    await expect(page).toHaveURL(/\/caretaker$/)
    const utr = uniqueUtr()

    let dialog = await openFirstDue(page)
    await dialog.getByRole('button', { name: 'UPI', exact: true }).click()
    await dialog.getByLabel('UTR').fill(utr)
    await dialog.getByRole('button', { name: 'Log payment', exact: true }).click()
    await expect(page.getByText('Payment logged')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Provisional')).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()

    dialog = await openFirstDue(page)
    await dialog.getByRole('button', { name: 'UPI', exact: true }).click()
    await dialog.getByLabel('UTR').fill(utr)
    await dialog.getByRole('button', { name: 'Log payment', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText(/UTR/i)
    await expect(page.getByText('Payment logged')).toHaveCount(0)
  })
})
