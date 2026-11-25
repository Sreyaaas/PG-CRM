import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { createMemoryStore, setOfflineStoreForTest } from '@/offline/store'
import { retryQueue } from '@/offline/transport'
import { AppRouter } from '@/routes/AppRouter'

const ME = {
  id: 'user-ravi',
  phone: '9000000002',
  full_name: 'Ravi Kumar',
  memberships: [{ org_id: 'org-1', organization_name: 'Demo PGs', role: 'caretaker', assigned_property_ids: [] }],
}

const DUES = [
  {
    resident_id: 'res-1',
    full_name: 'Asha Rao',
    phone: '9111111111',
    bed_label: 'A-101',
    outstanding_paise: 1250050,
    oldest_due_date: '2026-11-05',
    days_overdue: 12,
    whatsapp_url: 'https://wa.me/919111111111?text=due',
  },
]

const LEDGER = {
  resident_id: 'res-1',
  full_name: 'Asha Rao',
  outstanding_paise: 1250050,
  whatsapp_url: null,
  entries: [
    {
      entry_date: '2026-11-05',
      type: 'invoice',
      id: 'inv-1',
      reference: 'INV-0001',
      description: 'Rent for Nov 2026',
      amount_paise: 1250050,
      voided: false,
      balance_paise: 1250050,
    },
  ],
}

function payment(over: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    property_id: 'prop-1',
    resident_id: 'res-1',
    resident_name: 'Asha Rao',
    invoice_id: null,
    amount_paise: 1250050,
    method: 'cash',
    utr_number: null,
    status: 'recorded',
    received_by: 'user-ravi',
    received_by_name: 'Ravi Kumar',
    received_at: '2026-11-25T05:00:00Z',
    notes: null,
    verified_at: null,
    flag_reason: null,
    voided_at: null,
    void_reason: null,
    public_token: 'tok',
    receipt_url: 'https://app.example/receipt/tok',
    whatsapp_url: 'https://wa.me/919111111111?text=receipt',
    ...over,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface Posted {
  key: string | null
  body: Record<string, unknown>
}

/** `replies` are consumed one per POST /payments; a function result throws, simulating a network failure. */
function mockApi(posts: Posted[], replies: (() => Response)[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const req = input as Request
    if (req.url.includes('/payments') && req.method === 'POST') {
      posts.push({ key: req.headers.get('Idempotency-Key'), body: (await req.clone().json()) as Posted['body'] })
      const next = replies.shift()
      if (!next) throw new Error('no reply queued')
      return next()
    }
    if (req.url.includes('/ledger')) return json(LEDGER)
    if (req.url.includes('/dues')) return json(DUES)
    if (req.url.includes('/properties')) return json([])
    return json({})
  })
}

function renderDues() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/caretaker/payments']}>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function openSheet() {
  fireEvent.click(await screen.findByRole('button', { name: 'Log payment for Asha Rao' }))
  return screen.findByRole('dialog', { name: 'Log payment' })
}

function submitBtn() {
  const dialog = screen.getByRole('dialog')
  const buttons = Array.from(dialog.querySelectorAll('button[type="submit"]'))
  return buttons[0] as HTMLButtonElement
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt')
  window.localStorage.setItem('pgcrm_me', JSON.stringify(ME))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
})

describe('Log payment sheet', () => {
  test('[FE-31/AC1] a cash payment shows the Cash badge and a WhatsApp share link from the API', async () => {
    const posts: Posted[] = []
    mockApi(posts, [() => json(payment(), 201)])
    renderDues()

    const dialog = await openSheet()
    expect(dialog.querySelector<HTMLInputElement>('#pay-amount')!.value).toBe('12500.50')
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument()
    fireEvent.click(submitBtn())

    expect(await screen.findByText('Payment logged')).toBeInTheDocument()
    expect(screen.getByText('Cash', { selector: 'span.inline-flex' })).toBeInTheDocument()
    const share = screen.getByRole('link', { name: /Share receipt on WhatsApp/ })
    expect(share.getAttribute('href')).toBe('https://wa.me/919111111111?text=receipt')
    expect(share.getAttribute('target')).toBe('_blank')
    expect(screen.getByRole('button', { name: 'Copy receipt link' })).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toMatchObject({
      resident_id: 'res-1',
      amount_paise: 1250050,
      method: 'cash',
      utr_number: null,
      invoice_id: null,
    })
    expect(posts[0].key).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('[FE-31/AC2] UPI with a 12-digit UTR shows the Provisional badge', async () => {
    const posts: Posted[] = []
    mockApi(posts, [
      () => json(payment({ method: 'upi', utr_number: '123456789012', status: 'provisional' }), 201),
    ])
    renderDues()

    const dialog = await openSheet()
    fireEvent.click(screen.getByRole('button', { name: 'UPI' }))
    fireEvent.change(dialog.querySelector('#pay-utr')!, { target: { value: '123456789012' } })
    fireEvent.click(submitBtn())

    expect(await screen.findByText('Payment logged')).toBeInTheDocument()
    expect(screen.getByText('Provisional')).toBeInTheDocument()
    expect(screen.getByText('1234 5678 9012')).toBeInTheDocument()
    expect(posts[0].body).toMatchObject({ method: 'upi', utr_number: '123456789012' })
  })

  test('[FE-31/AC3] the UTR field takes digits only, strips spaces, and blocks submit until 12 digits', async () => {
    const posts: Posted[] = []
    mockApi(posts, [])
    renderDues()

    const dialog = await openSheet()
    fireEvent.click(screen.getByRole('button', { name: 'UPI' }))
    const utr = dialog.querySelector<HTMLInputElement>('#pay-utr')!
    expect(utr.inputMode).toBe('numeric')
    expect(submitBtn().disabled).toBe(true)

    fireEvent.change(utr, { target: { value: '12ab 34-5' } })
    expect(utr.value).toBe('1234 5')
    expect(screen.getByTestId('utr-counter').textContent).toBe('5/12')
    expect(submitBtn().disabled).toBe(true)

    fireEvent.change(utr, { target: { value: '1234 5678 9012 3456' } })
    expect(utr.value).toBe('1234 5678 9012')
    expect(screen.getByTestId('utr-counter').textContent).toBe('12/12')
    expect(submitBtn().disabled).toBe(false)
    expect(posts).toHaveLength(0)
  })

  test('[FE-31/AC4] a duplicate UTR shows the API message inline', async () => {
    const posts: Posted[] = []
    const message = 'This UTR has already been used for another payment.'
    mockApi(posts, [() => json({ error: { code: 'duplicate_utr', message } }, 409)])
    renderDues()

    const dialog = await openSheet()
    fireEvent.click(screen.getByRole('button', { name: 'UPI' }))
    fireEvent.change(dialog.querySelector('#pay-utr')!, { target: { value: '123456789012' } })
    fireEvent.click(submitBtn())

    await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0))
    expect(screen.getByRole('dialog').textContent).toContain(message)
    expect(screen.queryByText('Payment logged')).not.toBeInTheDocument()
  })

  test('[FE-31/AC5] a retry after a network failure reuses the same Idempotency-Key', async () => {
    const posts: Posted[] = []
    mockApi(posts, [
      () => {
        throw new TypeError('Failed to fetch')
      },
      () => json(payment(), 201),
    ])
    renderDues()

    await openSheet()
    fireEvent.click(submitBtn())
    await waitFor(() => expect(posts).toHaveLength(1))
    await waitFor(() => expect(submitBtn().disabled).toBe(false))
    fireEvent.click(submitBtn())

    expect(await screen.findByText('Payment logged')).toBeInTheDocument()
    expect(posts).toHaveLength(2)
    expect(posts[0].key).toBeTruthy()
    expect(posts[1].key).toBe(posts[0].key)
  })

  test('[FE-31/AC5] a double tap sends one request while submitting', async () => {
    const posts: Posted[] = []
    mockApi(posts, [() => json(payment(), 201)])
    renderDues()

    await openSheet()
    const btn = submitBtn()
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(await screen.findByText('Payment logged')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
  })
  test('[FE-31/AC5] with no connection the payment is saved on the phone under the key already sent', async () => {
    const store = createMemoryStore()
    setOfflineStoreForTest(store)
    // In the app <OfflineSync> (App.tsx) sets this from the session; the router alone doesn't mount it.
    retryQueue.setContext({ userId: 'user-caretaker', orgId: 'org-1' })
    try {
      const posts: Posted[] = []
      const down = () => {
        throw new TypeError('Failed to fetch')
      }
      mockApi(posts, [down, down])
      renderDues()

      await openSheet()
      fireEvent.click(submitBtn())
      expect(await screen.findByText('Saved on this phone')).toBeInTheDocument()
      expect(screen.getByText(/will be sent automatically when the phone is back online/)).toBeInTheDocument()
      // The form's attempt and the queue's immediate retry both used one key, and that key is what's stored.
      expect(posts).toHaveLength(2)
      expect(posts[1].key).toBe(posts[0].key)
      const queued = (await store.getAll('queue')) as { idempotencyKey: string; kind: string; status: string }[]
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({ kind: 'payment', idempotencyKey: posts[0].key, status: 'pending' })
    } finally {
      retryQueue.setContext(null)
      setOfflineStoreForTest(null)
    }
  })
})
