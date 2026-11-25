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

interface Due {
  resident_id: string
  full_name: string
  days_overdue: number
  whatsapp_url: string
}

async function apiDues(page: Page): Promise<Due[]> {
  const session = await page.evaluate(() => ({
    token: localStorage.getItem('pgcrm_access_token'),
    orgId: localStorage.getItem('pgcrm_org_id'),
  }))
  const res = await page.request.get(`${API}/dues`, {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Org-Id': session.orgId ?? '' },
  })
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as Due[]
}

test.describe('Rent reminders, end to end', () => {
  test('[FE-33/AC1] Send reminder opens the whatsapp_url the API returned for that resident', async ({ page }) => {
    await login(page, '9000000001')
    await expect(page).toHaveURL(/\/owner$/)
    await page.goto('/owner/money')

    const dues = await apiDues(page)
    expect(dues.length).toBeGreaterThan(0)
    const first = dues[0]
    expect(first.whatsapp_url).toContain('wa.me')

    // Stub window.open so the test does not leave the app; record what the page asked to open.
    await page.evaluate(() => {
      const w = window as unknown as { __opened: string[] }
      w.__opened = []
      window.open = (url) => {
        w.__opened.push(String(url))
        return null
      }
    })
    await page.getByRole('button', { name: `Send reminder to ${first.full_name}` }).click()
    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
    expect(opened).toEqual([first.whatsapp_url])
  })
})
