import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { AppRouter } from '@/routes/AppRouter'

function renderApp(initialEntries: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function signIn() {
  const me = {
    id: 'user-1',
    phone: '9000000001',
    full_name: 'Demo User',
    memberships: [
      { org_id: 'org-1', organization_name: 'Demo PGs', role: 'owner', assigned_property_ids: [] },
    ],
  }
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt')
  window.localStorage.setItem('pgcrm_me', JSON.stringify(me))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
}

interface Call {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function mockApi(handlers: (call: Call) => Response | undefined) {
  const calls: Call[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const req = input as Request
    const text = req.method === 'GET' ? '' : await req.clone().text()
    const call: Call = {
      method: req.method,
      url: new URL(req.url).pathname,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    }
    calls.push(call)
    return handlers(call) ?? jsonResponse({})
  })
  return calls
}

function typeInto(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

const BOARD_URL = '/api/v1/properties/prop-1/bed-board'

function boardBed(id: string, label: string, rent = 600000, over: Record<string, unknown> = {}) {
  return { id, label, status: 'vacant', base_rent_paise: rent, is_active: true, stay: null, ...over }
}

function boardRoom(label: string, beds: ReturnType<typeof boardBed>[], over = {}) {
  return { id: `room-${label}`, label, floor: 2, sharing: beds.length, is_ac: false, beds, ...over }
}

function apiBed(b: ReturnType<typeof boardBed>, roomId: string) {
  return {
    ...b,
    room_id: roomId,
    property_id: 'prop-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('Rooms and beds', () => {
  beforeEach(() => {
    window.localStorage.clear()
    signIn()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-11/AC1] adding a 3-sharing room shows the preview text and then the 3 new beds', async () => {
    let created = false
    const beds = [
      boardBed('b1', '204-A'),
      boardBed('b2', '204-B'),
      boardBed('b3', '204-C'),
    ]
    const calls = mockApi((c) => {
      if (c.method === 'GET' && c.url === BOARD_URL) {
        return jsonResponse({ rooms: created ? [boardRoom('204', beds)] : [] })
      }
      if (c.method === 'POST' && c.url === '/api/v1/properties/prop-1/rooms') {
        created = true
        return jsonResponse(
          {
            id: 'room-204',
            property_id: 'prop-1',
            label: '204',
            floor: 2,
            sharing: 3,
            is_ac: false,
            area_sqft: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            beds: beds.map((b) => apiBed(b, 'room-204')),
            warning: null,
          },
          201,
        )
      }
      if (c.method === 'GET') return jsonResponse({})
    })

    renderApp(['/owner/properties/prop-1/rooms'])

    typeInto('Room label', '204')
    typeInto(/^floor/i, '2')
    typeInto(/rent per bed/i, '6000')
    expect(screen.getByTestId('room-preview')).toHaveTextContent(
      'Creates 3 beds: 204-A, 204-B, 204-C at ₹6,000 each',
    )
    expect(screen.getByLabelText(/rent per bed/i)).toHaveAttribute('inputmode', 'numeric')

    fireEvent.click(screen.getByRole('button', { name: 'Add room' }))

    const room = await screen.findByRole('region', { name: 'Room 204' })
    expect(within(room).getByText('204-A')).toBeInTheDocument()
    expect(within(room).getByText('204-B')).toBeInTheDocument()
    expect(within(room).getByText('204-C')).toBeInTheDocument()
    expect(within(room).getAllByText('₹6,000')).toHaveLength(3)

    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({
      label: '204',
      floor: 2,
      sharing: 3,
      is_ac: false,
      area_sqft: null,
      base_rent_paise: 600000,
    })
  })

  test('[FE-11/AC1] sharing stepper stays within 1-8 and updates the preview', () => {
    mockApi(() => jsonResponse({ rooms: [] }))
    renderApp(['/owner/properties/prop-1/rooms'])
    typeInto('Room label', '5')
    typeInto(/rent per bed/i, '4500')
    const up = screen.getByRole('button', { name: /increase sharing/i })
    for (let i = 0; i < 10; i++) fireEvent.click(up)
    expect(screen.getByTestId('room-preview')).toHaveTextContent(
      'Creates 8 beds: 5-A, 5-B, 5-C, 5-D, 5-E, 5-F, 5-G, 5-H at ₹4,500 each',
    )
    expect(up).toBeDisabled()
  })

  test('[FE-11/AC2] editing a bed rent saves paise and shows the new rent', async () => {
    let rent = 600000
    const calls = mockApi((c) => {
      if (c.method === 'GET' && c.url === BOARD_URL) {
        return jsonResponse({ rooms: [boardRoom('204', [boardBed('b1', '204-A', rent)])] })
      }
      if (c.method === 'PATCH' && c.url === '/api/v1/beds/b1') {
        rent = (c.body as { base_rent_paise: number }).base_rent_paise
        return jsonResponse(apiBed(boardBed('b1', '204-A', rent), 'room-204'))
      }
    })

    renderApp(['/owner/properties/prop-1/rooms'])

    expect(await screen.findByText('₹6,000')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit bed 204-A' }))
    expect(screen.getByLabelText('Rent (₹)')).toHaveValue('6000')
    typeInto('Rent (₹)', '6,500.50')
    fireEvent.click(screen.getByRole('button', { name: 'Save bed' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.body).toEqual({ base_rent_paise: 650050 })
    expect(await screen.findByText('₹6,500.50')).toBeInTheDocument()
    expect(screen.queryByText('₹6,000')).not.toBeInTheDocument()
  })

  test('[FE-11/AC3] a duplicate room label shows the API 409 message on the label field', async () => {
    mockApi((c) => {
      if (c.method === 'GET' && c.url === BOARD_URL) return jsonResponse({ rooms: [] })
      if (c.method === 'POST') {
        return jsonResponse(
          { error: { code: 'conflict', message: 'A room with label 204 already exists' } },
          409,
        )
      }
    })

    renderApp(['/owner/properties/prop-1/rooms'])
    typeInto('Room label', '204')
    typeInto(/rent per bed/i, '6000')
    fireEvent.click(screen.getByRole('button', { name: 'Add room' }))

    const message = await screen.findByText('A room with label 204 already exists')
    expect(message.closest('div')).toContainElement(screen.getByLabelText('Room label'))
  })

  test('[FE-11/AC3] a duplicate bed label shows the API 409 message on the bed label field', async () => {
    mockApi((c) => {
      if (c.method === 'GET' && c.url === BOARD_URL) {
        return jsonResponse({ rooms: [boardRoom('204', [boardBed('b1', '204-A')])] })
      }
      if (c.method === 'POST' && c.url === '/api/v1/rooms/room-204/beds') {
        return jsonResponse(
          { error: { code: 'conflict', message: 'A bed with label 204-A already exists' } },
          409,
        )
      }
    })

    renderApp(['/owner/properties/prop-1/rooms'])
    fireEvent.click(await screen.findByRole('button', { name: 'Add bed to 204' }))
    typeInto('New bed label', '204-A')
    typeInto('New bed rent (₹)', '6000')
    fireEvent.click(screen.getByRole('button', { name: 'Add bed' }))

    expect(await screen.findByText('A bed with label 204-A already exists')).toBeInTheDocument()
  })

  test('shows the API area warning as a yellow note after adding a small room', async () => {
    let created = false
    mockApi((c) => {
      if (c.method === 'GET' && c.url === BOARD_URL) {
        return jsonResponse({ rooms: created ? [boardRoom('9', [boardBed('b9', '9-A')])] : [] })
      }
      if (c.method === 'POST') {
        created = true
        return jsonResponse(
          {
            id: 'room-9',
            property_id: 'prop-1',
            label: '9',
            floor: null,
            sharing: 3,
            is_ac: false,
            area_sqft: 100,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            beds: [],
            warning: 'Below 70 sq ft per resident (GBA rule)',
          },
          201,
        )
      }
    })
    renderApp(['/owner/properties/prop-1/rooms'])
    typeInto('Room label', '9')
    typeInto(/area/i, '100')
    typeInto(/rent per bed/i, '5000')
    fireEvent.click(screen.getByRole('button', { name: 'Add room' }))
    await screen.findByRole('region', { name: 'Room 9' })
    expect(document.body).toHaveTextContent('Below 70 sq ft per resident (GBA rule)')
  })

  test('deactivating an occupied bed shows the API 422 message and never sends status', async () => {
    const calls = mockApi((c) => {
      if (c.method === 'GET' && c.url === BOARD_URL) {
        return jsonResponse({
          rooms: [boardRoom('204', [boardBed('b1', '204-A', 600000, { status: 'occupied' })])],
        })
      }
      if (c.method === 'PATCH') {
        return jsonResponse(
          { error: { code: 'validation_error', message: 'Bed has an open stay; move the resident out first' } },
          422,
        )
      }
    })
    renderApp(['/owner/properties/prop-1/rooms'])
    fireEvent.click(await screen.findByRole('button', { name: 'Edit bed 204-A' }))
    fireEvent.click(screen.getByLabelText('Active'))
    fireEvent.click(screen.getByRole('button', { name: 'Save bed' }))

    const msgs = await screen.findAllByText('Bed has an open stay; move the resident out first')
    expect(msgs.length).toBeGreaterThan(0)
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.body).toEqual({ is_active: false })
    expect(patch.body).not.toHaveProperty('status')
  })
})
