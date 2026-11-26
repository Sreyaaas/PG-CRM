import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { AppRouter } from '@/routes/AppRouter'

const ME = {
  id: 'u', phone: '9000000001', full_name: 'Owner',
  memberships: [{ org_id: 'org-1', organization_name: 'Demo PGs', role: 'owner', assigned_property_ids: [] }],
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const stay = (id: string, name: string, checkIn: string, vacate: string | null = null) => ({
  id: `s-${id}`, stay_type: 'monthly', status: 'active', rent_paise: 600000, check_in_date: checkIn,
  expected_vacate_date: vacate, resident: { id, full_name: name },
})
const BOARD = {
  rooms: [{
    id: 'r1', label: '102', floor: 1, sharing: 3, is_ac: false,
    beds: [
      { id: 'b1', label: '102-A', status: 'occupied', base_rent_paise: 600000, is_active: true, stay: stay('res-a', 'Arjun Menon', '2026-01-10') },
      { id: 'b2', label: '102-B', status: 'on_notice', base_rent_paise: 600000, is_active: true, stay: stay('res-b', 'Priya Nair', '2026-02-01', '2026-12-31') },
      { id: 'b3', label: '102-C', status: 'occupied', base_rent_paise: 600000, is_active: true, stay: stay('res-c', 'Kavya Hegde', today) },
    ],
  }],
}
const DUES = [{ resident_id: 'res-a', full_name: 'Arjun Menon', phone: '9', bed_label: '102-A', outstanding_paise: 1075000, oldest_due_date: '2026-10-05', days_overdue: 40, whatsapp_url: 'https://wa.me/919?text=x' }]

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function renderPage() {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt')
  window.localStorage.setItem('pgcrm_me', JSON.stringify(ME))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL((input as Request).url).pathname
    if (path.endsWith('/properties')) return json([{ id: 'p1', name: 'Sunrise HSR', is_active: true }])
    if (path.endsWith('/bed-board')) return json(BOARD)
    if (path.endsWith('/dues')) return json(DUES)
    return json([])
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/owner/residents']}>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('Residents directory', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('lists everyone staying with rent roll, and filters by overdue, notice, new and name', async () => {
    renderPage()
    const list = await screen.findByRole('list', { name: 'Residents' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    const summary = screen.getByLabelText('Residents summary')
    expect(within(summary).getByText('₹18,000')).toBeInTheDocument()

    const filters = screen.getByRole('group', { name: 'Filter residents' })
    fireEvent.click(within(filters).getByRole('button', { name: 'Rent overdue 1' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('Arjun Menon')).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: 'Send rent reminder to Arjun Menon on WhatsApp' })).toHaveAttribute('href', DUES[0].whatsapp_url)

    fireEvent.click(within(filters).getByRole('button', { name: 'On notice 1' }))
    expect(within(list).getByText('Priya Nair')).toBeInTheDocument()

    fireEvent.click(within(filters).getByRole('button', { name: 'New this month 1' }))
    expect(within(list).getByText('Kavya Hegde')).toBeInTheDocument()

    fireEvent.click(within(filters).getByRole('button', { name: 'All 3' }))
    fireEvent.change(screen.getByLabelText('Filter residents by name or bed'), { target: { value: '102-b' } })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('Priya Nair')).toBeInTheDocument()
  })
})
