import { describe, expect, test } from 'vitest'
import { pwaOptions } from './pwa-config'

describe('PWA service worker config', () => {
  test('[FE-00/AC3] service worker configuration enforces NetworkOnly for /api/* and never caches API routes', () => {
    const workbox = pwaOptions.workbox
    expect(workbox).toBeDefined()

    const denylist = workbox?.navigateFallbackDenylist ?? []
    expect(denylist.some((re) => re.test('/api/v1/properties'))).toBe(true)

    const runtimeCaching = workbox?.runtimeCaching ?? []
    const apiUrl = new URL('http://localhost:8000/api/v1/me')
    const apiRequest = new Request(apiUrl)

    const matchesEntry = (urlPattern: unknown): boolean => {
      if (typeof urlPattern === 'function') {
        return Boolean(
          urlPattern({
            url: apiUrl,
            request: apiRequest,
            sameOrigin: false,
          }),
        )
      }
      if (urlPattern instanceof RegExp) {
        return urlPattern.test(apiUrl.href) || urlPattern.test(apiUrl.pathname)
      }
      return false
    }

    const apiRule = runtimeCaching.find((entry) => matchesEntry(entry.urlPattern))
    expect(apiRule).toBeDefined()
    expect(apiRule?.handler).toBe('NetworkOnly')

    // Ensure no caching handler matches /api/*
    const cachingHandlers = runtimeCaching.filter((entry) => entry.handler !== 'NetworkOnly')
    for (const rule of cachingHandlers) {
      expect(matchesEntry(rule.urlPattern)).toBe(false)
    }
  })
})
