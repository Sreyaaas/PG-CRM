import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { AppRouter } from '@/routes/AppRouter'

const ME = {
  id: 'user-ravi',
  phone: '9000000002',
  full_name: 'Ravi',
  memberships: [{ org_id: 'org-1', organization_name: 'Demo PGs', role: 'caretaker', assigned_property_ids: ['prop-1'] }],
}
const PROPERTY = { id: 'prop-1', name: 'Sunrise HSR', is_active: true }
const stay = (id: string, name: string) => ({
  id: `s-${id}`, stay_type: 'monthly', status: 'active', rent_paise: 600000, check_in_date: '2026-10-01',
  expected_vacate_date: null, resident: { id, full_name: name },
})
const BOARD = {
  rooms: [
    {
      id: 'room-102', label: '102', floor: 1, sharing: 2, is_ac: false,
      beds: [
        { id: 'b1', label: '102-A', status: 'occupied', base_rent_paise: 600000, is_active: true, stay: stay('res-1', 'Siddharth Jain') },
        { id: 'b2', label: '102-B', status: 'vacant', base_rent_paise: 600000, is_active: true, stay: null },
      ],
    },
    {
      id: 'room-201', label: '201', floor: 2, sharing: 1, is_ac: true,
      beds: [{ id: 'b3', label: '201-A', status: 'on_notice', base_rent_paise: 900000, is_active: true, stay: stay('res-2', 'Pooja Gowda') }],
    },
  ],
}
const COMPLAINTS = [
  { id: 'c1', title: 'Wi-Fi down on 2nd floor', status: 'open', priority: 'urgent', property_name: 'Sunrise HSR', bed_label: null, room_label: null, resident_name: 'Pooja Gowda' },
  { id: 'c2', title: 'Old leak', status: 'resolved', priority: 'low', property_name: 'Sunrise HSR', bed_label: null, room_label: null, resident_name: null },
]

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function renderApp() {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt')
  window.localStorage.setItem('pgcrm_me', JSON.stringify(ME))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname
    if (path.endsWith('/properties')) return json([PROPERTY])
    if (path.endsWith('/bed-board')) return json(BOARD)
    if (path.endsWith('/complaints')) return json(COMPLAINTS)
    return json([])
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/caretaker']}>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('Global search', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('finds residents by name or bed, rooms by number, and open complaints only', async () => {
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Search residents, rooms and complaints' }))
    const dialog = await screen.findByRole('dialog', { name: 'Search' })
    const input = within(dialog).getByRole('searchbox', { name: 'Search residents, rooms and complaints' })

    fireEvent.change(input, { target: { value: '102' } })
    const residents = await within(dialog).findByRole('region', { name: 'Residents' })
    expect(within(residents).getByText('Siddharth Jain')).toBeInTheDocument()
    const rooms = within(dialog).getByRole('region', { name: 'Rooms' })
    expect(within(rooms).getByText('Room 102')).toBeInTheDocument()
    expect(within(rooms).getByText('1 free')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'pooja' } })
    const hits = await within(dialog).findByRole('region', { name: 'Residents' })
    expect(within(hits).getByText('Pooja Gowda')).toBeInTheDocument()
    expect(within(hits).getByText('On notice')).toBeInTheDocument()
    // Her open complaint matches by resident name; a resolved complaint never shows.
    expect(within(dialog).getByText('Wi-Fi down on 2nd floor')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'leak' } })
    expect(await within(dialog).findByText('Nothing matches “leak”.')).toBeInTheDocument()
  })

  test('Ctrl+K opens search from anywhere', async () => {
    renderApp()
    await screen.findByRole('button', { name: 'Search residents, rooms and complaints' })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeInTheDocument()
  })
})
