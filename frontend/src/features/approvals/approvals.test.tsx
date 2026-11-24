import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { AppRouter } from '@/routes/AppRouter'

const OWNER_ME = {
  id: 'user-owner',
  phone: '9000000001',
  full_name: 'Demo Owner',
  memberships: [
    { org_id: 'org-1', organization_name: 'Demo PGs', role: 'owner', assigned_property_ids: [] },
  ],
}

function makeRequest(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `req-${n}`,
    status: 'pending',
    property_id: 'prop-1',
    property_name: 'Sunrise HSR',
    bed_id: `bed-${n}`,
    bed_label: `A-10${n}`,
    resident_id: null,
    resident_name: null,
    base_rent_paise: 800000,
    requested_rent_paise: 600000,
    difference_paise: 200000,
    reason: `Long stay discount ${n}`,
    requested_by: 'user-ct',
    requested_by_name: 'Ravi',
    created_at: '2026-11-20T09:30:00Z',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderApprovals() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/owner/approvals']}>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

interface Mock {
  pending: ReturnType<typeof makeRequest>[]
  decides: { url: string; body: unknown }[]
  decideStatus?: number
}

function mockApi(state: Mock) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const req = input as Request
    const url = req.url
    if (url.includes('/decide') && req.method === 'POST') {
      state.decides.push({ url, body: await req.clone().json() })
      if (state.decideStatus && state.decideStatus >= 400) {
        return jsonResponse(
          { error: { code: 'conflict', message: 'Already decided' } },
          state.decideStatus,
        )
      }
      const id = url.split('/discount-requests/')[1].split('/')[0]
      state.pending = state.pending.filter((r) => r.id !== id)
      return jsonResponse(makeRequest(0, { id, status: 'approved' }))
    }
    if (url.includes('/discount-requests') && req.method === 'GET') {
      expect(url).toContain('status=pending')
      return jsonResponse(state.pending)
    }
    return jsonResponse({})
  })
}

describe('Owner approvals inbox', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'owner-jwt')
    window.localStorage.setItem('pgcrm_me', JSON.stringify(OWNER_ME))
    window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-22/AC1] pending discounts show floor rent, requested rent and the difference', async () => {
    mockApi({ pending: [makeRequest(1)], decides: [] })
    renderApprovals()

    const card = await screen.findByTestId('discount-card')
    expect(within(card).getByText(/Sunrise HSR/)).toBeInTheDocument()
    expect(within(card).getByText('₹8,000')).toBeInTheDocument()
    expect(within(card).getByText('₹6,000')).toBeInTheDocument()
    expect(within(card).getByTestId('discount-diff').textContent).toBe('−₹2,000/month')
    expect(within(card).getByText('Long stay discount 1')).toBeInTheDocument()
    expect(within(card).getByText(/Ravi/)).toBeInTheDocument()
  })

  test('[FE-22/AC2] approve removes the card and posts the decision', async () => {
    const state: Mock = { pending: [makeRequest(1), makeRequest(2)], decides: [] }
    mockApi(state)
    renderApprovals()

    const cards = await screen.findAllByTestId('discount-card')
    expect(cards).toHaveLength(2)
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(screen.getAllByTestId('discount-card')).toHaveLength(1))
    expect(screen.queryByText('Long stay discount 1')).not.toBeInTheDocument()
    expect(state.decides).toHaveLength(1)
    expect(state.decides[0].url).toContain('/discount-requests/req-1/decide')
    expect(state.decides[0].body).toEqual({ decision: 'approved', note: null })
  })

  test('[FE-22/AC2] reject asks for an optional note, removes the card, and shows the API error on failure', async () => {
    const state: Mock = { pending: [makeRequest(1)], decides: [] }
    mockApi(state)
    renderApprovals()

    const card = await screen.findByTestId('discount-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }))
    fireEvent.change(screen.getByLabelText(/note \(optional\)/i), { target: { value: 'Too low' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm reject/i }))

    await waitFor(() => expect(screen.queryByTestId('discount-card')).not.toBeInTheDocument())
    expect(state.decides[0].body).toEqual({ decision: 'rejected', note: 'Too low' })
    expect(await screen.findByText('Nothing to approve.')).toBeInTheDocument()

    // API error surfaces its message
    cleanup()
    vi.restoreAllMocks()
    const failing: Mock = { pending: [makeRequest(3)], decides: [], decideStatus: 409 }
    mockApi(failing)
    renderApprovals()
    const c2 = await screen.findByTestId('discount-card')
    fireEvent.click(within(c2).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Already decided')).toBeInTheDocument()
  })

  test('[FE-22/AC3] Approvals badge equals the number of pending items', async () => {
    const state: Mock = { pending: [makeRequest(1), makeRequest(2), makeRequest(3)], decides: [] }
    mockApi(state)
    renderApprovals()

    await waitFor(() => {
      const badges = screen.getAllByTestId('nav-badge')
      expect(badges.length).toBeGreaterThan(0)
      badges.forEach((b) => expect(b.textContent).toBe('3'))
    })

    const cards = await screen.findAllByTestId('discount-card')
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      screen.getAllByTestId('nav-badge').forEach((b) => expect(b.textContent).toBe('2'))
    })
  })

  test('[FE-22/AC3] no badge when nothing is pending', async () => {
    mockApi({ pending: [], decides: [] })
    renderApprovals()
    expect(await screen.findByText('Nothing to approve.')).toBeInTheDocument()
    expect(screen.queryByTestId('nav-badge')).not.toBeInTheDocument()
  })
})
