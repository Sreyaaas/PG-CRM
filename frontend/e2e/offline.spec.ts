import { expect, test, type Page } from '@playwright/test'

// Needs no API: the login screen is part of the cached app shell.
async function controlledByServiceWorker(page: Page) {
  await page.goto('/login')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload() // the first load is not controlled; after a reload the worker serves the shell
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
}

test('[FE-51/AC3] the app shell loads offline with the "You\'re offline" banner', async ({ page, context }) => {
  await controlledByServiceWorker(page)
  await expect(page.getByText("You're offline")).toBeHidden()

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByText("You're offline")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByText("You're offline")).toBeHidden()
})

test('[FE-51/AC4] public API responses and KYC-style images never end up in Cache Storage', async ({ page }) => {
  await page.route('**/api/v1/public/**', (route) =>
    route.fulfill({ json: { property_name: 'Demo PG' }, headers: { 'Cache-Control': 'max-age=3600' } }),
  )
  await page.route('**/kyc_id/**', (route) =>
    route.fulfill({ body: 'jpegbytes', contentType: 'image/jpeg', headers: { 'Cache-Control': 'max-age=3600' } }),
  )
  await controlledByServiceWorker(page)

  await page.evaluate(async () => {
    await fetch('/api/v1/public/join/demo-slug')
    await fetch('/files/kyc_id/front.jpg')
  })

  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const req of await cache.keys()) urls.push(req.url)
    }
    return urls
  })
  expect(cached.length).toBeGreaterThan(0) // the app shell itself is cached
  expect(cached.filter((u) => /\/api\/|\/public\/|kyc|\.(jpe?g|webp|pdf)/i.test(u))).toEqual([])
})
