import { expect, test } from '@playwright/test'

test('[FE-00/AC1] Home page shows "API: ok" when the backend is running', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('api-status')).toHaveText('API: ok')
})

test('[FE-00/AC3] Service worker never caches /api/* responses', async ({ page }) => {
  await page.goto('/')

  // Wait for service worker registration to become active
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    const reg = await navigator.serviceWorker.ready
    return Boolean(reg.active)
  })
  expect(swReady).toBe(true)

  // Verify the served sw.js configures NetworkOnly for /api/*
  const swScriptRes = await page.request.get('/sw.js')
  expect(swScriptRes.ok()).toBe(true)
  const swScriptText = await swScriptRes.text()
  expect(swScriptText).toContain('/api/')
  expect(swScriptText).toContain('NetworkOnly')

  // Issue requests to /api/* paths (same-origin and backend) and verify nothing is cached
  await page.evaluate(async () => {
    await fetch('http://localhost:8000/api/v1/me', {
      signal: AbortSignal.timeout(3000),
    }).catch(() => undefined)
    await fetch('/api/v1/me', {
      signal: AbortSignal.timeout(3000),
    }).catch(() => undefined)
  })

  const cachedApiUrls = await page.evaluate(async () => {
    const cacheNames = await caches.keys()
    const found: string[] = []
    for (const name of cacheNames) {
      const cache = await caches.open(name)
      const requests = await cache.keys()
      for (const req of requests) {
        if (new URL(req.url).pathname.startsWith('/api/')) {
          found.push(req.url)
        }
      }
    }
    return found
  })

  expect(cachedApiUrls).toEqual([])
})
