import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { AppRouter } from '@/routes/AppRouter'

const ME = {
  id: 'user-owner',
  phone: '9000000001',
  full_name: 'Demo Owner',
  memberships: [
    { org_id: 'org-1', organization_name: 'Demo PGs', role: 'owner', assigned_property_ids: [] },
  ],
}

const PROPERTIES = [
  { id: 'prop-1', name: 'Sunrise Block A', address: null, locality: null },
  { id: 'prop-2', name: 'Lakeview Block B', address: null, locality: null },
]

interface Member {
  user_id: string
  full_name: string
  phone: string
  role: 'owner' | 'caretaker'
  assigned_property_ids: string[]
  is_active: boolean
}

const OWNER_ROW: Member = {
  user_id: 'user-owner',
  full_name: 'Demo Owner',
  phone: '9000000001',
  role: 'owner',
  assigned_property_ids: [],
  is_active: true,
}

const RAVI: Member = {
  user_id: 'user-ravi',
  full_name: 'Ravi Kumar',
  phone: '9000000002',
  role: 'caretaker',
  assigned_property_ids: ['prop-1'],
  is_active: true,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface Calls {
  posts: Record<string, unknown>[]
  patches: { url: string; body: Record<string, unknown> }[]
}

function mockApi(initial: Member[], opts: { existingAccount?: boolean; patchError?: string } = {}) {
  const staff = initial.map((m) => ({ ...m }))
  const calls: Calls = { posts: [], patches: [] }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const req = input as Request
    const url = req.url
    if (url.endsWith('/properties')) return jsonResponse(PROPERTIES)
    if (url.endsWith('/staff') && req.method === 'GET') return jsonResponse(staff)
    if (url.endsWith('/staff') && req.method === 'POST') {
      const body = (await req.clone().json()) as Record<string, unknown>
      calls.posts.push(body)
      const member: Member = {
        user_id: 'user-new',
        full_name: String(body.full_name),
        phone: String(body.phone),
        role: 'caretaker',
        assigned_property_ids: (body.property_ids as string[]) ?? [],
        is_active: true,
      }
      staff.push(member)
      return jsonResponse({ ...member, existing_account: Boolean(opts.existingAccount) }, 201)
    }
    if (url.includes('/staff/') && req.method === 'PATCH') {
      const body = (await req.clone().json()) as Record<string, unknown>
      calls.patches.push({ url, body })
      if (opts.patchError) {
        return jsonResponse({ error: { code: 'forbidden', message: opts.patchError } }, 400)
      }
      const id = url.split('/staff/')[1]
      const m = staff.find((s) => s.user_id === id)!
      Object.assign(m, body)
      return jsonResponse(m)
    }
    return jsonResponse({})
  })
  return calls
}

function renderStaff(path = '/owner/staff') {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'owner-jwt')
  window.localStorage.setItem('pgcrm_me', JSON.stringify(ME))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
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

async function addCaretaker(phone = '9111111111') {
  fireEvent.click(await screen.findByRole('button', { name: 'Add caretaker' }))
  fireEvent.change(await screen.findByLabelText('Mobile number'), { target: { value: phone } })
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Sita Devi' } })
  fireEvent.change(screen.getByLabelText('Initial password'), { target: { value: 'secret1234' } })
  fireEvent.click(screen.getByLabelText('Lakeview Block B'))
  const form = screen.getByRole('form', { name: 'Add caretaker' })
  fireEvent.click(within(form).getByRole('button', { name: 'Add caretaker' }))
}

describe('Staff screen', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('More page links to Staff', async () => {
    mockApi([OWNER_ROW])
    renderStaff('/owner/more')
    fireEvent.click(within(await screen.findByRole('main')).getByRole('link', { name: 'Staff' }))
    expect(await screen.findByRole('heading', { name: 'Staff' })).toBeInTheDocument()
  })

  test('[FE-12/AC1] adding a caretaker with a property ticked shows them in the list', async () => {
    const calls = mockApi([OWNER_ROW, RAVI])
    renderStaff()
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument()

    await addCaretaker()

    expect(await screen.findByText('Sita Devi')).toBeInTheDocument()
    expect(calls.posts[0]).toMatchObject({
      phone: '9111111111',
      full_name: 'Sita Devi',
      password: 'secret1234',
      role: 'caretaker',
      property_ids: ['prop-2'],
    })
    const row = screen.getByText('Sita Devi').closest('li')!
    expect(within(row).getByText('Lakeview Block B')).toBeInTheDocument()
  })

  test('[FE-12/AC1] existing account response shows the existing-password message', async () => {
    mockApi([OWNER_ROW], { existingAccount: true })
    renderStaff()
    await addCaretaker()
    expect(
      await screen.findByText(/already has a PG-CRM account; they'll use their existing password/),
    ).toBeInTheDocument()
  })

  test('[FE-12/AC1] phone must be 10 digits starting 6-9 and password 8+ chars', async () => {
    const calls = mockApi([OWNER_ROW])
    renderStaff()
    await addCaretaker('1234567890')
    expect(await screen.findByText(/valid 10-digit Indian mobile number/)).toBeInTheDocument()
    expect(calls.posts).toHaveLength(0)
  })

  test('[FE-12/AC1] password show toggle reveals the password', async () => {
    mockApi([OWNER_ROW])
    renderStaff()
    fireEvent.click(await screen.findByRole('button', { name: 'Add caretaker' }))
    const input = await screen.findByLabelText('Initial password')
    expect(input).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(input).toHaveAttribute('type', 'text')
  })

  test('[FE-12/AC2] only the ticked properties are sent for the caretaker, and edit changes them', async () => {
    const calls = mockApi([OWNER_ROW, RAVI])
    renderStaff()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Ravi Kumar' }))
    fireEvent.click(await screen.findByLabelText('Lakeview Block B'))
    fireEvent.click(screen.getByLabelText('Sunrise Block A'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.patches).toHaveLength(1))
    expect(calls.patches[0].url).toContain('/staff/user-ravi')
    expect(calls.patches[0].body).toEqual({ assigned_property_ids: ['prop-2'] })
  })

  test('[FE-12/AC3] deactivate asks for confirmation before sending the request', async () => {
    const calls = mockApi([OWNER_ROW, RAVI])
    renderStaff()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Ravi Kumar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('They will lose access immediately.')).toBeInTheDocument()
    expect(calls.patches).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(calls.patches).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm deactivate' }))
    await waitFor(() => expect(calls.patches).toHaveLength(1))
    expect(calls.patches[0].body).toEqual({ is_active: false })
    expect(await screen.findByText('Inactive')).toBeInTheDocument()
  })

  test('[FE-12/AC3] API error message is shown when deactivate fails', async () => {
    mockApi([OWNER_ROW, RAVI], { patchError: 'Cannot deactivate this member' })
    renderStaff()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Ravi Kumar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm deactivate' }))
    expect(await screen.findByText('Cannot deactivate this member')).toBeInTheDocument()
  })

  test("[FE-12/AC4] the owner's own row has no edit controls", async () => {
    mockApi([OWNER_ROW, RAVI])
    renderStaff()
    const ownerRow = (await screen.findByText("9000000001")).closest("li")!
    expect(within(ownerRow).getByText('Owner')).toBeInTheDocument()
    expect(within(ownerRow).queryByRole('button')).toBeNull()
    const ravi = screen.getByText('Ravi Kumar').closest('li')!
    expect(within(ravi).getByRole('button', { name: 'Edit Ravi Kumar' })).toBeInTheDocument()
  })
})
