import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { AppRouter } from '@/routes/AppRouter'

const CARETAKER_ME = {
  id: 'user-ct',
  phone: '9000000002',
  full_name: 'Raju Caretaker',
  memberships: [
    {
      org_id: 'org-1',
      organization_name: 'Demo PGs',
      role: 'caretaker',
      assigned_property_ids: ['prop-1'],
    },
  ],
}

function getTodayIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function makeSummary(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `req-${n}`,
    full_name: `Resident ${n}`,
    phone: `987654321${n}`,
    occupation: 'working',
    employer_or_college: `Acme Corp ${n}`,
    is_foreign_national: n === 1,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  }
}

function makeDetail(id = 'req-1', overrides: Record<string, unknown> = {}) {
  return {
    id,
    property_id: 'prop-1',
    property_name: 'Sunrise HSR',
    status: 'pending',
    full_name: 'Resident 1',
    phone: '9876543211',
    email: 'res1@example.com',
    date_of_birth: '1998-05-15',
    permanent_address: '12 MG Road, Bengaluru',
    occupation: 'working',
    employer_or_college: 'Acme Corp 1',
    emergency_contact_name: 'Parent 1',
    emergency_contact_phone: '9988776655',
    id_doc_type: 'aadhaar',
    id_doc_number: '123456789012',
    id_doc_path: 'onboarding/prop-1/id.jpg',
    selfie_path: 'onboarding/prop-1/selfie.jpg',
    id_doc_url: 'https://example.com/id.jpg',
    selfie_url: 'https://example.com/selfie.jpg',
    url_expires_in: 300,
    is_foreign_national: true,
    passport_number: 'P1234567',
    visa_number: 'V7654321',
    visa_expiry: '2027-01-01',
    accepted_rules: true,
    accepted_exit_deduction_paise: 150000,
    accepted_at: '2026-11-25T09:00:00Z',
    created_at: '2026-11-25T09:00:00Z',
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    suggested: {
      rent_paise: 1050000,
      deposit_paise: 1500000,
      maintenance_charge_paise: 100000,
      first_month_rent_paise: 455000,
    },
    ...overrides,
  }
}

function makeBoard(bed1Status: 'vacant' | 'occupied' = 'vacant') {
  return {
    rooms: [
      {
        id: 'room-1',
        label: '101',
        floor: 1,
        sharing: 2,
        is_ac: true,
        beds: [
          {
            id: 'bed-1',
            label: '101-A',
            status: bed1Status,
            base_rent_paise: 1050000,
            is_active: true,
            stay: null,
          },
          {
            id: 'bed-2',
            label: '101-B',
            status: 'occupied',
            base_rent_paise: 1050000,
            is_active: true,
            stay: {
              id: 'stay-2',
              stay_type: 'monthly',
              status: 'active',
              rent_paise: 1050000,
              check_in_date: '2026-10-01',
              expected_vacate_date: null,
              resident: { id: 'res-2', full_name: 'Existing Resident' },
            },
          },
        ],
      },
      {
        id: 'room-2',
        label: '102',
        floor: 1,
        sharing: 1,
        is_ac: false,
        beds: [
          {
            id: 'bed-3',
            label: '102-A',
            status: 'reserved',
            base_rent_paise: 1200000,
            is_active: true,
            stay: null,
          },
          {
            id: 'bed-4',
            label: '102-B',
            status: 'on_notice',
            base_rent_paise: 1200000,
            is_active: true,
            stay: null,
          },
          {
            id: 'bed-5',
            label: '102-C',
            status: 'vacant',
            base_rent_paise: 900000,
            is_active: false,
            stay: null,
          },
        ],
      },
    ],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderCheckins(initialPath = '/caretaker/check-ins') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

interface MockState {
  pending: ReturnType<typeof makeSummary>[]
  detail: ReturnType<typeof makeDetail>
  board: ReturnType<typeof makeBoard>
  discounts: Record<string, unknown>[]
  approvals: { url: string; body: unknown }[]
  discountCreates: unknown[]
  approveError?: { status: number; code: string; message: string }
  whatsappUrl?: string
}

function mockApi(state: MockState) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const req = input as Request
    const url = req.url

    if (url.includes('/onboarding-requests/req-1/approve') && req.method === 'POST') {
      const body = await req.clone().json()
      state.approvals.push({ url, body })
      if (state.approveError) {
        return jsonResponse(
          { error: { code: state.approveError.code, message: state.approveError.message } },
          state.approveError.status,
        )
      }
      state.pending = state.pending.filter((p) => p.id !== 'req-1')
      state.board = makeBoard('occupied')
      return jsonResponse({
        resident_id: 'res-new',
        stay_id: 'stay-new',
        invoice_ids: ['inv-1', 'inv-2', 'inv-3'],
        ...(state.whatsappUrl ? { whatsapp_url: state.whatsappUrl } : {}),
      })
    }

    if (url.includes('/onboarding-requests/req-1') && req.method === 'GET') {
      return jsonResponse(state.detail)
    }

    if (url.includes('/onboarding-requests') && req.method === 'GET') {
      return jsonResponse(state.pending)
    }

    if (url.includes('/bed-board') && req.method === 'GET') {
      return jsonResponse(state.board)
    }

    if (url.includes('/discount-requests') && req.method === 'POST') {
      const body = (await req.clone().json()) as {
        bed_id: string
        requested_rent_paise: number
        reason: string
      }
      state.discountCreates.push(body)
      const created = {
        id: 'disc-1',
        status: 'pending',
        property_id: 'prop-1',
        property_name: 'Sunrise HSR',
        bed_id: body.bed_id,
        bed_label: '101-A',
        resident_id: null,
        resident_name: null,
        base_rent_paise: 1050000,
        requested_rent_paise: body.requested_rent_paise,
        difference_paise: 1050000 - body.requested_rent_paise,
        reason: body.reason,
        requested_by: 'user-ct',
        requested_by_name: 'Raju Caretaker',
        created_at: new Date().toISOString(),
        decided_by: null,
        decided_at: null,
        decision_note: null,
      }
      state.discounts.push(created)
      return jsonResponse(created, 201)
    }

    if (url.includes('/discount-requests') && req.method === 'GET') {
      return jsonResponse(state.discounts)
    }

    return jsonResponse({})
  })
}

describe('FE-21 Caretaker check-in approval flow', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'ct-jwt')
    window.localStorage.setItem('pgcrm_me', JSON.stringify(CARETAKER_ME))
    window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-21/AC1] pending list shows submissions and the bottom nav badge count', async () => {
    mockApi({
      pending: [makeSummary(1), makeSummary(2)],
      detail: makeDetail(),
      board: makeBoard(),
      discounts: [],
      approvals: [],
      discountCreates: [],
    })
    renderCheckins()

    const cards = await screen.findAllByTestId('checkin-card')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('Resident 1')).toBeInTheDocument()
    expect(within(cards[0]).getByText('9876543211')).toBeInTheDocument()
    expect(within(cards[0]).getByText('Acme Corp 1')).toBeInTheDocument()
    expect(within(cards[0]).getByText('Foreign national')).toBeInTheDocument()
    expect(within(cards[0]).getByText('5m ago')).toBeInTheDocument()

    await waitFor(() => {
      const badges = screen.getAllByTestId('nav-badge')
      expect(badges[0].textContent).toBe('2')
    })

    cleanup()
    vi.restoreAllMocks()
    mockApi({
      pending: [],
      detail: makeDetail(),
      board: makeBoard(),
      discounts: [],
      approvals: [],
      discountCreates: [],
    })
    renderCheckins()
    expect(await screen.findByText('No pending check-ins.')).toBeInTheDocument()
    expect(screen.queryByTestId('nav-badge')).not.toBeInTheDocument()
  })

  test('[FE-21/AC3] bed picker offers only vacant active beds grouped by room', async () => {
    mockApi({
      pending: [makeSummary(1)],
      detail: makeDetail(),
      board: makeBoard(),
      discounts: [],
      approvals: [],
      discountCreates: [],
    })
    renderCheckins('/caretaker/check-ins/req-1')

    const approveBtn = await screen.findByRole('button', { name: 'Approve' })
    fireEvent.click(approveBtn)

    const select = await screen.findByLabelText('Vacant bed')
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: /101-A/ })).toBeInTheDocument()
    })

    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options.some((t) => t?.includes('101-A'))).toBe(true)
    expect(options.some((t) => t?.includes('101-B'))).toBe(false)
    expect(options.some((t) => t?.includes('102-A'))).toBe(false)
    expect(options.some((t) => t?.includes('102-B'))).toBe(false)
    expect(options.some((t) => t?.includes('102-C'))).toBe(false)
  })

  test('[FE-21/AC5] summary shows deposit + maintenance + pro-rata from API, or calculated on approval when date changes', async () => {
    mockApi({
      pending: [makeSummary(1)],
      detail: makeDetail(),
      board: makeBoard(),
      discounts: [],
      approvals: [],
      discountCreates: [],
    })
    renderCheckins('/caretaker/check-ins/req-1')

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const select = await screen.findByLabelText('Vacant bed')
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: /101-A/ })).toBeInTheDocument()
    })
    fireEvent.change(select, { target: { value: 'bed-1' } })

    const summary = screen.getByTestId('pays-today-summary')
    await waitFor(() => {
      expect(within(summary).getByText('₹15,000')).toBeInTheDocument()
      expect(within(summary).getByText('₹1,000')).toBeInTheDocument()
      expect(within(summary).getByTestId('prorata-amount').textContent).toBe('₹4,550')
      expect(within(summary).getByTestId('total-today').textContent).toBe('₹20,550')
    })

    // Changing check-in date from today switches pro-rata to "calculated on approval"
    const dateInput = screen.getByLabelText('Check-in date')
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    fireEvent.change(dateInput, { target: { value: tomorrow === getTodayIST() ? '2026-12-01' : tomorrow } })

    expect(within(summary).getByTestId('prorata-amount').textContent).toBe('calculated on approval')
    expect(within(summary).getByTestId('total-today').textContent).toBe('calculated on approval')
  })

  test('[FE-21/AC2] approving at floor price shows success, WhatsApp link, and bed becomes occupied', async () => {
    const state: MockState = {
      pending: [makeSummary(1)],
      detail: makeDetail(),
      board: makeBoard('vacant'),
      discounts: [],
      approvals: [],
      discountCreates: [],
      whatsappUrl: 'https://wa.me/919876543211?text=Welcome',
    }
    mockApi(state)
    renderCheckins('/caretaker/check-ins/req-1')

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const select = await screen.findByLabelText('Vacant bed')
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: /101-A/ })).toBeInTheDocument()
    })
    fireEvent.change(select, { target: { value: 'bed-1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }))

    const waLink = await screen.findByRole('link', { name: /Share welcome \/ deposit invoice on WhatsApp/i })
    expect(waLink).toHaveAttribute('href', 'https://wa.me/919876543211?text=Welcome')
    expect(state.approvals).toHaveLength(1)
    expect(state.approvals[0].body).toMatchObject({
      bed_id: 'bed-1',
      stay_type: 'monthly',
      rent_paise: 1050000,
      deposit_paise: 1500000,
      maintenance_charge_paise: 100000,
      discount_request_id: null,
    })
    expect(state.board.rooms[0].beds[0].status).toBe('occupied')
  })

  test('[FE-21/AC4] rent below floor swaps Approve for Request discount; after owner approves, approval works with discount_request_id', async () => {
    const state: MockState = {
      pending: [makeSummary(1)],
      detail: makeDetail(),
      board: makeBoard(),
      discounts: [],
      approvals: [],
      discountCreates: [],
    }
    mockApi(state)
    renderCheckins('/caretaker/check-ins/req-1')

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const select = await screen.findByLabelText('Vacant bed')
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: /101-A/ })).toBeInTheDocument()
    })
    fireEvent.change(select, { target: { value: 'bed-1' } })

    fireEvent.change(screen.getByLabelText('Monthly rent'), { target: { value: '9500' } })

    expect(screen.queryByRole('button', { name: 'Confirm approve' })).not.toBeInTheDocument()
    const reqBtn = screen.getByRole('button', { name: 'Request discount from owner' })
    fireEvent.change(screen.getByLabelText('Reason for discount'), { target: { value: '12-month stay' } })
    fireEvent.click(reqBtn)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Waiting for owner approval' })).toBeDisabled()
    })
    expect(state.discountCreates).toHaveLength(1)

    // Simulate owner approving the discount request, then caretaker refreshes
    state.discounts[0] = { ...state.discounts[0], status: 'approved' }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    const confirmBtn = await screen.findByRole('button', { name: 'Confirm approve' })
    fireEvent.click(confirmBtn)

    await screen.findByRole('link', { name: /Share welcome \/ deposit invoice on WhatsApp/i })
    expect(state.approvals[0].body).toMatchObject({
      bed_id: 'bed-1',
      rent_paise: 950000,
      discount_request_id: 'disc-1',
    })
  })

  test('[FE-21/AC6] API errors (e.g. backdated check-in) are shown as the API error message', async () => {
    mockApi({
      pending: [makeSummary(1)],
      detail: makeDetail(),
      board: makeBoard(),
      discounts: [],
      approvals: [],
      discountCreates: [],
      approveError: {
        status: 400,
        code: 'backdated_checkin',
        message: 'Check-in date cannot be backdated; ask the owner',
      },
    })
    renderCheckins('/caretaker/check-ins/req-1')

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const select = await screen.findByLabelText('Vacant bed')
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: /101-A/ })).toBeInTheDocument()
    })
    fireEvent.change(select, { target: { value: 'bed-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }))

    expect(await screen.findByText('Check-in date cannot be backdated; ask the owner')).toBeInTheDocument()
  })
})
