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
    id: `user-${role}`,
    phone: '9000000001',
    full_name: 'Demo',
    memberships: [
      { org_id: 'org-1', organization_name: 'Demo PGs', role, assigned_property_ids: [] as string[] },
    ],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const PROPS = [
  { id: 'prop-1', org_id: 'org-1', name: 'Sunrise HSR', locality: 'HSR', upi_vpa: 'a@b', is_active: true },
  { id: 'prop-2', org_id: 'org-1', name: 'Lakeview BTM', locality: 'BTM', upi_vpa: 'a@b', is_active: true },
]

const DASHBOARD = {
  pnl: [
    {
      property_id: 'prop-1',
      property_name: 'Sunrise HSR',
      collected_verified_paise: 1000000,
      collected_cash_paise: 250000,
      provisional_paise: 300000,
      flagged_paise: 50000,
      expenses_paise: 400000,
      net_paise: 850000,
    },
    {
      property_id: 'prop-2',
      property_name: 'Lakeview BTM',
      collected_verified_paise: 500000,
      collected_cash_paise: 0,
      provisional_paise: 0,
      flagged_paise: 0,
      expenses_paise: 700000,
      net_paise: -200000,
    },
  ],
  occupancy: [
    { property_id: 'prop-1', name: 'Sunrise HSR', beds_total: 10, vacant: 2, reserved: 1, occupied: 6, on_notice: 1 },
    { property_id: 'prop-2', name: 'Lakeview BTM', beds_total: 8, vacant: 3, reserved: 0, occupied: 4, on_notice: 1 },
  ],
  attention: {
    pending_onboarding: 3,
    pending_discounts: 2,
    flagged_expenses_unreviewed: 4,
    provisional_payments_older_than_3_days: 5,
    flagged_payments: 1,
    cash_in_hand_total_paise: 1250000,
    overstaying_residents: 0,
  },
}

function mockApi(calls: string[] = [], dashboard: unknown = DASHBOARD) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = (input as Request).url
    if (url.includes('/api/v1/dashboard')) {
      calls.push(url)
      return jsonResponse(dashboard)
    }
    if (url.endsWith('/api/v1/properties')) return jsonResponse(PROPS)
    if (url.includes('/bed-board')) return jsonResponse({ rooms: [] })
    if (url.includes('/discount-requests')) return jsonResponse([])
    if (url.includes('/api/v1/dues')) return jsonResponse([])
    return jsonResponse({})
  })
}

function renderAt(path: string, role: 'owner' | 'caretaker' = 'owner') {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'test-jwt')
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

describe('FE-43 Owner dashboard', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-43/AC1] Dashboard numbers equal the API response', async () => {
    mockApi()
    renderAt('/owner')

    const pnl = await screen.findByLabelText('Profit and loss')
    const rows = await within(pnl).findAllByTestId('pnl-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Sunrise HSR')
    expect(rows[0]).toHaveTextContent('₹8,500') // net
    expect(rows[0]).toHaveTextContent('₹10,000') // verified
    expect(rows[0]).toHaveTextContent('₹2,500') // cash
    expect(rows[0]).toHaveTextContent('₹3,000') // provisional
    expect(rows[0]).toHaveTextContent('₹500') // flagged
    expect(rows[0]).toHaveTextContent('₹4,000') // expenses
    expect(rows[1]).toHaveTextContent('-₹2,000')

    // Totals across properties: collected 10000+2500+5000 = 17,500; expenses 11,000; net 6,500
    const money = screen.getByLabelText('Money')
    expect(within(money).getByText('Collected').parentElement).toHaveTextContent('₹17,500')
    expect(within(money).getByText('Expenses').parentElement).toHaveTextContent('₹11,000')
    expect(within(money).getByText('Net profit').parentElement).toHaveTextContent('₹6,500')

    // Occupancy comes from the dashboard: occupied + on notice over total, vacant count.
    const occ = screen.getByRole('heading', { name: 'Occupancy' }).closest('[data-slot="card"]') as HTMLElement
    const sunrise = await within(occ).findByRole('link', { name: /Sunrise HSR/ })
    expect(within(sunrise).getByText('7/10')).toBeInTheDocument()
    expect(within(sunrise).getByText('2 vacant')).toBeInTheDocument()
  })

  test('[FE-43/AC1] Period switcher requests this month, last month and a custom range', async () => {
    const calls: string[] = []
    mockApi(calls)
    renderAt('/owner')
    await screen.findByLabelText('Profit and loss')
    const first = new URL(calls[0])
    expect(first.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-01$/)
    expect(first.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const group = screen.getByRole('group', { name: 'Period' })
    fireEvent.click(within(group).getByRole('button', { name: 'Last month' }))
    await waitFor(() => expect(calls.length).toBe(2))
    expect(new URL(calls[1]).searchParams.get('from')).not.toBe(first.searchParams.get('from'))

    fireEvent.click(within(group).getByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-10' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-20' } })
    await waitFor(() => {
      const last = new URL(calls[calls.length - 1])
      expect(last.searchParams.get('from')).toBe('2026-09-10')
      expect(last.searchParams.get('to')).toBe('2026-09-20')
    })
  })

  test('[FE-43/AC2] Each Needs attention row shows the API count and links to its list', async () => {
    mockApi()
    renderAt('/owner')
    const card = await screen.findByLabelText('Needs attention')
    const expected: [string, string, string][] = [
      ['attention-onboarding', '3', '/owner/check-ins'],
      ['attention-discounts', '2', '/owner/approvals'],
      ['attention-expenses', '4', '/owner/expenses?flagged=true'],
      ['attention-provisional', '5', '/owner/reconcile?older_than_days=3'],
      ['attention-payments', '1', '/owner/payments?status=flagged'],
      ['attention-cash', '₹12,500', '/owner/money/cash'],
    ]
    for (const [id, text, href] of expected) {
      const row = within(card).getByTestId(id)
      expect(row).toHaveTextContent(text)
      expect(row).toHaveAttribute('href', href)
    }
    // A zero count is not listed.
    expect(within(card).queryByTestId('attention-overstaying')).toBeNull()
  })

  test('[FE-43/AC3] Caretakers are sent away from the owner dashboard and never request it', async () => {
    const calls: string[] = []
    mockApi(calls)
    renderAt('/owner', 'caretaker')
    await waitFor(() => expect(screen.queryByLabelText('Profit and loss')).toBeNull())
    expect(screen.queryByLabelText('Needs attention')).toBeNull()
    expect(calls).toHaveLength(0)
  })
})
