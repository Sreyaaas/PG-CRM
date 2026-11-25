import { expect, test, type APIRequestContext } from '@playwright/test'

const API_BASE = 'http://127.0.0.1:8000/api/v1'

// 1x1 transparent PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

async function getSeededQrSlug(request: APIRequestContext): Promise<string> {
  const loginRes = await request.post(`${API_BASE}/auth/login`, {
    data: { phone: '9000000001', password: 'devpass123' },
  })
  expect(loginRes.ok()).toBeTruthy()
  const loginJson = (await loginRes.json()) as {
    access_token: string
    me: { memberships: Array<{ org_id: string }> }
  }
  const token = loginJson.access_token
  const orgId = loginJson.me.memberships[0].org_id

  const propsRes = await request.get(`${API_BASE}/properties`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': orgId },
  })
  expect(propsRes.ok()).toBeTruthy()
  const props = (await propsRes.json()) as Array<{ name: string; qr_slug: string }>
  const sunrise = props.find((p) => p.name.includes('Sunrise HSR')) ?? props[0]
  return sunrise.qr_slug
}

test('[FE-20/AC2] unknown slug shows inactive QR message against real API', async ({ page }) => {
  await page.goto('/join/non-existent-slug-99999')
  await expect(
    page.getByRole('heading', { name: 'This QR code is not active. Please ask the reception.' }),
  ).toBeVisible()
})

test('[FE-20/AC1,AC4,AC5,AC6] onboarding flow loads charges, notice rule, selfie capture, foreign national, and persists across reload against real API', async ({
  page,
  request,
}) => {
  const slug = await getSeededQrSlug(request)
  const uniquePhone = `9${Date.now().toString().slice(-9)}`
  let minioAvailable = true

  // Try real MinIO PUT first (succeeds in CI); if MinIO is not running locally, fulfill 200
  await page.route(/^https?:\/\/(localhost|127\.0\.0\.1):9000\//, async (route) => {
    try {
      const response = await route.fetch()
      if (response.status() >= 400) {
        minioAvailable = false
        await route.fulfill({ status: 200 })
      } else {
        await route.fulfill({ response })
      }
    } catch {
      minioAvailable = false
      await route.fulfill({ status: 200 })
    }
  })

  await page.goto(`/join/${slug}`)
  await expect(page.getByRole('heading', { name: /Sunrise HSR/ })).toBeVisible()

  // Step 1: About you
  await page.getByLabel(/Full name/).fill('Kiran Kumar')
  await page.getByLabel(/Mobile number/).fill(uniquePhone)
  await page.getByLabel(/Permanent address/).fill('22 BTM Layout, Bengaluru')

  // AC6: reload preserves entered data
  await page.reload()
  await expect(page.getByLabel(/Full name/)).toHaveValue('Kiran Kumar')
  await expect(page.getByLabel(/Mobile number/)).toHaveValue(uniquePhone)

  await page.getByRole('button', { name: 'Next' }).click()

  // Step 2: Emergency contact
  await page.getByLabel(/Emergency contact name/).fill('Ramesh Kumar')
  await page.getByLabel(/Emergency contact phone/).fill('9876543210')
  await page.getByRole('button', { name: 'Next' }).click()

  // Step 3: ID & selfie
  await page.getByLabel(/ID number/).fill('ABCDE1234F')

  // AC4: selfie input has capture="user"
  await expect(page.locator('#join-selfie')).toHaveAttribute('capture', 'user')

  // AC5: Foreign national toggle
  await page.getByLabel(/Foreign national\?/).check()
  await expect(page.getByLabel(/Passport number/)).toBeVisible()
  await expect(page.getByLabel(/Visa number/)).toBeVisible()
  await expect(page.getByLabel(/Visa expiry/)).toBeVisible()
  await page.getByLabel(/Foreign national\?/).uncheck()

  await page.locator('#join-id-photo').setInputFiles({
    name: 'id.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  })
  await expect(page.getByText(/ID photo uploaded/)).toBeVisible()

  await page.locator('#join-selfie').setInputFiles({
    name: 'selfie.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  })
  await expect(page.getByText(/Live selfie uploaded/)).toBeVisible()

  await page.getByRole('button', { name: 'Next' }).click()

  // AC1: official charges & notice rule
  await expect(page.getByText(/Security deposit \(refundable\)/)).toBeVisible()
  await expect(page.getByText(/Rent is due by the \d+(st|nd|rd|th) of every month/)).toBeVisible()
  await expect(
    page.getByText(/To leave at the end of a month, tell us on or before the \d+(st|nd|rd|th)/),
  ).toBeVisible()

  // Accept rules & submit when MinIO is available (e.g. CI)
  await page.getByLabel(/I accept the house rules and this exit deduction/).check()
  if (minioAvailable) {
    await page.getByRole('button', { name: 'Submit' }).click()
    await expect(
      page.getByRole('heading', { name: 'Done! Show this screen to the caretaker.' }),
    ).toBeVisible()
    await expect(page.getByTestId('request-id')).toHaveText(/^[0-9a-f-]{8}$/i)
  }
})
