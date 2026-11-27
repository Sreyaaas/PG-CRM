import { expect, test } from '@playwright/test'

test('unauthenticated root redirects to /login with numeric phone keypad', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in to NivasOS' })).toBeVisible()
  await expect(page.getByLabel('Mobile number')).toHaveAttribute('inputmode', 'numeric')

  await page.getByRole('link', { name: 'Create organization' }).click()
  await expect(page).toHaveURL(/\/signup$/)
  await expect(page.getByRole('heading', { name: 'Create PG-CRM account' })).toBeVisible()
})
