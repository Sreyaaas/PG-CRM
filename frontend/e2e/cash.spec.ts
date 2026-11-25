import { expect, test, type Page } from '@playwright/test'

// Runs against the real API with seed data (backend/scripts/seed_dev.py).
const API = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const OWNER_PHONE = '9000000001'
const CARETAKER_PHONE = '9000000002'
const PASSWORD = 'devpass123'

async function login(page: Page, phone: string) {
  await page.goto('/login')
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function balances(page: Page) {
  const { token, orgId } = await page.evaluate(() => ({
    token: localStorage.getItem('pgcrm_access_token'),
    orgId: localStorage.getItem('pgcrm_org_id'),
  }))
  const res = await page.request.get(`${API}/cash/balances`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': orgId ?? '' },
  })
  expect(res.ok()).toBe(true)
  return (await res.json()) as { user_id: string; full_name: string; in_hand_paise: number }[]
}

function rupees(paise: number): string {
  const abs = Math.abs(paise)
  const text = (abs / 100).toLocaleString('en-IN', { minimumFractionDigits: abs % 100 ? 2 : 0 })
  return `${paise < 0 ? '-' : ''}₹${text}`
}

test.describe.serial('Cash in hand, end to end', () => {
  test('[FE-41/AC1,AC3] caretaker sees the API balance and has no handover button', async ({ page }) => {
    await login(page, CARETAKER_PHONE)
    await expect(page).toHaveURL(/\/caretaker$/)
    const [mine] = await balances(page)

    await page.goto('/caretaker/more')
    await page.getByRole('link', { name: 'My cash' }).click()
    await expect(page.getByText('Cash with you')).toBeVisible()
    await expect(page.getByText('Cash with you').locator('..')).toContainText(rupees(mine.in_hand_paise))
    await expect(page.getByRole('button', { name: /handover/i })).toHaveCount(0)
  })

  // Blocked by a backend gap: CORS allow_headers in backend/app/main.py omits Idempotency-Key, so the browser's
  // preflight for POST /cash/handovers is rejected ("Disallowed CORS headers"). Enable once that is fixed.
  // Deliberately not tagged [FE-41/AC2]: AC2 is proven by the Vitest test until then.
  test.fixme('owner records a handover against the real API and the balance drops', async ({ page }) => {
    await login(page, OWNER_PHONE)
    await expect(page).toHaveURL(/\/owner$/)
    const before = (await balances(page)).sort((a, b) => b.in_hand_paise - a.in_hand_paise)[0]

    await page.goto('/owner/money/cash')
    await page.getByTestId('caretaker-cash-row').first().click()
    await page.getByRole('button', { name: 'Record handover' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Amount received').fill('100')
    await dialog.getByLabel('Notes (optional)').fill('e2e handover')
    await dialog.getByRole('button', { name: 'Review' }).click()
    await expect(page.getByText(/Confirm you received ₹100 in cash from/)).toBeVisible()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(dialog).toBeHidden()

    const after = (await balances(page)).find((b) => b.user_id === before.user_id)!
    expect(after.in_hand_paise).toBe(before.in_hand_paise - 10000)
    await expect(page.getByText('e2e handover')).toBeVisible()
  })
})
