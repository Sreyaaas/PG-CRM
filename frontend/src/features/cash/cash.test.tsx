import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { AppRouter } from '@/routes/AppRouter'

function me(role: 'owner' | 'caretaker') {
  return {
    id: role === 'owner' ? 'user-owner' : 'user-ravi',
    phone: '9000000001',
    full_name: role === 'owner' ? 'Demo Owner' : 'Ravi Kumar',
    memberships: [{ org_id: 'org-1', organization_name: 'Demo PGs', role, assigned_property_ids: [] }],
  }
}

interface Bal {
  user_id: string
  full_name: string
  collected_paise: number
  spent_paise: number
  handed_over_paise: number
  in_hand_paise: number
}

const RAVI: Bal = {
  user_id: 'user-ravi',
  full_name: 'Ravi Kumar',
  collected_paise: 1234550,
  spent_paise: 234500,
  handed_over_paise: 300000,
  in_hand_paise: 700050,
}
const SITA: Bal = {
  user_id: 'user-sita',
  full_name: 'Sita Devi',
  collected_paise: 900000,
  spent_paise: 0,
  handed_over_paise: 0,
  in_hand_paise: 900000,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function ledgerFor(b: Bal) {
  return {
    user_id: b.user_id,
    full_name: b.full_name,
    in_hand_paise: b.in_hand_paise,
    entries: [
      {
        entry_at: '2026-05-01T05:00:00Z',
        type: 'payment',
        id: 'p1',
        property_name: 'Sunrise HSR',
        description: 'Rent from Asha',
        notes: null,
        amount_paise: 1234550,
        voided: false,
        balance_paise: 1234550,
      },
      {
        entry_at: '2026-05-02T05:00:00Z',
        type: 'expense',
        id: 'e1',
        property_name: 'Sunrise HSR',
        description: 'Plumber',
        notes: null,
        amount_paise: -234500,
        voided: false,
        balance_paise: 1000050,
      },
    ],
  }
}

function mockApi(balances: Bal[], opts: { postError?: string } = {}) {
  const state = balances.map((b) => ({ ...b }))
  const posts: { body: Record<string, unknown>; key: string | null }[] = []
  const ledgerQueries: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const req = input as Request
    const url = new URL(req.url)
    if (url.pathname.endsWith('/cash/balances')) return json(state)
    if (url.pathname.endsWith('/cash/ledger')) {
      ledgerQueries.push(url.search)
      const id = url.searchParams.get('caretaker_user_id') ?? state[0].user_id
      return json(ledgerFor(state.find((b) => b.user_id === id)!))
    }
    if (url.pathname.endsWith('/cash/handovers') && req.method === 'POST') {
      const body = (await req.clone().json()) as Record<string, unknown>
      posts.push({ body, key: req.headers.get('Idempotency-Key') })
      if (opts.postError) return json({ error: { code: 'bad', message: opts.postError } }, 422)
      const b = state.find((s) => s.user_id === body.caretaker_user_id)!
      b.handed_over_paise += body.amount_paise as number
      b.in_hand_paise -= body.amount_paise as number
      return json(
        {
          id: 'h1',
          caretaker_user_id: b.user_id,
          caretaker_name: b.full_name,
          amount_paise: body.amount_paise,
          handed_over_at: '2026-05-03T05:00:00Z',
          recorded_by: 'user-owner',
          recorded_by_name: 'Demo Owner',
          notes: body.notes,
          in_hand_paise: b.in_hand_paise,
          warning: null,
        },
        201,
      )
    }
    return json({})
  })
  return { posts, ledgerQueries }
}

function renderAt(role: 'owner' | 'caretaker', path: string) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt')
  window.localStorage.setItem('pgcrm_me', JSON.stringify(me(role)))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('Cash in hand', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-41/AC1] caretaker sees the balance and breakdown exactly as the API returns it', async () => {
    const { ledgerQueries } = mockApi([RAVI])
    renderAt('caretaker', '/caretaker/cash')
    expect(await screen.findByText('Cash with you')).toBeInTheDocument()
    const main = screen.getByRole('main')
    // 700050 paise: shows the 50 paise rather than rounding
    expect(within(main).getByText('₹7,000.50')).toBeInTheDocument()
    const breakdown = within(main).getByRole('region', { name: 'Breakdown' })
    expect(breakdown).toHaveTextContent('Collected₹12,345.50')
    expect(breakdown).toHaveTextContent('Spent₹2,345')
    expect(breakdown).toHaveTextContent('Handed over₹3,000')
    expect(await within(main).findByText('Rent from Asha')).toBeInTheDocument()
    expect(within(main).getAllByTestId('ledger-entry')).toHaveLength(2)
    // own ledger: no caretaker_user_id sent
    expect(ledgerQueries[0]).toBe('')
  })

  test('[FE-41/AC1] a negative balance (owner overpaid) is shown as returned', async () => {
    mockApi([{ ...RAVI, in_hand_paise: -50000 }])
    renderAt('caretaker', '/caretaker/cash')
    expect(await screen.findByText('-₹500')).toBeInTheDocument()
  })

  test('[FE-41/AC3] caretakers have no handover button on their cash screen or in More', async () => {
    mockApi([RAVI])
    renderAt('caretaker', '/caretaker/cash')
    await screen.findByText('Cash with you')
    expect(screen.queryByRole('button', { name: /handover/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /handover/i })).not.toBeInTheDocument()
    cleanup()
    renderAt('caretaker', '/caretaker/more')
    expect(await screen.findByRole('link', { name: 'My cash' })).toBeInTheDocument()
  })

  test('owner list shows caretakers with the most cash first', async () => {
    mockApi([RAVI, SITA])
    renderAt('owner', '/owner/money/cash')
    const rows = await screen.findAllByTestId('caretaker-cash-row')
    expect(rows[0]).toHaveTextContent('Sita Devi')
    expect(rows[0]).toHaveTextContent('₹9,000')
    expect(rows[1]).toHaveTextContent('Ravi Kumar')
  })

  test('[FE-41/AC2] owner records a handover after a confirmation dialog and the balance drops', async () => {
    const { posts } = mockApi([RAVI, SITA])
    renderAt('owner', '/owner/money/cash/user-sita')
    fireEvent.click(await screen.findByRole('button', { name: 'Record handover' }))

    const dialog = await screen.findByRole('dialog')
    const amount = within(dialog).getByLabelText('Amount received') as HTMLInputElement
    expect(amount.value).toBe('9000') // pre-filled with cash in hand
    fireEvent.change(amount, { target: { value: '4000' } })
    fireEvent.change(within(dialog).getByLabelText('Notes (optional)'), { target: { value: 'Evening handover' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review' }))

    // nothing recorded until the owner confirms
    expect(await screen.findByText(/Confirm you received/)).toHaveTextContent(
      'Confirm you received ₹4,000 in cash from Sita Devi.',
    )
    expect(posts).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].body).toEqual({ caretaker_user_id: 'user-sita', amount_paise: 400000, notes: 'Evening handover' })
    expect(posts[0].key).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // the balance dropped from ₹9,000 to ₹5,000
    const tile = () => screen.getByText('Cash in hand', { selector: 'span' }).parentElement!
    await waitFor(() => expect(tile()).toHaveTextContent('₹5,000'))
    expect(tile()).not.toHaveTextContent('₹9,000')
  })

  test('[FE-41/AC2] a failed handover shows the API message and a retry reuses the Idempotency-Key', async () => {
    const { posts } = mockApi([SITA], { postError: 'Amount is too large' })
    renderAt('owner', '/owner/money/cash/user-sita')
    fireEvent.click(await screen.findByRole('button', { name: 'Record handover' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect((await screen.findAllByText('Amount is too large')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1].key).toBe(posts[0].key)
  })
})
