import { expect, test, type Page } from '@playwright/test'

// Runs against the real API with seed data (backend/scripts/seed_dev.py).
const API = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const PASSWORD = 'devpass123'

async function login(page: Page, phone: string) {
  await page.goto('/login')
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  const session = await page.evaluate(() => ({
    token: localStorage.getItem('pgcrm_access_token'),
    orgId: localStorage.getItem('pgcrm_org_id'),
  }))
  const res = await page.request.get(`${API}${path}`, {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Org-Id': session.orgId ?? '' },
  })
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as T
}

interface Due {
  resident_id: string
  full_name: string
  outstanding_paise: number
}

test.describe.serial('Dues and ledger, end to end', () => {
  test('[FE-30/AC1,AC3] owner sees the API dues in order, and generating again creates 0 invoices', async ({ page }) => {
    await login(page, '9000000001')
    await expect(page).toHaveURL(/\/owner$/)
    await page.goto('/owner/money')

    const dues = await apiGet<Due[]>(page, '/dues')
    expect(dues.length).toBeGreaterThan(0)
    const rows = page.getByTestId('due-row')
    await expect(rows).toHaveCount(dues.length)
    for (const [i, due] of dues.entries()) {
      await expect(rows.nth(i)).toContainText(due.full_name)
    }

    await page.getByRole('button', { name: "Generate this month's invoices" }).click()
    await expect(page.getByText(/^Created \d+ invoices?$/)).toBeVisible()
  })

  test('[FE-30/AC2] resident ledger shows the API running balance', async ({ page }) => {
    await login(page, '9000000001')
    await expect(page).toHaveURL(/\/owner$/)
    await page.goto('/owner/money')

    const dues = await apiGet<Due[]>(page, '/dues')
    await page.getByTestId('due-row').first().click()
    await expect(page).toHaveURL(new RegExp(`/owner/residents/${dues[0].resident_id}/ledger$`))

    const ledger = await apiGet<{ entries: { balance_paise: number }[]; outstanding_paise: number }>(
      page,
      `/residents/${dues[0].resident_id}/ledger`,
    )
    const rows = page.getByTestId('ledger-row')
    await expect(rows).toHaveCount(ledger.entries.length)
    expect(ledger.entries.at(-1)?.balance_paise).toBe(ledger.outstanding_paise)
    await expect(page.getByTestId('ledger-balance').last()).toContainText('Balance ₹')
  })

  test('caretaker sees the dues list without the generate button', async ({ page }) => {
    await login(page, '9000000002')
    await expect(page).toHaveURL(/\/caretaker$/)
    await page.goto('/caretaker/payments')
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible()
    await expect(page.getByRole('button', { name: "Generate this month's invoices" })).toHaveCount(0)
  })
})
