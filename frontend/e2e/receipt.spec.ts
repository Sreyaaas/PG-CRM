import { expect, test, type APIRequestContext } from '@playwright/test'

// Runs against the real API with seed data (backend/scripts/seed_dev.py).
const API = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

/** The dues list carries a wa.me link whose text ends in the resident's public invoice link. */
async function seededInvoiceToken(request: APIRequestContext): Promise<string> {
  const login = await request.post(`${API}/auth/login`, {
    data: { phone: '9000000001', password: 'devpass123' },
  })
  expect(login.ok()).toBeTruthy()
  const body = (await login.json()) as { access_token: string; me: { memberships: { org_id: string }[] } }
  const res = await request.get(`${API}/dues`, {
    headers: { Authorization: `Bearer ${body.access_token}`, 'X-Org-Id': body.me.memberships[0].org_id },
  })
  expect(res.ok()).toBeTruthy()
  const dues = (await res.json()) as { whatsapp_url: string }[]
  for (const d of dues) {
    const m = decodeURIComponent(d.whatsapp_url).match(/\/receipt\/([0-9a-f]{64})/)
    if (m) return m[1]
  }
  throw new Error('No seeded due with a receipt link')
}

test('[FE-32/AC2,AC5] public invoice page shows the UPI QR and copy options with no login, noindex', async ({
  page,
  request,
}) => {
  const token = await seededInvoiceToken(request)
  const external: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) external.push(r.url())
  })

  await page.goto(`/receipt/${token}`)
  await expect(page).toHaveURL(new RegExp(`/receipt/${token}$`))
  await expect(page.getByText('Amount due')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download / Print' })).toBeVisible()
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1)
  // No app shell, no phone numbers.
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(/\b[6-9]\d{9}\b/)

  // The seed property has a UPI ID, so the dynamic QR (at least 240px) is present.
  const qr = page.getByRole('img', { name: 'UPI QR code for this invoice' })
  await expect(qr).toBeVisible()
  const box = await qr.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(240)
  await expect(page.getByRole('link', { name: 'Pay with UPI app' })).toHaveAttribute('href', /^upi:\/\//)
  await expect(page.getByRole('button', { name: 'Copy UPI ID' })).toBeVisible()
  expect(external).toEqual([])
})

test('[FE-32/AC4] unknown token shows the invalid or expired message against the real API', async ({ page }) => {
  await page.goto('/receipt/not-a-real-token')
  await expect(page.getByText('This link is invalid or expired.')).toBeVisible()
})
