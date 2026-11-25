import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { AppRouter } from '@/routes/AppRouter'
import { sortComplaints, type Complaint } from './api'

const ME = {
  id: 'user-owner',
  phone: '9000000001',
  full_name: 'Demo Owner',
  memberships: [{ org_id: 'org-1', organization_name: 'Demo PGs', role: 'owner', assigned_property_ids: [] }],
}
const PROPERTY = {
  id: 'prop-1', name: 'Sunrise HSR', is_active: true, address: null, locality: 'HSR', qr_slug: 's', upi_vpa: null,
  upi_payee_name: null, upi_mcc: null, fallback_upi_id: null, bank_details: null, short_term_daily_rate_paise: null,
  exit_deduction_paise: 0, house_rules: null, rent_due_day: 5, security_deposit_paise: 0, maintenance_charge_paise: 0,
  notice_deadline_day: 5, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
}
const BOARD = {
  rooms: [
    {
      id: 'room-1', label: '102', floor: 1, sharing: 2, is_ac: false,
      beds: [
        {
          id: 'bed-1', label: '102-A', status: 'occupied', base_rent_paise: 600000, is_active: true,
          stay: { id: 's1', stay_type: 'monthly', status: 'active', rent_paise: 600000, check_in_date: '2026-10-01', expected_vacate_date: null, resident: { id: 'res-1', full_name: 'Siddharth Jain' } },
        },
        { id: 'bed-2', label: '102-B', status: 'vacant', base_rent_paise: 600000, is_active: true, stay: null },
      ],
    },
  ],
}

function complaint(over: Partial<Complaint>): Complaint {
  return {
    id: 'c', property_id: 'prop-1', property_name: 'Sunrise HSR', room_id: null, room_label: null, bed_id: null,
    bed_label: null, resident_id: null, resident_name: null, category: 'other', title: 'x', note: null,
    priority: 'normal', status: 'open', photo_path: null, assigned_to: null, assigned_to_name: null,
    created_by: 'user-owner', created_by_name: 'Demo Owner', created_at: '2026-11-25T08:00:00Z',
    updated_at: '2026-11-25T08:00:00Z', resolved_by: null, resolved_at: null, resolution_note: null, ...over,
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockApi(initial: Complaint[]) {
  let list = initial.map((c) => ({ ...c }))
  const posts: Record<string, unknown>[] = []
  const patches: { url: string; body: Record<string, unknown> }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const req = input as Request
    const url = new URL(req.url)
    if (url.pathname.endsWith('/properties')) return json([PROPERTY])
    if (url.pathname.endsWith('/bed-board')) return json(BOARD)
    if (url.pathname.endsWith('/complaints') && req.method === 'GET') return json(list)
    if (url.pathname.endsWith('/complaints') && req.method === 'POST') {
      const body = (await req.clone().json()) as Record<string, unknown>
      posts.push(body)
      const created = complaint({ id: 'new', ...(body as Partial<Complaint>), resident_name: body.resident_id ? 'Siddharth Jain' : null })
      list = [...list, created]
      return json(created, 201)
    }
    if (url.pathname.includes('/complaints/') && req.method === 'PATCH') {
      const body = (await req.clone().json()) as Record<string, unknown>
      patches.push({ url: url.pathname, body })
      const id = url.pathname.split('/').pop()
      list = list.map((c) => (c.id === id ? { ...c, ...(body as Partial<Complaint>) } : c))
      return json(list.find((c) => c.id === id))
    }
    return json([])
  })
  return { posts, patches }
}

function renderAt(path: string) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'owner-jwt')
  window.localStorage.setItem('pgcrm_me', JSON.stringify(ME))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={qc}>
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

describe('Complaints', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-06/AC1] unresolved complaints come first, urgent first, then not started, then longest waiting', () => {
    const sorted = sortComplaints([
      complaint({ id: 'resolved', status: 'resolved', priority: 'urgent' }),
      complaint({ id: 'open-new', created_at: '2026-11-25T10:00:00Z' }),
      complaint({ id: 'urgent-started', priority: 'urgent', status: 'in_progress' }),
      complaint({ id: 'open-old', created_at: '2026-11-24T10:00:00Z' }),
      complaint({ id: 'started', status: 'in_progress' }),
    ])
    expect(sorted.map((c) => c.id)).toEqual(['urgent-started', 'open-old', 'open-new', 'started', 'resolved'])
  })

  test('[FE-06/AC1] the list hides resolved complaints until the Resolved filter is chosen', async () => {
    mockApi([complaint({ id: 'a', title: 'Wi-Fi down' }), complaint({ id: 'b', title: 'Old leak', status: 'resolved' })])
    renderAt('/owner/complaints')
    expect(await screen.findByText('Wi-Fi down')).toBeInTheDocument()
    expect(screen.queryByText('Old leak')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }))
    expect(await screen.findByText('Old leak')).toBeInTheDocument()
    expect(screen.queryByText('Wi-Fi down')).not.toBeInTheDocument()
  })

  test('[FE-06/AC2] logging a complaint sends the building, bed, resident, category, title and priority', async () => {
    const { posts } = mockApi([])
    renderAt('/owner/complaints?new=1')
    const dialog = await screen.findByRole('dialog', { name: 'New complaint' })
    await waitFor(() => expect(within(dialog).getByRole('option', { name: '102-A · Siddharth Jain' })).toBeInTheDocument())
    fireEvent.change(within(dialog).getByLabelText('Resident or room'), { target: { value: 'bed-1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Water' }))
    fireEvent.change(within(dialog).getByLabelText('Problem'), { target: { value: 'Tap dripping all night' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Urgent' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log complaint' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({
      property_id: 'prop-1', bed_id: 'bed-1', resident_id: 'res-1', category: 'water',
      title: 'Tap dripping all night', priority: 'urgent',
    })
    expect(await screen.findByText('Tap dripping all night')).toBeInTheDocument()
  })

  test('[FE-06/AC2] a complaint needs a category and a title before it is sent', async () => {
    const { posts } = mockApi([])
    renderAt('/owner/complaints?new=1')
    const dialog = await screen.findByRole('dialog', { name: 'New complaint' })
    await waitFor(() => expect(within(dialog).getByRole('option', { name: '102-A · Siddharth Jain' })).toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log complaint' }))
    expect(await within(dialog).findByText('Choose what the problem is about.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Food' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log complaint' }))
    expect(await within(dialog).findByText('Describe the problem in a few words.')).toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })

  test('[FE-06/AC3] resolving needs a note, sends it, and the complaint leaves the unresolved list', async () => {
    const { patches } = mockApi([complaint({ id: 'c1', title: 'Wi-Fi down', priority: 'urgent' })])
    renderAt('/owner/complaints')
    fireEvent.click(await screen.findByText('Wi-Fi down'))
    const dialog = await screen.findByRole('dialog', { name: 'Wi-Fi down' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }))
    const confirm = within(dialog).getByRole('button', { name: 'Mark resolved' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('What was done?'), { target: { value: 'Router restarted' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({ url: '/api/v1/complaints/c1', body: { status: 'resolved', resolution_note: 'Router restarted' } })
    await waitFor(() => expect(screen.queryByText('Wi-Fi down')).not.toBeInTheDocument())
  })

  test('[FE-06/AC3] Start work moves an open complaint to in progress', async () => {
    const { patches } = mockApi([complaint({ id: 'c2', title: 'AC not cooling' })])
    renderAt('/owner/complaints')
    fireEvent.click(await screen.findByText('AC not cooling'))
    const dialog = await screen.findByRole('dialog', { name: 'AC not cooling' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start work' }))
    await waitFor(() => expect(patches[0]?.body).toEqual({ status: 'in_progress' }))
  })
})
