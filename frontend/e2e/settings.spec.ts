import { expect, test } from '@playwright/test'

test('[FE-05/AC3] Theme, density and corner choices apply immediately and survive a reload', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Mobile number').fill('9000000001')
  await page.getByLabel('Password').fill('devpass123')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/owner$/)

  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/owner\/settings$/)

  await page.getByRole('button', { name: 'Dark' }).click()
  await page.getByRole('button', { name: 'Compact' }).click()
  await page.getByRole('button', { name: 'Sharp' }).click()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact')
  await expect(page.locator('html')).toHaveAttribute('data-radius', 'sharp')

  await page.reload()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact')
  await expect(page.locator('html')).toHaveAttribute('data-radius', 'sharp')
})
