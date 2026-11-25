import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { computeNoticeLastDay, getTodayIST } from '@/features/residents/api'
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
      assigned_property_ids: ['prop-1'],
    },
  ],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeProp(id: string, name: string, deadlineDay = 5) {
  return {
    id,
    org_id: 'org-1',
    name,
    locality: 'HSR Layout',
    short_term_daily_rate_paise: 80000,
    rent_due_day: 5,
    security_deposit_paise: 1500000,
    maintenance_charge_paise: 100000,
    notice_deadline_day: deadlineDay,
    exit_deduction_paise: 200000,
    upi_vpa: 'demo@paytm',
    upi_payee_name: 'Demo PGs',
    house_rules: null,
    qr_slug: `qr-${id}`,
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
  }
}

function makeBoard(overrides?: {
  bed101AStatus?: 'occupied' | 'on_notice' | 'vacant' | 'reserved'
  bed101AExpectedVacate?: string | null
}) {
  const b1Status = overrides?.bed101AStatus ?? 'occupied'
  return {
    rooms: [
      {
        id: 'room-101',
        label: '101',
        floor: 1,
        sharing: 2,
        is_ac: false,
        beds: [
          {
            id: 'bed-101a',
            label: '101-A',
            status: b1Status,
            base_rent_paise: 1050000,
            is_active: true,
            stay:
              b1Status === 'vacant'
                ? null
                : {
                    id: 'stay-1',
                    stay_type: 'monthly',
                    status: b1Status === 'occupied' ? 'active' : b1Status,
                    rent_paise: 1050000,
                    check_in_date: '2026-10-01',
                    expected_vacate_date: overrides?.bed101AExpectedVacate ?? null,
                    resident: { id: 'res-1', full_name: 'Anika Rao' },
                  },
          },
          {
            id: 'bed-101b',
            label: '101-B',
            status: 'vacant',
            base_rent_paise: 1050000,
            is_active: true,
            stay: null,
          },
        ],
      },
      {
        id: 'room-102',
        label: '102',
        floor: 1,
        sharing: 2,
        is_ac: true,
        beds: [
          {
            id: 'bed-102a',
            label: '102-A',
            status: 'on_notice',
            base_rent_paise: 1200000,
            is_active: true,
            stay: {
              id: 'stay-2',
              stay_type: 'monthly',
              status: 'on_notice',
              rent_paise: 1150000,
              check_in_date: '2026-08-01',
              expected_vacate_date: '2026-11-30',
              resident: { id: 'res-2', full_name: 'Vikram Singh' },
            },
          },
          {
            id: 'bed-102b',
            label: '102-B',
            status: 'reserved',
            base_rent_paise: 1200000,
            is_active: true,
            stay: {
              id: 'stay-3',
              stay_type: 'monthly',
              status: 'reserved',
              rent_paise: 1200000,
              check_in_date: '2026-12-01',
              expected_vacate_date: null,
              resident: { id: 'res-3', full_name: 'Priya Nair' },
            },
          },
        ],
      },
    ],
  }
}

function makeResident(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    property_id: 'prop-1',
    onboarding_request_id: 'req-1',
    full_name: 'Anika Rao',
    phone: '9876543210',
    email: 'anika@example.com',
    date_of_birth: '1999-03-14',
    permanent_address: '10 Indiranagar, Bengaluru',
    occupation: 'working',
    employer_or_college: 'Acme Labs',
    emergency_contact_name: 'Suresh Rao',
    emergency_contact_phone: '9988776655',
    emergency_contact_relation: 'Father',
    id_doc_type: 'aadhaar',
    id_doc_number: '123456789012',
    id_doc_url: 'https://example.com/id.jpg',
    selfie_url: 'https://example.com/selfie.jpg',
    url_expires_in: 300,
    is_foreign_national: false,
    passport_number: null,
    visa_number: null,
    visa_expiry: null,
    food_preference: 'veg',
    vehicle_number: 'KA01AB1234',
    police_verification_status: 'verified',
    police_verification_date: '2026-10-10',
    created_at: '2026-10-01T09:00:00Z',
    current_stay: {
      id: 'stay-1',
      property_id: 'prop-1',
      resident_id: 'res-1',
      resident_name: 'Anika Rao',
      bed_id: 'bed-101a',
      bed_label: '101-A',
      room_label: '101',
      stay_type: 'monthly',
      status: 'active',
      rent_paise: 1050000,
      deposit_paise: 1500000,
      check_in_date: '2026-10-01',
      notice_given_on: null,
      expected_vacate_date: null,
      actual_vacate_date: null,
      discount_request_id: null,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
    },
    past_stays: [
      {
        id: 'stay-old',
        property_id: 'prop-1',
        resident_id: 'res-1',
        resident_name: 'Anika Rao',
        bed_id: 'bed-100a',
        bed_label: '100-A',
        room_label: '100',
        stay_type: 'monthly',
        status: 'vacated',
        rent_paise: 900000,
        deposit_paise: 1000000,
        check_in_date: '2025-01-01',
        notice_given_on: '2025-09-02',
        expected_vacate_date: '2025-09-30',
        actual_vacate_date: '2025-09-30',
        discount_request_id: null,
        created_at: '2025-01-01T09:00:00Z',
        updated_at: '2025-09-30T09:00:00Z',
      },
    ],
    ...overrides,
  }
}

function setSession(me: typeof OWNER_ME | typeof CARETAKER_ME) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'test-jwt')
  window.localStorage.setItem('pgcrm_me', JSON.stringify(me))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
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

describe('FE-23 Bed board and resident detail', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-23/AC1] Bed tiles show FE-01 status badges, resident first name, rent, summary line, and property switcher', async () => {
    setSession(OWNER_ME)
    const props = [makeProp('prop-1', 'Sunrise HSR'), makeProp('prop-2', 'Lakeview BTM')]
    const board1 = makeBoard()
    const board2 = {
      rooms: [
        {
          id: 'room-201',
          label: '201',
          floor: 2,
          sharing: 1,
          is_ac: true,
          beds: [
            {
              id: 'bed-201a',
              label: '201-A',
              status: 'vacant',
              base_rent_paise: 1400000,
              is_active: true,
              stay: null,
            },
          ],
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = (input as Request).url
      if (url.endsWith('/api/v1/properties')) return jsonResponse(props)
      if (url.includes('/properties/prop-1/bed-board')) return jsonResponse(board1)
      if (url.includes('/properties/prop-2/bed-board')) return jsonResponse(board2)
      if (url.includes('/discount-requests')) return jsonResponse([])
      return jsonResponse({})
    })

    renderAt('/owner/beds')

    await screen.findByTestId('bed-tile-101-A')
    expect(screen.getByTestId('bed-board-summary')).toHaveTextContent(
      '1 occupied · 1 vacant · 1 on notice · 1 reserved',
    )

    const tile101A = screen.getByTestId('bed-tile-101-A')
    expect(within(tile101A).getByText('Occupied')).toBeInTheDocument()
    expect(within(tile101A).getByText('Anika')).toBeInTheDocument()
    expect(within(tile101A).getByText('₹10,500')).toBeInTheDocument()
    expect(tile101A).toHaveAttribute('href', '/owner/residents/res-1')

    const tile101B = screen.getByTestId('bed-tile-101-B')
    expect(within(tile101B).getByText('Vacant')).toBeInTheDocument()
    expect(within(tile101B).getByText('₹10,500')).toBeInTheDocument()

    const tile102A = screen.getByTestId('bed-tile-102-A')
    expect(within(tile102A).getByText('On notice')).toBeInTheDocument()
    expect(within(tile102A).getByText('Vikram')).toBeInTheDocument()
    expect(within(tile102A).getByText('₹11,500')).toBeInTheDocument()

    const tile102B = screen.getByTestId('bed-tile-102-B')
    expect(within(tile102B).getByText('Reserved')).toBeInTheDocument()
    expect(within(tile102B).getByText('Priya')).toBeInTheDocument()

    // Switch property
    const switcher = screen.getByRole('group', { name: 'Property switcher' })
    fireEvent.click(within(switcher).getByRole('button', { name: 'Lakeview BTM' }))
    await screen.findByTestId('bed-tile-201-A')
    expect(screen.queryByTestId('bed-tile-101-A')).not.toBeInTheDocument()
  })

  test('[FE-23/AC2] Filter chips show only matching beds (All / Vacant / On notice)', async () => {
    setSession(CARETAKER_ME)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = (input as Request).url
      if (url.endsWith('/api/v1/properties')) return jsonResponse([makeProp('prop-1', 'Sunrise HSR')])
      if (url.includes('/bed-board')) return jsonResponse(makeBoard())
      if (url.includes('/onboarding-requests')) return jsonResponse([])
      return jsonResponse({})
    })

    renderAt('/caretaker/beds')
    await screen.findByTestId('bed-tile-101-A')

    const filterGroup = screen.getByRole('group', { name: 'Bed status filter' })

    // Vacant filter
    fireEvent.click(within(filterGroup).getByRole('button', { name: 'Vacant' }))
    expect(screen.getByTestId('bed-tile-101-B')).toBeInTheDocument()
    expect(screen.queryByTestId('bed-tile-101-A')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bed-tile-102-A')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bed-tile-102-B')).not.toBeInTheDocument()

    // On notice filter
    fireEvent.click(within(filterGroup).getByRole('button', { name: 'On notice' }))
    expect(screen.getByTestId('bed-tile-102-A')).toBeInTheDocument()
    expect(screen.queryByTestId('bed-tile-101-B')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bed-tile-101-A')).not.toBeInTheDocument()

    // Back to All
    fireEvent.click(within(filterGroup).getByRole('button', { name: 'All' }))
    expect(screen.getByTestId('bed-tile-101-A')).toBeInTheDocument()
    expect(screen.getByTestId('bed-tile-101-B')).toBeInTheDocument()
    expect(screen.getByTestId('bed-tile-102-A')).toBeInTheDocument()
    expect(screen.getByTestId('bed-tile-102-B')).toBeInTheDocument()
  })

  test('[FE-23/AC3,AC4] Caretaker move out today has no date picker and frees the bed on the board immediately', async () => {
    setSession(CARETAKER_ME)
    let movedOut = false
    const moveOutPayloads: unknown[] = []
    const todayIST = getTodayIST()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const req = input as Request
      const url = req.url
      if (url.endsWith('/api/v1/properties')) return jsonResponse([makeProp('prop-1', 'Sunrise HSR')])
      if (url.endsWith('/api/v1/properties/prop-1')) return jsonResponse(makeProp('prop-1', 'Sunrise HSR'))
      if (url.includes('/bed-board')) {
        return jsonResponse(makeBoard({ bed101AStatus: movedOut ? 'vacant' : 'occupied' }))
      }
      if (url.endsWith('/api/v1/residents/res-1')) {
        return jsonResponse(
          makeResident(
            movedOut
              ? {
                  current_stay: null,
                  past_stays: [
                    {
                      ...makeResident().current_stay,
                      status: 'vacated',
                      actual_vacate_date: todayIST,
                    },
                  ],
                }
              : {},
          ),
        )
      }
      if (url.endsWith('/api/v1/stays/stay-1/move-out') && req.method === 'POST') {
        moveOutPayloads.push(await req.clone().json())
        movedOut = true
        return jsonResponse({
          ...makeResident().current_stay,
          status: 'vacated',
          actual_vacate_date: todayIST,
        })
      }
      if (url.includes('/onboarding-requests')) return jsonResponse([])
      return jsonResponse({})
    })

    renderAt('/caretaker/beds')
    const tile = await screen.findByTestId('bed-tile-101-A')
    expect(within(tile).getByText('Occupied')).toBeInTheDocument()

    // Navigate to resident detail
    fireEvent.click(tile)
    await screen.findByRole('heading', { name: 'Anika Rao' })

    // Caretaker must NOT see "Correct dates" (AC4)
    expect(screen.queryByRole('button', { name: 'Correct dates' })).not.toBeInTheDocument()

    // Verify call and WhatsApp links
    expect(screen.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:9876543210')
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/919876543210')

    // Click Move out today
    fireEvent.click(screen.getByRole('button', { name: 'Move out today' }))
    const dialog = await screen.findByRole('dialog', { name: 'Move out today' })

    // Caretaker gets NO date picker (AC4)
    expect(dialog.querySelector('input[type="date"]')).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm move-out' }))

    await waitFor(() => {
      expect(moveOutPayloads).toEqual([{ actual_vacate_date: todayIST }])
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // Navigate back to Bed board -> bed 101-A is now vacant immediately (AC3)
    fireEvent.click(screen.getByRole('link', { name: 'Bed board' }))
    await waitFor(() => {
      const updatedTile = screen.getByTestId('bed-tile-101-A')
      expect(within(updatedTile).getByText('Vacant')).toBeInTheDocument()
    })
  })

  test('[FE-23/AC4] Owner sees "Correct dates" and can fix check-in and move-out dates via PATCH /stays/{id}', async () => {
    setSession(OWNER_ME)
    const patchCalls: unknown[] = []
    let resident = makeResident()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const req = input as Request
      const url = req.url
      if (url.endsWith('/api/v1/properties/prop-1')) return jsonResponse(makeProp('prop-1', 'Sunrise HSR'))
      if (url.endsWith('/api/v1/residents/res-1')) return jsonResponse(resident)
      if (url.endsWith('/api/v1/stays/stay-old') && req.method === 'PATCH') {
        const body = (await req.clone().json()) as { check_in_date?: string; actual_vacate_date?: string }
        patchCalls.push(body)
        const updatedPast = {
          ...resident.past_stays[0],
          ...body,
        }
        resident = { ...resident, past_stays: [updatedPast] }
        return jsonResponse(updatedPast)
      }
      if (url.includes('/discount-requests')) return jsonResponse([])
      return jsonResponse({})
    })

    renderAt('/owner/residents/res-1')
    await screen.findByRole('heading', { name: 'Anika Rao' })

    const correctButtons = screen.getAllByRole('button', { name: 'Correct dates' })
    expect(correctButtons.length).toBeGreaterThanOrEqual(2) // current stay + past stay

    // Open Correct dates on the past (vacated) stay
    fireEvent.click(correctButtons[1])
    const dialog = await screen.findByRole('dialog', { name: 'Correct dates' })
    const checkInInput = within(dialog).getByLabelText('Check-in date')
    const vacateInput = within(dialog).getByLabelText('Move-out date')
    fireEvent.change(checkInInput, { target: { value: '2025-01-05' } })
    fireEvent.change(vacateInput, { target: { value: '2025-10-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save dates' }))

    await waitFor(() => {
      expect(patchCalls).toEqual([{ check_in_date: '2025-01-05', actual_vacate_date: '2025-10-01' }])
    })
  })

  test('[FE-23/AC5,AC6] Give notice shows computed last day before confirming (no date picker for caretaker), updates bed to on_notice, and withdraw notice returns it to occupied', async () => {
    setSession(CARETAKER_ME)
    const todayIST = getTodayIST()
    const deadlineDay = 5
    const expectedLastDay = computeNoticeLastDay(todayIST, deadlineDay)

    let stayStatus: 'active' | 'on_notice' = 'active'
    let noticePostedBody: string | null = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const req = input as Request
      const url = req.url
      if (url.endsWith('/api/v1/properties')) return jsonResponse([makeProp('prop-1', 'Sunrise HSR', deadlineDay)])
      if (url.endsWith('/api/v1/properties/prop-1')) return jsonResponse(makeProp('prop-1', 'Sunrise HSR', deadlineDay))
      if (url.includes('/bed-board')) {
        return jsonResponse(
          makeBoard({
            bed101AStatus: stayStatus === 'on_notice' ? 'on_notice' : 'occupied',
            bed101AExpectedVacate: stayStatus === 'on_notice' ? expectedLastDay : null,
          }),
        )
      }
      if (url.endsWith('/api/v1/residents/res-1')) {
        const base = makeResident()
        return jsonResponse({
          ...base,
          current_stay: {
            ...base.current_stay,
            status: stayStatus,
            notice_given_on: stayStatus === 'on_notice' ? todayIST : null,
            expected_vacate_date: stayStatus === 'on_notice' ? expectedLastDay : null,
          },
        })
      }
      if (url.endsWith('/api/v1/stays/stay-1/notice') && req.method === 'POST') {
        noticePostedBody = await req.clone().text()
        stayStatus = 'on_notice'
        const base = makeResident()
        return jsonResponse({
          ...base.current_stay,
          status: 'on_notice',
          notice_given_on: todayIST,
          expected_vacate_date: expectedLastDay,
        })
      }
      if (url.endsWith('/api/v1/stays/stay-1/withdraw-notice') && req.method === 'POST') {
        stayStatus = 'active'
        const base = makeResident()
        return jsonResponse({
          ...base.current_stay,
          status: 'active',
          notice_given_on: null,
          expected_vacate_date: null,
        })
      }
      if (url.includes('/onboarding-requests')) return jsonResponse([])
      return jsonResponse({})
    })

    renderAt('/caretaker/residents/res-1')
    await screen.findByRole('heading', { name: 'Anika Rao' })

    // Give notice (AC5)
    fireEvent.click(screen.getByRole('button', { name: 'Give notice' }))
    const noticeDialog = await screen.findByRole('dialog', { name: 'Give notice' })

    // Caretaker gets NO date picker
    expect(noticeDialog.querySelector('input[type="date"]')).toBeNull()
    // Shows computed last day before confirming
    expect(within(noticeDialog).getByText(/Last day:/)).toBeInTheDocument()
    const timeEl = noticeDialog.querySelector('time')
    expect(timeEl).toHaveAttribute('datetime', expectedLastDay)

    fireEvent.click(within(noticeDialog).getByRole('button', { name: 'Confirm notice' }))

    await waitFor(() => {
      expect(noticePostedBody).toBe('')
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // Stay card now shows On notice and API's expected_vacate_date
    const stayCard = screen.getByLabelText('Current stay')
    expect(within(stayCard).getByText('On notice')).toBeInTheDocument()
    expect(stayCard.querySelector(`time[datetime="${expectedLastDay}"]`)).toBeInTheDocument()

    // Check bed board shows On notice (AC6)
    fireEvent.click(screen.getByRole('link', { name: 'Bed board' }))
    const noticeTile = await screen.findByTestId('bed-tile-101-A')
    expect(within(noticeTile).getByText('On notice')).toBeInTheDocument()

    // Go back to resident and withdraw notice (AC6)
    fireEvent.click(noticeTile)
    await screen.findByRole('button', { name: 'Withdraw notice' })
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw notice' }))
    const withdrawDialog = await screen.findByRole('dialog', { name: 'Withdraw notice' })
    fireEvent.click(within(withdrawDialog).getByRole('button', { name: 'Confirm withdraw' }))

    await waitFor(() => {
      expect(within(screen.getByLabelText('Current stay')).getByText('Occupied')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('link', { name: 'Bed board' }))
    await waitFor(() => {
      const occupiedTile = screen.getByTestId('bed-tile-101-A')
      expect(within(occupiedTile).getByText('Occupied')).toBeInTheDocument()
    })
  })

  test('Reserved stay shows Mark arrived and calls POST /stays/{id}/check-in; API errors display error.message', async () => {
    setSession(CARETAKER_ME)
    let arrived = false
    let failCheckIn = true

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const req = input as Request
      const url = req.url
      if (url.endsWith('/api/v1/properties/prop-1')) return jsonResponse(makeProp('prop-1', 'Sunrise HSR'))
      if (url.endsWith('/api/v1/residents/res-3')) {
        const base = makeResident({ id: 'res-3', full_name: 'Priya Nair' })
        return jsonResponse({
          ...base,
          current_stay: {
            ...base.current_stay,
            id: 'stay-3',
            resident_id: 'res-3',
            resident_name: 'Priya Nair',
            status: arrived ? 'active' : 'reserved',
          },
        })
      }
      if (url.endsWith('/api/v1/stays/stay-3/check-in') && req.method === 'POST') {
        if (failCheckIn) {
          failCheckIn = false
          return jsonResponse({ error: { code: 'invalid', message: 'Bed is not ready yet' } }, 422)
        }
        arrived = true
        const base = makeResident()
        return jsonResponse({ ...base.current_stay, id: 'stay-3', status: 'active' })
      }
      if (url.includes('/onboarding-requests')) return jsonResponse([])
      return jsonResponse({})
    })

    renderAt('/caretaker/residents/res-3')
    await screen.findByRole('heading', { name: 'Priya Nair' })
    expect(within(screen.getByLabelText('Current stay')).getByText('Reserved')).toBeInTheDocument()

    // First click fails and displays API error.message
    fireEvent.click(screen.getByRole('button', { name: 'Mark arrived' }))
    await screen.findByText('Bed is not ready yet')

    // Second click succeeds
    fireEvent.click(screen.getByRole('button', { name: 'Mark arrived' }))
    await waitFor(() => {
      expect(within(screen.getByLabelText('Current stay')).getByText('Occupied')).toBeInTheDocument()
    })
  })
})
