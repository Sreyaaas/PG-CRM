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

async function session(page: Page) {
  return page.evaluate(() => ({
    token: localStorage.getItem('pgcrm_access_token'),
    orgId: localStorage.getItem('pgcrm_org_id'),
  }))
}

function inr(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 ? 2 : 0,
    maximumFractionDigits: paise % 100 ? 2 : 0,
  }).format(paise / 100)
}

test.describe('Owner dashboard, end to end', () => {
  test('[FE-43/AC1] owner dashboard shows the API P&L, occupancy and attention numbers', async ({ page }) => {
    await login(page, '9000000001')
    await expect(page).toHaveURL(/\/owner$/)
    const s = await session(page)
    const res = await page.request.get(`${API}/dashboard`, {
      headers: { Authorization: `Bearer ${s.token}`, 'X-Org-Id': s.orgId ?? '' },
    })
    expect(res.ok()).toBeTruthy()
    const data = (await res.json()) as {
      pnl: { property_name: string; net_paise: number; expenses_paise: number }[]
      attention: { pending_onboarding: number; cash_in_hand_total_paise: number }
    }

    const rows = page.getByTestId('pnl-row')
    await expect(rows).toHaveCount(data.pnl.length)
    for (const [i, p] of data.pnl.entries()) {
      await expect(rows.nth(i)).toContainText(p.property_name)
      await expect(rows.nth(i)).toContainText(inr(p.net_paise))
      await expect(rows.nth(i)).toContainText(inr(p.expenses_paise))
    }
    if (data.attention.pending_onboarding > 0) {
      await expect(page.getByTestId('attention-onboarding')).toContainText(String(data.attention.pending_onboarding))
    }
    if (data.attention.cash_in_hand_total_paise > 0) {
      await expect(page.getByTestId('attention-cash')).toContainText(inr(data.attention.cash_in_hand_total_paise))
    }
  })

  test('[FE-43/AC3] a caretaker cannot open the dashboard page or the API', async ({ page }) => {
    await login(page, '9000000002')
    await expect(page).toHaveURL(/\/caretaker$/)
    const s = await session(page)
    const res = await page.request.get(`${API}/dashboard`, {
      headers: { Authorization: `Bearer ${s.token}`, 'X-Org-Id': s.orgId ?? '' },
    })
    expect(res.status()).toBe(403)

    await page.goto('/owner')
    await expect(page).not.toHaveURL(/\/owner$/)
    await expect(page.getByTestId('pnl-row')).toHaveCount(0)
  })
})
