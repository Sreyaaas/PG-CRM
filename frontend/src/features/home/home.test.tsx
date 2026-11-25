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

const CARETAKER_ME = {
  id: 'user-ct',
  phone: '9000000002',
  full_name: 'Ravi Kumar',
  memberships: [
    {
      org_id: 'org-1',
      organization_name: 'Demo PGs',
      role: 'caretaker',
      assigned_property_ids: ['prop-1', 'prop-2'],
    },
  ],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function isoDaysFromToday(offsetDays: number): string {
  const istNow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const [y, m, d] = istNow.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays))
  return dt.toISOString().slice(0, 10)
}

function makeProp(id: string, name: string, locality = 'HSR Layout') {
  return {
    id,
    org_id: 'org-1',
    name,
    locality,
    short_term_daily_rate_paise: 80000,
    exit_deduction_paise: 200000,
    upi_vpa: 'demo@paytm',
    upi_payee_name: 'Demo PGs',
    house_rules: null,
    qr_slug: `qr-${id}`,
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
  }
}

function makeDiscount(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'pending',
    property_id: 'prop-1',
    property_name: 'Sunrise HSR',
    bed_id: 'bed-1',
    bed_label: '101-A',
    resident_id: null,
    resident_name: 'Asha',
    base_rent_paise: 1000000,
    requested_rent_paise: 850000,
    difference_paise: 150000,
    reason: '6 month stay',
    requested_by: 'user-ct',
    requested_by_name: 'Ravi Kumar',
    created_at: '2026-11-20T09:30:00Z',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    ...overrides,
  }
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

function setSession(me: typeof OWNER_ME | typeof CARETAKER_ME) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'test-jwt')
  window.localStorage.setItem('pgcrm_me', JSON.stringify(me))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
}

describe('FE-04 Home screens', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-04/AC1] Caretaker home lists on-notice beds for assigned properties, soonest vacate date first', async () => {
    setSession(CARETAKER_ME)
    const props = [makeProp('prop-1', 'Sunrise HSR'), makeProp('prop-2', 'Lakeview BTM', 'BTM')]
    const boards: Record<string, unknown> = {
      'prop-1': {
        rooms: [
          {
            id: 'r-1',
            label: '101',
            floor: 1,
            sharing: 2,
            is_ac: false,
            beds: [
              {
                id: 'b-1',
                label: '101-A',
                status: 'on_notice',
                base_rent_paise: 1000000,
                is_active: true,
                stay: {
                  id: 's-1',
                  stay_type: 'monthly',
                  status: 'on_notice',
                  rent_paise: 1000000,
                  check_in_date: '2026-08-01',
                  expected_vacate_date: isoDaysFromToday(5),
                  resident: { id: 'res-1', full_name: 'Kiran Rao' },
                },
              },
              {
                id: 'b-2',
                label: '101-B',
                status: 'on_notice',
                base_rent_paise: 1000000,
                is_active: true,
                stay: {
                  id: 's-2',
                  stay_type: 'monthly',
                  status: 'on_notice',
                  rent_paise: 1000000,
                  check_in_date: '2026-08-01',
                  expected_vacate_date: isoDaysFromToday(-2),
                  resident: { id: 'res-2', full_name: 'Arjun Mehta' },
                },
              },
            ],
          },
        ],
      },
      'prop-2': {
        rooms: [
          {
            id: 'r-2',
            label: '201',
            floor: 2,
            sharing: 1,
            is_ac: true,
            beds: [
              {
                id: 'b-3',
                label: '201-A',
                status: 'on_notice',
                base_rent_paise: 1200000,
                is_active: true,
                stay: {
                  id: 's-3',
                  stay_type: 'monthly',
                  status: 'on_notice',
                  rent_paise: 1200000,
                  check_in_date: '2026-09-01',
                  expected_vacate_date: isoDaysFromToday(0),
                  resident: { id: 'res-3', full_name: 'Neha Verma' },
                },
              },
            ],
          },
        ],
      },
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = (input as Request).url
      if (url.endsWith('/api/v1/properties')) return jsonResponse(props)
      if (url.includes('/bed-board')) {
        const propId = url.split('/properties/')[1].split('/')[0]
        return jsonResponse(boards[propId])
      }
      if (url.includes('/discount-requests')) return jsonResponse([])
      return jsonResponse({})
    })

    renderAt('/caretaker')

    const noticesCard = await screen.findByLabelText('Notices and move-outs')
    const items = await within(noticesCard).findAllByRole('listitem')
    expect(items).toHaveLength(3)

    // Sorted soonest first: overdue (-2) -> Today (0) -> 5 days left
    expect(items[0]).toHaveTextContent('101-B')
    expect(items[0]).toHaveTextContent('Arjun Mehta')
    expect(items[0]).toHaveTextContent('2 days overdue')

    expect(items[1]).toHaveTextContent('201-A')
    expect(items[1]).toHaveTextContent('Neha Verma')
    expect(items[1]).toHaveTextContent('Today')

    expect(items[2]).toHaveTextContent('101-A')
    expect(items[2]).toHaveTextContent('Kiran Rao')
    expect(items[2]).toHaveTextContent('5 days left')

    // Property switcher filters to Lakeview BTM
    const switcher = screen.getByRole('group', { name: 'Property filter' })
    fireEvent.click(within(switcher).getByRole('button', { name: 'Lakeview BTM' }))
    const filteredItems = within(noticesCard).getAllByRole('listitem')
    expect(filteredItems).toHaveLength(1)
    expect(filteredItems[0]).toHaveTextContent('201-A')
  })

  test('[FE-04/AC2] Caretaker home shows vacant-bed count and list grouped by room for selected property', async () => {
    setSession(CARETAKER_ME)
    const props = [makeProp('prop-1', 'Sunrise HSR'), makeProp('prop-2', 'Lakeview BTM', 'BTM')]
    const boards: Record<string, unknown> = {
      'prop-1': {
        rooms: [
          {
            id: 'r-1',
            label: '101',
            floor: 1,
            sharing: 2,
            is_ac: false,
            beds: [
              { id: 'b-1', label: '101-A', status: 'vacant', base_rent_paise: 1050000, is_active: true, stay: null },
              { id: 'b-2', label: '101-B', status: 'occupied', base_rent_paise: 1050000, is_active: true, stay: null },
            ],
          },
          {
            id: 'r-2',
            label: '102',
            floor: 1,
            sharing: 2,
            is_ac: false,
            beds: [
              { id: 'b-3', label: '102-A', status: 'vacant', base_rent_paise: 600000, is_active: true, stay: null },
            ],
          },
        ],
      },
      'prop-2': {
        rooms: [
          {
            id: 'r-3',
            label: '201',
            floor: 2,
            sharing: 1,
            is_ac: true,
            beds: [
              { id: 'b-4', label: '201-A', status: 'vacant', base_rent_paise: 1200000, is_active: true, stay: null },
            ],
          },
        ],
      },
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = (input as Request).url
      if (url.endsWith('/api/v1/properties')) return jsonResponse(props)
      if (url.includes('/bed-board')) {
        const propId = url.split('/properties/')[1].split('/')[0]
        return jsonResponse(boards[propId])
      }
      if (url.includes('/discount-requests')) {
        return jsonResponse([makeDiscount('d-1', { status: 'approved', decision_note: 'Approved for 6m' })])
      }
      return jsonResponse({})
    })

    renderAt('/caretaker')

    const vacantCard = await screen.findByLabelText('Vacant beds')
    expect(await within(vacantCard).findByText('(3)')).toBeInTheDocument()
    expect(within(vacantCard).getByText('Sunrise HSR · Room 101')).toBeInTheDocument()
    expect(within(vacantCard).getByText('₹10,500')).toBeInTheDocument()
    expect(within(vacantCard).getByText('₹6,000')).toBeInTheDocument()
    expect(within(vacantCard).getByText('₹12,000')).toBeInTheDocument()

    // Caretaker's discount requests also load
    const discountsCard = await screen.findByLabelText('My discount requests')
    expect(within(discountsCard).getByText('Approved')).toBeInTheDocument()

    // Switch to Sunrise HSR -> vacant count becomes 2
    fireEvent.click(screen.getByRole('button', { name: 'Sunrise HSR' }))
    expect(within(vacantCard).getByText('(2)')).toBeInTheDocument()
    expect(within(vacantCard).queryByText('201-A')).not.toBeInTheDocument()
  })

  test('[FE-04/AC3] Owner home shows occupied / total beds across all properties and per property', async () => {
    setSession(OWNER_ME)
    const props = [makeProp('prop-1', 'Sunrise HSR'), makeProp('prop-2', 'Lakeview BTM', 'BTM')]
    const boards: Record<string, unknown> = {
      'prop-1': {
        rooms: [
          {
            id: 'r-1',
            label: '101',
            floor: 1,
            sharing: 3,
            is_ac: false,
            beds: [
              { id: 'b-1', label: '101-A', status: 'occupied', base_rent_paise: 1000000, is_active: true, stay: null },
              { id: 'b-2', label: '101-B', status: 'on_notice', base_rent_paise: 1000000, is_active: true, stay: null },
              { id: 'b-3', label: '101-C', status: 'vacant', base_rent_paise: 1000000, is_active: true, stay: null },
            ],
          },
        ],
      },
      'prop-2': {
        rooms: [
          {
            id: 'r-2',
            label: '201',
            floor: 2,
            sharing: 2,
            is_ac: true,
            beds: [
              { id: 'b-4', label: '201-A', status: 'occupied', base_rent_paise: 1200000, is_active: true, stay: null },
              { id: 'b-5', label: '201-B', status: 'vacant', base_rent_paise: 1200000, is_active: true, stay: null },
            ],
          },
        ],
      },
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = (input as Request).url
      if (url.endsWith('/api/v1/properties')) return jsonResponse(props)
      if (url.includes('/bed-board')) {
        const propId = url.split('/properties/')[1].split('/')[0]
        return jsonResponse(boards[propId])
      }
      if (url.includes('/discount-requests')) return jsonResponse([])
      return jsonResponse({})
    })

    renderAt('/owner')

    const summary = await screen.findByLabelText('Summary')
    await waitFor(() => {
      expect(within(summary).getByText('5')).toBeInTheDocument() // Total beds
    })

    const occupancyCard = screen.getByRole('heading', { name: 'Occupancy' }).closest('[data-slot="card"]') as HTMLElement
    const sunriseRow = within(occupancyCard).getByRole('link', { name: /Sunrise HSR/ })
    expect(sunriseRow).toHaveAttribute('href', '/owner/properties/prop-1')
    expect(within(sunriseRow).getByText('1 vacant')).toBeInTheDocument()
    expect(within(sunriseRow).getByText('2/3')).toBeInTheDocument()

    const lakeviewRow = within(occupancyCard).getByRole('link', { name: /Lakeview BTM/ })
    expect(lakeviewRow).toHaveAttribute('href', '/owner/properties/prop-2')
    expect(within(lakeviewRow).getByText('1 vacant')).toBeInTheDocument()
    expect(within(lakeviewRow).getByText('1/2')).toBeInTheDocument()
  })

  test('[FE-04/AC4] Owner home shows pending approvals count and lets owner approve or reject inline', async () => {
    setSession(OWNER_ME)
    let pending = [makeDiscount('req-1')]
    const decides: { url: string; body: unknown }[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const req = input as Request
      const url = req.url
      if (url.endsWith('/api/v1/properties')) return jsonResponse([makeProp('prop-1', 'Sunrise HSR')])
      if (url.includes('/bed-board')) return jsonResponse({ rooms: [] })
      if (url.includes('/decide') && req.method === 'POST') {
        decides.push({ url, body: await req.clone().json() })
        pending = []
        return jsonResponse(makeDiscount('req-1', { status: 'approved' }))
      }
      if (url.includes('/discount-requests')) return jsonResponse(pending)
      return jsonResponse({})
    })

    renderAt('/owner')

    const decisionCard = await screen.findByLabelText('Needs your decision')
    expect(await within(decisionCard).findByText('(1)')).toBeInTheDocument()
    const card = await within(decisionCard).findByTestId('discount-card')

    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(decides).toEqual([
        { url: expect.stringContaining('/api/v1/discount-requests/req-1/decide'), body: { decision: 'approved', note: null } },
      ])
    })
    await waitFor(() => {
      expect(screen.getByText(/Nothing waiting for you\./)).toBeInTheDocument()
    })
  })

  test('[FE-04/AC5] Empty sections collapse to one quiet line and no placeholder sections render', async () => {
    setSession(CARETAKER_ME)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = (input as Request).url
      if (url.endsWith('/api/v1/properties')) return jsonResponse([makeProp('prop-1', 'Sunrise HSR')])
      if (url.includes('/bed-board')) {
        return jsonResponse({
          rooms: [
            {
              id: 'r-1',
              label: '101',
              floor: 1,
              sharing: 1,
              is_ac: false,
              beds: [
                { id: 'b-1', label: '101-A', status: 'occupied', base_rent_paise: 1000000, is_active: true, stay: null },
              ],
            },
          ],
        })
      }
      if (url.includes('/discount-requests')) return jsonResponse([])
      return jsonResponse({})
    })

    renderAt('/caretaker')

    await screen.findByText(/Nobody is on notice\./)
    expect(screen.getByText(/No vacant beds\./)).toBeInTheDocument()
    expect(screen.getByText(/No discount requests\./)).toBeInTheDocument()

    // No placeholder sections for unbuilt endpoints
    expect(screen.queryByText(/Pending check-ins/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Rent due/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Cash in hand/i)).not.toBeInTheDocument()
  })
})
