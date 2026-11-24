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

function signIn(role: 'owner' | 'caretaker') {
  const me = {
    id: 'user-1',
    phone: '9000000001',
    full_name: 'Demo User',
    memberships: [
      {
        org_id: 'org-1',
        organization_name: 'Demo PGs',
        role,
        assigned_property_ids: role === 'caretaker' ? ['prop-1'] : [],
      },
    ],
  }
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt')
  window.localStorage.setItem('pgcrm_me', JSON.stringify(me))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
}

function makeProperty(over: Record<string, unknown> = {}) {
  return {
    id: 'prop-1',
    name: 'Sunrise PG',
    address: null,
    locality: 'Koramangala',
    qr_slug: 'abc',
    upi_vpa: null,
    upi_payee_name: null,
    upi_mcc: null,
    fallback_upi_id: null,
    bank_details: null,
    short_term_daily_rate_paise: null,
    exit_deduction_paise: 0,
    house_rules: null,
    rent_due_day: 5,
    security_deposit_paise: 0,
    maintenance_charge_paise: 0,
    notice_deadline_day: 5,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
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

describe('Property setup', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-10/AC1] owner creates a property with billing fields converted to paise', async () => {
    signIn('owner')
    const calls = mockApi((c) => {
      if (c.method === 'GET' && c.url === '/api/v1/properties') return jsonResponse([])
      if (c.method === 'POST' && c.url === '/api/v1/properties') {
        return jsonResponse(makeProperty({ id: 'new-1', name: 'Lake View' }), 201)
      }
      if (c.method === 'GET' && c.url === '/api/v1/properties/new-1') {
        return jsonResponse(makeProperty({ id: 'new-1', name: 'Lake View' }))
      }
    })

    renderApp(['/owner/properties/new'])

    expect(screen.getByLabelText(/rent due by day of month/i)).toHaveValue('5')
    expect(screen.getByLabelText(/notice deadline day/i)).toHaveValue('5')
    expect(screen.getByLabelText(/security deposit/i)).toHaveAttribute('inputmode', 'numeric')

    typeInto(/^name/i, 'Lake View')
    typeInto(/short-term daily rate/i, '450.50')
    typeInto(/exit deduction/i, '1,000')
    typeInto(/rent due by day of month/i, '10')
    typeInto(/security deposit/i, '8000')
    typeInto(/maintenance charge/i, '1500')
    typeInto(/notice deadline day/i, '7')
    fireEvent.click(screen.getByRole('button', { name: /create property/i }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body).toMatchObject({
      name: 'Lake View',
      short_term_daily_rate_paise: 45050,
      exit_deduction_paise: 100000,
      rent_due_day: 10,
      security_deposit_paise: 800000,
      maintenance_charge_paise: 150000,
      notice_deadline_day: 7,
    })
    expect(await screen.findByRole('heading', { name: 'Lake View' })).toBeInTheDocument()
  })

  test('[FE-10/AC1] owner edits a property and PATCH carries changed billing fields', async () => {
    signIn('owner')
    const existing = makeProperty({
      security_deposit_paise: 500000,
      maintenance_charge_paise: 12050,
      rent_due_day: 5,
      notice_deadline_day: 5,
    })
    const calls = mockApi((c) => {
      if (c.method === 'GET' && c.url === '/api/v1/properties/prop-1') return jsonResponse(existing)
      if (c.method === 'PATCH') return jsonResponse({ ...existing, notice_deadline_day: 12 })
      if (c.method === 'GET') return jsonResponse([])
    })

    renderApp(['/owner/properties/prop-1/edit'])

    expect(await screen.findByLabelText(/security deposit/i)).toHaveValue('5000')
    expect(screen.getByLabelText(/maintenance charge/i)).toHaveValue('120.50')
    typeInto(/notice deadline day/i, '12')
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.url).toBe('/api/v1/properties/prop-1')
    expect(patch.body).toMatchObject({
      notice_deadline_day: 12,
      security_deposit_paise: 500000,
      maintenance_charge_paise: 12050,
    })
  })

  test('[FE-10/AC1] days outside 1-28 are rejected before calling the API', async () => {
    signIn('owner')
    const calls = mockApi(() => jsonResponse([]))
    renderApp(['/owner/properties/new'])

    typeInto(/^name/i, 'Bad Days')
    typeInto(/rent due by day of month/i, '31')
    fireEvent.click(screen.getByRole('button', { name: /create property/i }))

    expect(await screen.findByText(/rent due day must be a number from 1 to 28/i)).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  test('[FE-10/AC1] properties list shows name, locality and active badge', async () => {
    signIn('owner')
    mockApi((c) => {
      if (c.url === '/api/v1/properties') {
        return jsonResponse([
          makeProperty(),
          makeProperty({ id: 'prop-2', name: 'Old Block', locality: 'Indiranagar', is_active: false }),
        ])
      }
    })
    renderApp(['/owner/properties'])

    expect(await screen.findByText('Sunrise PG')).toBeInTheDocument()
    expect(screen.getByText('Koramangala')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /add property/i })).toHaveAttribute(
      'href',
      '/owner/properties/new',
    )
  })

  test('[FE-10/AC2] pasting UPI QR text shows the API payee name and VPA, plus the warning', async () => {
    signIn('owner')
    const qr = 'upi://pay?pa=shop@okbank&pn=Sunrise%20PG&sign=abc'
    const calls = mockApi((c) => {
      if (c.method === 'GET' && c.url === '/api/v1/properties/prop-1') {
        return jsonResponse(makeProperty())
      }
      if (c.method === 'POST' && c.url === '/api/v1/properties/prop-1/upi-from-qr') {
        return jsonResponse({
          upi_vpa: 'shop@okbank',
          upi_payee_name: 'Sunrise PG Stays',
          upi_mcc: null,
          warning: 'Not a merchant QR',
        })
      }
    })

    renderApp(['/owner/properties/prop-1'])

    fireEvent.change(await screen.findByLabelText(/paste the qr text/i), { target: { value: qr } })
    fireEvent.click(screen.getByRole('button', { name: /read qr text/i }))

    const confirm = await screen.findByTestId('upi-confirm')
    expect(within(confirm).getByText('Sunrise PG Stays')).toBeInTheDocument()
    expect(within(confirm).getByText('shop@okbank')).toBeInTheDocument()
    expect(within(confirm).getByText('Not a merchant QR')).toBeInTheDocument()
    expect(within(confirm).getByText(/is this your business name and upi id\?/i)).toBeInTheDocument()

    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({ qr_text: qr })
  })

  test('[FE-10/AC2] API error from upi-from-qr is shown via toast', async () => {
    signIn('owner')
    mockApi((c) => {
      if (c.method === 'GET') return jsonResponse(makeProperty())
      if (c.method === 'POST') {
        return jsonResponse({ error: { code: 'validation', message: 'Not a UPI QR code' } }, 422)
      }
    })
    renderApp(['/owner/properties/prop-1'])

    fireEvent.change(await screen.findByLabelText(/paste the qr text/i), {
      target: { value: 'hello' },
    })
    fireEvent.click(screen.getByRole('button', { name: /read qr text/i }))

    expect(await screen.findByText('Not a UPI QR code')).toBeInTheDocument()
  })

  test('[FE-10/AC3] caretaker has no property menu entry and cannot open property settings', async () => {
    signIn('caretaker')
    mockApi((c) => {
      if (c.method === 'GET') return jsonResponse([])
    })
    renderApp(['/owner/properties'])

    expect(await screen.findByText(/Caretaker workspace/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /properties/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /add property/i })).not.toBeInTheDocument()
  })

  test('[FE-10/AC3] caretaker is redirected away from a property edit route', async () => {
    signIn('caretaker')
    mockApi(() => jsonResponse([]))
    renderApp(['/owner/properties/prop-1/edit'])

    expect(await screen.findByText(/Caretaker workspace/i)).toBeInTheDocument()
    expect(screen.queryByText(/edit property/i)).not.toBeInTheDocument()
  })
})
