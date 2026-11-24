import { describe, expect, test, vi } from 'vitest'
import { ApiError, createApiClient } from './client'

describe('API client', () => {
  test('[FE-00/AC2] adds Authorization and X-Org-Id headers when present', async () => {
    let capturedHeaders: Headers | undefined
    const mockFetch: typeof fetch = vi.fn(async (input) => {
      const req = input instanceof Request ? input : new Request(input)
      capturedHeaders = req.headers
      return new Response(
        JSON.stringify({
          id: 'user-1',
          phone: '+919999999999',
          full_name: 'Owner',
          memberships: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    })

    const client = createApiClient({
      baseUrl: 'http://localhost:8000/api/v1',
      fetch: mockFetch,
      getToken: () => 'jwt-token-123',
      getOrgId: () => 'org-uuid-456',
    })

    await client.GET('/api/v1/me')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer jwt-token-123')
    expect(capturedHeaders?.get('X-Org-Id')).toBe('org-uuid-456')
  })

  test('[FE-00/AC2] omits Authorization and X-Org-Id headers when absent', async () => {
    let capturedHeaders: Headers | undefined
    const mockFetch: typeof fetch = vi.fn(async (input) => {
      const req = input instanceof Request ? input : new Request(input)
      capturedHeaders = req.headers
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const client = createApiClient({
      baseUrl: 'http://localhost:8000',
      fetch: mockFetch,
      getToken: () => null,
      getOrgId: () => null,
    })

    await client.GET('/health')

    expect(capturedHeaders?.has('Authorization')).toBe(false)
    expect(capturedHeaders?.has('X-Org-Id')).toBe(false)
  })

  test('[FE-00/AC2] turns non-2xx {error:{code,message}} responses into ApiError', async () => {
    const mockFetch: typeof fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'duplicate_utr',
            message: 'This UTR has already been used for another payment.',
          },
        }),
        {
          status: 409,
          statusText: 'Conflict',
          headers: { 'Content-Type': 'application/json' },
        },
      )
    })

    const client = createApiClient({
      baseUrl: 'http://localhost:8000/api/v1',
      fetch: mockFetch,
    })

    await expect(client.GET('/api/v1/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'duplicate_utr',
      message: 'This UTR has already been used for another payment.',
    })

    try {
      await client.GET('/api/v1/me')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
    }
  })

  test('[FE-00/AC2] turns non-JSON error responses into ApiError with status fallback', async () => {
    const mockFetch: typeof fetch = vi.fn(async () => {
      return new Response('Bad Gateway', {
        status: 502,
        statusText: 'Bad Gateway',
      })
    })

    const client = createApiClient({
      baseUrl: 'http://localhost:8000/api/v1',
      fetch: mockFetch,
    })

    await expect(client.GET('/api/v1/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
      code: 'http_error',
      message: 'Bad Gateway',
    })
  })
})
