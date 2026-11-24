import { expect, test, type Page } from '@playwright/test'

async function loginAndOpenRooms(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Mobile number').fill('9000000001')
  await page.getByLabel('Password').fill('devpass123')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/(owner|select-org)/)
  if (/select-org/.test(page.url())) {
    await page.getByRole('button').first().click()
    await page.waitForURL(/\/owner/)
  }
  await page.goto('/owner/properties')
  await page.getByRole('link', { name: /Sunrise HSR/ }).first().click()
  await page.getByRole('link', { name: 'Rooms & beds' }).click()
  await expect(page.getByRole('heading', { name: 'Rooms & beds' })).toBeVisible()
}

test('[FE-11/AC1,AC3] add a room against the real API, then a duplicate label shows the 409 on the field', async ({
  page,
}) => {
  await loginAndOpenRooms(page)
  const label = `T${Date.now().toString().slice(-7)}`

  await page.getByLabel('Room label').fill(label)
  await page.getByLabel('Rent per bed (₹)').fill('6000')
  await expect(page.getByTestId('room-preview')).toHaveText(
    `Creates 3 beds: ${label}-A, ${label}-B, ${label}-C at ₹6,000 each`,
  )
  await page.getByRole('button', { name: 'Add room' }).click()

  const room = page.getByRole('region', { name: `Room ${label}` })
  await expect(room).toBeVisible()
  await expect(room.getByText(`${label}-A`)).toBeVisible()
  await expect(room.getByText(`${label}-B`)).toBeVisible()
  await expect(room.getByText(`${label}-C`)).toBeVisible()

  await page.getByLabel('Room label').fill(label)
  await page.getByLabel('Rent per bed (₹)').fill('6000')
  await page.getByRole('button', { name: 'Add room' }).click()
  const field = page.locator('div', { has: page.getByLabel('Room label') }).filter({
    has: page.getByRole('alert'),
  })
  await expect(field.last().getByRole('alert')).toContainText(/already exists|exists|duplicate/i)
})
