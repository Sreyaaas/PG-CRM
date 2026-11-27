import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider, useAuth } from '@/features/auth/AuthContext'
import { saveTokenResponse, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { pwaOptions } from '@/pwa-config'
import { isPersistableQuery, startCachePersist } from './cachePersist'
import { InstallBanner, OfflineStrip, OfflineSync } from './OfflineLayer'
import { backoffDelay, RetryQueue, type QueueTransport } from './retryQueue'
import { createMemoryStore, setOfflineStoreForTest, type OfflineStore } from './store'
import { retryQueue } from './transport'
import { UpdatePrompt } from './UpdatePrompt'

const USER = { userId: 'user-1', orgId: 'org-1' }

const TOKEN_RESPONSE = {
  access_token: 'jwt-1',
  token_type: 'bearer',
  expires_in: 43200,
  me: {
    id: USER.userId,
    phone: '9000000002',
    full_name: 'Care Taker',
    memberships: [
      { org_id: USER.orgId, organization_name: 'Demo PGs', role: 'caretaker', assigned_property_ids: ['prop-1'] },
    ],
  },
} as Parameters<typeof saveTokenResponse>[0]

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

/** Stands in for the backend: Idempotency-Key replays the stored response instead of inserting again. */
function createFakeServer() {
  const payments: { id: string; amount_paise: number }[] = []
  const byKey = new Map<string, { id: string; amount_paise: number }>()
  const requests: { path: string; key: string | null; body: unknown }[] = []
  let networkDown = false
  let dropResponseOnce = false
  return {
    payments,
    requests,
    setNetworkDown: (v: boolean) => {
      networkDown = v
    },
    /** The request reaches the server and is recorded, but the answer is lost on the way back. */
    dropNextResponse: () => {
      dropResponseOnce = true
    },
    fetch: vi.fn(async (input: Request | string) => {
      const request = input as Request
      if (networkDown) throw new TypeError('Failed to fetch')
      const key = request.headers.get('Idempotency-Key')
      const body = (await request.clone().json()) as { amount_paise: number }
      requests.push({ path: new URL(request.url).pathname, key, body })
      let row = key ? byKey.get(key) : undefined
      if (!row) {
        row = { id: `pay-${payments.length + 1}`, amount_paise: body.amount_paise }
        payments.push(row)
        if (key) byKey.set(key, row)
      }
      if (dropResponseOnce) {
        dropResponseOnce = false
        throw new TypeError('Failed to fetch')
      }
      return new Response(JSON.stringify(row), { status: 201, headers: { 'Content-Type': 'application/json' } })
    }),
  }
}

let store: OfflineStore
let server: ReturnType<typeof createFakeServer>

beforeEach(async () => {
  window.localStorage.clear()
  store = createMemoryStore()
  setOfflineStoreForTest(store)
  server = createFakeServer()
  vi.stubGlobal('fetch', server.fetch)
  setOnline(true)
  retryQueue.setContext(USER)
  await retryQueue.clear()
})

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  retryQueue.setContext(null)
  await retryQueue.clear()
  setOfflineStoreForTest(null)
})

const PAYMENT = { resident_id: 'res-1', amount_paise: 450000, method: 'cash' }

function wrapper(children: React.ReactNode, queryClient = new QueryClient()) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <AuthProvider>{children}</AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}

describe('retry queue', () => {
  test('[FE-51/AC1] offline cash payment shows "Pending sync (1)" and records exactly one payment once back online', async () => {
    saveTokenResponse(TOKEN_RESPONSE)
    render(
      wrapper(
        <>
          <OfflineSync />
          <OfflineStrip />
        </>,
      ),
    )

    // Wi-Fi drops: the caretaker logs a cash payment.
    setOnline(false)
    server.setNetworkDown(true)
    act(() => window.dispatchEvent(new Event('offline')))
    let result!: Awaited<ReturnType<typeof retryQueue.submit>>
    await act(async () => {
      result = await retryQueue.submit({ kind: 'payment', label: 'Cash payment, Room 12', body: PAYMENT })
    })

    expect(result.status).toBe('queued')
    expect(await screen.findByText('Pending sync (1)')).toBeInTheDocument()
    expect(screen.getByText(/You're offline/)).toBeInTheDocument()
    expect(server.payments).toHaveLength(0)

    // Wi-Fi returns: the 'online' event alone triggers the sync, nobody taps anything.
    setOnline(true)
    server.setNetworkDown(false)
    act(() => window.dispatchEvent(new Event('online')))

    await waitFor(() => expect(server.payments).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText(/Pending sync/)).not.toBeInTheDocument())
    expect(server.payments[0].amount_paise).toBe(450000)
    expect(server.requests[0].path).toBe('/api/v1/payments')
    expect(server.requests[0].key).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('[FE-51/AC1] a retry re-sends the original Idempotency-Key, so a lost response never records cash twice', async () => {
    // Worst case: the server saved the payment, but the answer never reached the phone.
    server.dropNextResponse()
    const first = await retryQueue.submit({ kind: 'payment', label: 'Cash payment', body: PAYMENT })
    expect(first.status).toBe('queued')
    expect(server.payments).toHaveLength(1)

    const synced = await retryQueue.flush({ force: true })

    expect(synced).toBe(1)
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1].key).toBe(server.requests[0].key)
    expect(server.payments).toHaveLength(1) // the server replayed the first response
    expect(retryQueue.getSnapshot()).toHaveLength(0)
  })

  test('[FE-51/AC1] repeated failed retries keep the same key and back off', async () => {
    server.setNetworkDown(true)
    const first = await retryQueue.submit({ kind: 'payment', label: 'Cash payment', body: PAYMENT })
    if (first.status !== 'queued') throw new Error('expected queued')
    const key = first.item.idempotencyKey

    await retryQueue.flush({ force: true })
    await retryQueue.flush({ force: true })
    const [item] = retryQueue.getSnapshot()
    expect(item.idempotencyKey).toBe(key)
    expect(item.attempts).toBe(3)
    expect(item.nextAttemptAt).toBeGreaterThan(Date.now())
    expect(backoffDelay(1)).toBeLessThan(backoffDelay(2))
    expect(backoffDelay(50)).toBe(60_000)

    // Not due yet: a normal (non-forced) flush leaves it alone.
    server.setNetworkDown(false)
    expect(await retryQueue.flush()).toBe(0)
    expect(server.payments).toHaveLength(0)
  })

  test('the queue survives a reload: items are read back from storage with their key', async () => {
    server.setNetworkDown(true)
    const first = await retryQueue.submit({ kind: 'payment', label: 'Cash payment', body: PAYMENT })
    if (first.status !== 'queued') throw new Error('expected queued')

    const fresh = new RetryQueue({ store: () => store, transport: { post: vi.fn(), uploadPhoto: vi.fn() } })
    fresh.setContext(USER)
    await fresh.load()
    expect(fresh.getSnapshot().map((i) => i.idempotencyKey)).toEqual([first.item.idempotencyKey])
  })

  test('a server rejection is shown as failed and is not retried; the user can discard it', async () => {
    const transport: QueueTransport = {
      post: vi.fn().mockRejectedValue(new (await import('@/api/client')).ApiError(422, 'invalid', 'UTR is required')),
      uploadPhoto: vi.fn(),
    }
    const queue = new RetryQueue({ store: () => store, transport, isOnline: () => true })
    queue.setContext(USER)
    await queue.load()
    // Seed as if an earlier attempt had been offline.
    const offlineQueue = new RetryQueue({ store: () => store, transport, isOnline: () => false })
    offlineQueue.setContext(USER)
    await offlineQueue.submit({ kind: 'payment', label: 'UPI payment', body: PAYMENT })
    await queue.load()

    await queue.flush({ force: true })
    const [item] = queue.getSnapshot()
    expect(item.status).toBe('failed')
    expect(item.error).toBe('UTR is required')
    await queue.flush({ force: true })
    expect(transport.post).toHaveBeenCalledTimes(1)

    await queue.cancel(item.id)
    expect(queue.getSnapshot()).toHaveLength(0)
  })

  test('an expense whose photo is not uploaded yet waits as "needs photo upload", then uploads first and keeps its key', async () => {
    const calls: string[] = []
    const transport: QueueTransport = {
      uploadPhoto: vi.fn(async () => {
        calls.push('upload')
        return 'org/org-1/prop-1/expense_proof/abc.jpg'
      }),
      post: vi.fn(async (_kind, body) => {
        calls.push(`post:${String(body.proof_path)}`)
      }),
    }
    let online = false
    const queue = new RetryQueue({ store: () => store, transport, isOnline: () => online })
    queue.setContext(USER)
    const res = await queue.submit({
      kind: 'expense',
      label: 'Water tanker',
      body: { property_id: 'prop-1', amount_paise: 90000 },
      photo: { blob: new Blob(['x'], { type: 'image/jpeg' }), contentType: 'image/jpeg', propertyId: 'prop-1' },
    })
    if (res.status !== 'queued') throw new Error('expected queued')
    expect(res.item.status).toBe('needs_photo_upload')
    expect(calls).toEqual([])

    online = true
    await queue.flush({ force: true })
    expect(calls).toEqual(['upload', 'post:org/org-1/prop-1/expense_proof/abc.jpg'])
    expect(vi.mocked(transport.post).mock.calls[0][2]).toBe(res.item.idempotencyKey)
    expect(queue.getSnapshot()).toHaveLength(0)
  })
})

describe('logout', () => {
  function LogoutButton() {
    const { logout } = useAuth()
    return (
      <button type="button" onClick={logout}>
        Log out
      </button>
    )
  }

  test('[FE-51/AC2] logout with queued writes warns first; confirming clears cached data, the queue and the session', async () => {
    saveTokenResponse(TOKEN_RESPONSE)
    const queryClient = new QueryClient()
    queryClient.setQueryData(['properties', USER.orgId], [{ id: 'prop-1' }])
    const stop = startCachePersist(queryClient, USER.userId, store, 0)
    queryClient.setQueryData(['staff', USER.orgId], [{ id: 'u-9' }])
    await waitFor(async () => expect(await store.get('meta', 'query-cache')).toBeDefined())
    stop()

    server.setNetworkDown(true)
    await retryQueue.submit({ kind: 'payment', label: 'Cash payment', body: PAYMENT })
    expect(await store.getAll('queue')).toHaveLength(1)

    render(wrapper(<LogoutButton />, queryClient))
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    // Warned first: nothing has been cleared yet.
    expect(await screen.findByText('Entries not synced yet')).toBeInTheDocument()
    expect(screen.getByText(/1 entry is still waiting to sync/)).toBeInTheDocument()
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-1')
    expect(await store.getAll('queue')).toHaveLength(1)

    // "Stay signed in" keeps everything.
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))
    await waitFor(() => expect(screen.queryByText('Entries not synced yet')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-1')
    expect(retryQueue.getSnapshot()).toHaveLength(1)

    // Confirm: everything goes.
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Log out and discard' }))
    await waitFor(() => expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull())
    await waitFor(async () => expect(await store.getAll('queue')).toHaveLength(0))
    expect(await store.get('meta', 'query-cache')).toBeUndefined()
    expect(retryQueue.getSnapshot()).toHaveLength(0)
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  test('[FE-51/AC2] logout with an empty queue is immediate and still wipes the persisted cache', async () => {
    saveTokenResponse(TOKEN_RESPONSE)
    await store.put('meta', 'query-cache', { userId: USER.userId, savedAt: Date.now(), state: { queries: [], mutations: [] } })

    render(wrapper(<LogoutButton />))
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    expect(screen.queryByText('Entries not synced yet')).not.toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull())
    await waitFor(async () => expect(await store.get('meta', 'query-cache')).toBeUndefined())
  })
})

describe('offline banner', () => {
  test('[FE-51/AC3] the offline banner appears when the connection drops and disappears when it returns', async () => {
    setOnline(false)
    render(wrapper(<OfflineStrip />))
    expect(screen.getByText(/You're offline/)).toBeInTheDocument()

    setOnline(true)
    act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument())
  })
})

describe('never cached offline', () => {
  const rules = pwaOptions.workbox?.runtimeCaching ?? []
  const matches = (href: string) => {
    const url = new URL(href)
    return rules.filter((r) => {
      const p = r.urlPattern
      return typeof p === 'function' ? Boolean(p({ url, request: new Request(url), sameOrigin: false } as never)) : false
    })
  }

  test('[FE-51/AC4] public pages data and KYC images are only ever fetched from the network by the service worker', () => {
    const risky = [
      'http://localhost:8000/api/v1/public/join/abc-slug',
      'http://localhost:8000/api/v1/public/receipts/token-123',
      'https://storage.example.com/pgcrm/org/o1/p1/kyc_id/id-front.jpg?X-Amz-Signature=abc',
      'https://storage.example.com/pgcrm/onboarding/p1/selfie.webp',
    ]
    for (const href of risky) {
      const hit = matches(href)
      expect(hit.length, href).toBeGreaterThan(0)
      expect(hit.every((r) => r.handler === 'NetworkOnly'), href).toBe(true)
    }
    // The precache only holds the built app shell, never images from users or documents.
    const globs = pwaOptions.workbox?.globPatterns ?? []
    expect(globs.join(',')).not.toMatch(/jpe?g|webp|pdf|json/)
  })

  test('[FE-51/AC4] the offline data cache skips public and KYC data', async () => {
    expect(isPersistableQuery(['properties', 'org-1'])).toBe(true)
    expect(isPersistableQuery(['bed-board', 'org-1', 'p1'])).toBe(true)
    expect(isPersistableQuery(['public-join', 'slug'])).toBe(false)
    expect(isPersistableQuery(['resident', 'org-1', 'r1'])).toBe(false)
    expect(isPersistableQuery(['onboarding-requests', 'org-1', 'detail', 'req-1', null, null])).toBe(false)

    const queryClient = new QueryClient()
    const stop = startCachePersist(queryClient, USER.userId, store, 0)
    queryClient.setQueryData(['public-join', 'slug'], { property_name: 'x' })
    queryClient.setQueryData(['resident', 'org-1', 'r1'], { id_photo_url: 'https://signed' })
    queryClient.setQueryData(['properties', 'org-1'], [{ id: 'p1' }])
    await waitFor(async () => expect(await store.get('meta', 'query-cache')).toBeDefined())
    stop()
    const saved = await store.get<{ state: { queries: { queryKey: unknown[] }[] } }>('meta', 'query-cache')
    expect(saved?.state.queries.map((q) => q.queryKey[0])).toEqual(['properties'])
  })
})

describe('install and update prompts', () => {
  test('the custom install prompt shows for signed-in staff once the browser offers it, and dismissing hides it for good', async () => {
    saveTokenResponse(TOKEN_RESPONSE)
    const prompt = vi.fn().mockResolvedValue(undefined)
    const { unmount } = render(wrapper(<InstallBanner />))
    expect(screen.queryByText(/Install NivasOS/)).not.toBeInTheDocument()

    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
    })
    act(() => window.dispatchEvent(event))
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))
    expect(prompt).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install prompt' }))
    expect(screen.queryByText(/Install NivasOS/)).not.toBeInTheDocument()
    unmount()
    render(wrapper(<InstallBanner />))
    expect(screen.queryByText(/Install NivasOS/)).not.toBeInTheDocument()
  })

  test('the update toast offers "Reload to update"', () => {
    const onReload = vi.fn()
    render(<UpdatePrompt onReload={onReload} onDismiss={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    expect(onReload).toHaveBeenCalled()
  })
})
