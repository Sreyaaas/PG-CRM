import { expect, test, type Page } from '@playwright/test'

// Runs against the real API with seed data (backend/scripts/seed_dev.py).
const API = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const OWNER_PHONE = '9000000001'
const PASSWORD = 'devpass123'

async function login(page: Page, phone: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function storedSession(page: Page) {
  return page.evaluate(() => ({
    token: localStorage.getItem('pgcrm_access_token'),
    orgId: localStorage.getItem('pgcrm_org_id'),
  }))
}

test.describe.serial('Staff, end to end', () => {
  const phone = `9${String(Date.now()).slice(-9)}`
  const name = `E2E Caretaker ${phone.slice(-4)}`
  const caretakerPassword = 'caretaker-pass-1'
  let caretaker: { token: string | null; orgId: string | null }

  test('[FE-12/AC1,AC2] caretaker added with one building appears in the list and sees only that building', async ({
    page,
  }) => {
    await login(page, OWNER_PHONE, PASSWORD)
    await expect(page).toHaveURL(/\/owner$/)

    await page.goto('/owner/staff')
    await page.getByRole('button', { name: 'Add caretaker' }).click()
    await page.getByLabel('Mobile number').fill(phone)
    await page.getByLabel('Full name').fill(name)
    await page.getByLabel('Initial password').fill(caretakerPassword)
    await page.getByLabel('Sunrise HSR').check()
    await page.getByRole('button', { name: 'Add caretaker' }).click()
    await expect(page.getByText(name)).toBeVisible()

    await page.getByRole('button', { name: 'Log out' }).click()
    await login(page, phone, caretakerPassword)
    await expect(page).toHaveURL(/\/caretaker$/)

    caretaker = await storedSession(page)
    const res = await page.request.get(`${API}/properties`, {
      headers: { Authorization: `Bearer ${caretaker.token}`, 'X-Org-Id': caretaker.orgId ?? '' },
    })
    expect(res.ok()).toBe(true)
    const names = ((await res.json()) as { name: string }[]).map((p) => p.name)
    expect(names).toEqual(['Sunrise HSR'])
  })

  test('[FE-12/AC3] deactivate asks for confirmation and the caretaker is refused afterwards', async ({ page }) => {
    await login(page, OWNER_PHONE, PASSWORD)
    await expect(page).toHaveURL(/\/owner$/)
    await page.goto('/owner/staff')

    await page.getByRole('button', { name: `Edit ${name}` }).click()
    await page.getByRole('button', { name: 'Deactivate', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Confirm deactivate' })
    await expect(dialog.getByText('They will lose access immediately.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Confirm deactivate' }).click()
    await expect(dialog).toBeHidden()

    const res = await page.request.get(`${API}/properties`, {
      headers: { Authorization: `Bearer ${caretaker.token}`, 'X-Org-Id': caretaker.orgId ?? '' },
    })
    expect([401, 403]).toContain(res.status())
  })
})
