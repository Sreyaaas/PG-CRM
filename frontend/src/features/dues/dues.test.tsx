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
    memberships: [{ org_id: 'org-1', organization_name: 'Demo PGs', role, assigned_property_ids: [] }],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
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
  },
  {
    resident_id: 'res-2',
    full_name: 'Bala Kumar',
    phone: '9222222222',
    bed_label: 'B-204',
    outstanding_paise: 800000,
    oldest_due_date: '2026-12-05',
    days_overdue: 0,
  },
]

const LEDGER = {
  resident_id: 'res-1',
  full_name: 'Asha Rao',
  outstanding_paise: 600000,
  entries: [
    {
      entry_date: '2026-10-05',
      type: 'invoice',
      id: 'inv-1',
      reference: 'INV-0001',
      description: 'Rent for Oct 2026',
      amount_paise: 800000,
      voided: false,
      balance_paise: 800000,
    },
    {
      entry_date: '2026-10-07',
      type: 'payment',
      id: 'pay-1',
      reference: 'UPI 123456789012',
      description: 'Payment',
      amount_paise: -200000,
      voided: false,
      balance_paise: 600000,
    },
    {
      entry_date: '2026-10-08',
      type: 'payment',
      id: 'pay-2',
      reference: 'Cash',
      description: 'Payment',
      amount_paise: -50000,
      voided: true,
      balance_paise: 600000,
    },
  ],
}

interface State {
  dues: unknown[]
  generated: { body: unknown }[]
  generateResponse: { status: number; body: unknown }
}

function mockApi(state: State) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const req = input as Request
    const url = req.url
    if (url.includes('/invoices/generate-due') && req.method === 'POST') {
      state.generated.push({ body: await req.clone().json() })
      return jsonResponse(state.generateResponse.body, state.generateResponse.status)
    }
    if (url.includes('/ledger')) return jsonResponse(LEDGER)
    if (url.includes('/dues')) return jsonResponse(state.dues)
    if (url.includes('/properties')) return jsonResponse([])
    return jsonResponse({})
  })
}

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
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

function signIn(role: 'owner' | 'caretaker') {
  window.localStorage.clear()
  window.localStorage.setItem(TOKEN_STORAGE_KEY, `${role}-jwt`)
  window.localStorage.setItem('pgcrm_me', JSON.stringify(me(role)))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Dues list', () => {
  beforeEach(() => signIn('caretaker'))

  test('[FE-30/AC1] dues keep the API order and show its amounts and overdue text exactly', async () => {
    mockApi({ dues: DUES, generated: [], generateResponse: { status: 200, body: {} } })
    renderAt('/caretaker/payments')

    const rows = await screen.findAllByTestId('due-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Asha Rao')).toBeInTheDocument()
    expect(within(rows[0]).getByText('A-101')).toBeInTheDocument()
    expect(within(rows[0]).getByText('₹12,500.50')).toBeInTheDocument()
    expect(within(rows[0]).getByTestId('due-status').textContent).toBe('12 days overdue')
    expect(within(rows[1]).getByText('Bala Kumar')).toBeInTheDocument()
    expect(within(rows[1]).getByText('₹8,000')).toBeInTheDocument()
    expect(within(rows[1]).getByTestId('due-status').textContent).toBe('due by 05 Dec 2026')
    expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument()
  })
})

describe('Owner generate invoices', () => {
  beforeEach(() => signIn('owner'))

  test('[FE-30/AC3] Generate this month\'s invoices shows the created count', async () => {
    const state: State = {
      dues: DUES,
      generated: [],
      generateResponse: { status: 200, body: { month: '2026-11', created: 7 } },
    }
    mockApi(state)
    renderAt('/owner/money')

    fireEvent.click(await screen.findByRole('button', { name: "Generate this month's invoices" }))
    expect(await screen.findByText('Created 7 invoices')).toBeInTheDocument()
    expect(state.generated).toHaveLength(1)
    expect(state.generated[0].body).toEqual({})
  })

  test('[FE-30/AC3] a failed generate shows the API message', async () => {
    mockApi({
      dues: DUES,
      generated: [],
      generateResponse: { status: 403, body: { error: { code: 'forbidden', message: 'Owner only' } } },
    })
    renderAt('/owner/money')

    fireEvent.click(await screen.findByRole('button', { name: "Generate this month's invoices" }))
    await waitFor(() => expect(screen.getByText('Owner only')).toBeInTheDocument())
  })
})

describe('Resident ledger', () => {
  beforeEach(() => signIn('owner'))

  test('[FE-30/AC2] ledger shows the API running balance and strikes void rows', async () => {
    mockApi({ dues: [], generated: [], generateResponse: { status: 200, body: {} } })
    renderAt('/owner/residents/res-1/ledger')

    const rows = await screen.findAllByTestId('ledger-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByTestId('ledger-balance').textContent).toBe('Balance ₹8,000')
    expect(within(rows[1]).getByTestId('ledger-balance').textContent).toBe('Balance ₹6,000')
    expect(within(rows[1]).getByText('UPI 123456789012')).toBeInTheDocument()
    expect(rows[1].dataset.voided).toBe('false')
    expect(rows[2].dataset.voided).toBe('true')
    expect(within(rows[2]).getByText('Cash').className).toContain('line-through')
    expect(within(rows[2]).getByText('Void')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Payment', { selector: 'span.inline-flex' })).toBeInTheDocument()
  })
})
