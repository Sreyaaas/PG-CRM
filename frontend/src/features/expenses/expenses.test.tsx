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
  full_name: 'Ravi Kumar',
  memberships: [
    { org_id: 'org-1', organization_name: 'Demo PGs', role: 'caretaker', assigned_property_ids: ['prop-1'] },
  ],
}
const OWNER_ME = {
  id: 'user-owner',
  phone: '9000000001',
  full_name: 'Demo Owner',
  memberships: [{ org_id: 'org-1', organization_name: 'Demo PGs', role: 'owner', assigned_property_ids: [] }],
}

const PROPERTIES = [{ id: 'prop-1', name: 'Sunrise HSR', address: null, locality: null }]

type TestExpense = Record<string, unknown> & { id: string; flagged_for_review: boolean }

function makeExpense(overrides: Record<string, unknown> = {}): TestExpense {
  return {
    id: 'exp-1',
    property_id: 'prop-1',
    category: 'water_tanker',
    amount_paise: 250000,
    quantity: 3,
    unit: 'tanker',
    expense_date: '2026-11-24',
    vendor_name: null,
    notes: 'Tanker without bill, borewell dry',
    bill_mode: 'no_bill',
    proof_path: 'org/org-1/prop-1/expense_proof/abc.jpg',
    proof_captured_at: '2026-11-24T10:00:00Z',
    proof_lat: 12.9121,
    proof_lng: 77.6446,
    paid_from: 'caretaker_cash',
    owner_only: false,
    flagged_for_review: true,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    created_by: 'user-ct',
    created_at: '2026-11-24T10:05:00Z',
    voided_at: null,
    voided_by: null,
    void_reason: null,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface State {
  expenses: TestExpense[]
  posts: { body: Record<string, unknown>; idempotencyKey: string | null }[]
  uploads: Record<string, unknown>[]
  puts: { url: string; contentType: string | null }[]
  reviews: string[]
  voids: { id: string; body: Record<string, unknown> }[]
  createError?: { status: number; message: string }
  createFailures?: number
}

function newState(expenses: TestExpense[] = []): State {
  return { expenses, posts: [], uploads: [], puts: [], reviews: [], voids: [] }
}

function mockApi(state: State) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (typeof input === 'string' || input instanceof URL) {
      // Direct PUT to the presigned URL (not via the API client).
      state.puts.push({ url: String(input), contentType: new Headers(init?.headers).get('Content-Type') })
      return new Response(null, { status: 200 })
    }
    const req = input as Request
    const url = req.url
    if (url.endsWith('/properties')) return jsonResponse(PROPERTIES)
    if (url.endsWith('/staff')) {
      return jsonResponse([{ user_id: 'user-ct', full_name: 'Ravi Kumar', phone: '9000000002', role: 'caretaker' }])
    }
    if (url.includes('/files/url')) return jsonResponse({ url: 'https://files.example/proof.jpg' })
    if (url.endsWith('/uploads') && req.method === 'POST') {
      state.uploads.push((await req.clone().json()) as Record<string, unknown>)
      return jsonResponse({
        object_key: 'org/org-1/prop-1/expense_proof/new.jpg',
        upload_url: 'https://s3.example/put-here',
        expires_in: 300,
      })
    }
    if (url.endsWith('/expenses') && req.method === 'POST') {
      const body = (await req.clone().json()) as Record<string, unknown>
      state.posts.push({ body, idempotencyKey: req.headers.get('Idempotency-Key') })
      if (state.createFailures && state.createFailures > 0) {
        state.createFailures -= 1
        return jsonResponse({ error: { code: 'upstream', message: 'Network hiccup, try again' } }, 502)
      }
      if (state.createError) {
        return jsonResponse({ error: { code: 'validation', message: state.createError.message } }, state.createError.status)
      }
      const created = makeExpense({
        id: 'exp-new',
        ...body,
        flagged_for_review: body.bill_mode === 'no_bill',
        created_at: '2026-11-25T08:00:00Z',
      })
      state.expenses = [created, ...state.expenses]
      return jsonResponse(created, 201)
    }
    if (url.includes('/expenses') && url.includes('/review') && req.method === 'POST') {
      const id = url.split('/expenses/')[1].split('/')[0]
      state.reviews.push(id)
      state.expenses = state.expenses.map((e) =>
        e.id === id ? { ...e, flagged_for_review: false, reviewed_at: '2026-11-25T09:00:00Z' } : e,
      )
      return jsonResponse(state.expenses.find((e) => e.id === id))
    }
    if (url.includes('/expenses') && url.includes('/void') && req.method === 'POST') {
      const id = url.split('/expenses/')[1].split('/')[0]
      state.voids.push({ id, body: (await req.clone().json()) as Record<string, unknown> })
      state.expenses = state.expenses.map((e) => (e.id === id ? { ...e, voided_at: '2026-11-25T09:00:00Z' } : e))
      return jsonResponse(state.expenses.find((e) => e.id === id))
    }
    if (url.includes('/expenses') && req.method === 'GET') {
      const flagged = new URL(url).searchParams.get('flagged') === 'true'
      return jsonResponse(state.expenses.filter((e) => !flagged || e.flagged_for_review))
    }
    return jsonResponse({})
  })
}

function mockGeolocation(mode: 'ok' | 'denied') {
  const getCurrentPosition = vi.fn((success: PositionCallback, error?: PositionErrorCallback) => {
    if (mode === 'ok') {
      success({ coords: { latitude: 12.9121, longitude: 77.6446 } } as GeolocationPosition)
    } else {
      error?.({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError)
    }
  })
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true })
  return getCurrentPosition
}

// jsdom has no canvas; compressImage then falls back to the original file.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
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

function signIn(me: unknown) {
  window.localStorage.clear()
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt')
  window.localStorage.setItem('pgcrm_me', JSON.stringify(me))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
}

const photoFile = () => new File([new Uint8Array(2048)], 'bill.jpg', { type: 'image/jpeg' })

async function fillBasics(amount = '2500') {
  fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: amount } })
}

/** The photo input renders after the form's data loads; wait for it instead of racing the render. */
async function fileInput(): Promise<HTMLInputElement> {
  let el: HTMLInputElement | null = null
  await waitFor(() => {
    el = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(el).not.toBeNull()
  })
  return el!
}

describe('Log expense (caretaker)', () => {
  beforeEach(() => signIn(CARETAKER_ME))
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-42/AC1] the no-bill photo input is camera-only (capture=environment) with no gallery input', async () => {
    mockApi(newState())
    renderAt('/caretaker/expenses/new')
    fireEvent.click(await screen.findByRole('button', { name: 'No bill' }))

    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toHaveAttribute('capture', 'environment')
    expect(inputs[0]).toHaveAttribute('accept', 'image/*')

    // The has-bill input (camera or gallery) has no capture attribute.
    fireEvent.click(screen.getByRole('button', { name: 'Has bill' }))
    const billInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(billInput).not.toHaveAttribute('capture')
  })

  test('[FE-42/AC2] with location denied, submit is blocked with the location message and nothing is saved', async () => {
    const state = newState()
    mockApi(state)
    mockGeolocation('denied')
    renderAt('/caretaker/expenses/new')
    fireEvent.click(await screen.findByRole('button', { name: 'No bill' }))
    await fillBasics()
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: 'Tanker came, no bill given' } })
    fireEvent.change(document.querySelector('input[capture]')!, { target: { files: [photoFile()] } })

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))

    expect(await screen.findByText('Location is required for expenses without a bill')).toBeInTheDocument()
    expect(state.posts).toHaveLength(0)
    expect(state.uploads).toHaveLength(0)
  })

  test('[FE-42/AC3] a no-bill expense needs a note of at least 5 characters', async () => {
    const state = newState()
    mockApi(state)
    mockGeolocation('ok')
    renderAt('/caretaker/expenses/new')
    fireEvent.click(await screen.findByRole('button', { name: 'No bill' }))
    await fillBasics()
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: 'abc' } })
    fireEvent.change(document.querySelector('input[capture]')!, { target: { files: [photoFile()] } })

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(await screen.findByText(/note of at least 5 characters is required/i)).toBeInTheDocument()
    expect(state.posts).toHaveLength(0)

    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: 'Tanker came, no bill given' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(state.posts).toHaveLength(1))
    expect(state.posts[0].body).toMatchObject({
      bill_mode: 'no_bill',
      proof_lat: 12.9121,
      proof_lng: 77.6446,
      notes: 'Tanker came, no bill given',
    })
    expect(typeof state.posts[0].body.proof_captured_at).toBe('string')
  })

  test('[FE-42/AC4] a has-bill expense uploads the photo, saves with an Idempotency-Key and appears in the list', async () => {
    const state = newState()
    mockApi(state)
    renderAt('/caretaker/expenses/new')
    fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '2,500.50' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/^Vendor/), { target: { value: 'Sri Water Suppliers' } })
    fireEvent.change(await fileInput(), { target: { files: [photoFile()] } })

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))

    await waitFor(() => expect(state.posts).toHaveLength(1))
    expect(state.uploads[0]).toMatchObject({ kind: 'expense_proof', property_id: 'prop-1', content_type: 'image/jpeg' })
    expect(state.puts[0]).toMatchObject({ url: 'https://s3.example/put-here', contentType: 'image/jpeg' })
    expect(state.posts[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(state.posts[0].body).toMatchObject({
      property_id: 'prop-1',
      category: 'water_tanker',
      amount_paise: 250050,
      quantity: 3,
      unit: 'tanker',
      vendor_name: 'Sri Water Suppliers',
      bill_mode: 'has_bill',
      paid_from: 'caretaker_cash',
      proof_path: 'org/org-1/prop-1/expense_proof/new.jpg',
      proof_captured_at: null,
    })

    // Back on the list, the new expense is there.
    const row = await screen.findByTestId('expense-row')
    expect(within(row).getByText('Water tanker')).toBeInTheDocument()
    expect(within(row).getByText('₹2,500.50')).toBeInTheDocument()
  })

  test('a retry after a failed save reuses the Idempotency-Key and the uploaded photo', async () => {
    const state = newState()
    state.createFailures = 1
    mockApi(state)
    renderAt('/caretaker/expenses/new')
    await fillBasics('900')
    fireEvent.change(await fileInput(), { target: { files: [photoFile()] } })

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(await screen.findByText('Network hiccup, try again')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))

    await waitFor(() => expect(state.posts).toHaveLength(2))
    expect(state.posts[1].idempotencyKey).toBe(state.posts[0].idempotencyKey)
    expect(state.uploads).toHaveLength(1)
  })

  test('shows the API error message in a toast when the save is refused', async () => {
    const state = newState()
    state.createError = { status: 422, message: 'The photo is too old. Take a new one.' }
    mockApi(state)
    renderAt('/caretaker/expenses/new')
    await fillBasics('900')
    fireEvent.change(await fileInput(), { target: { files: [photoFile()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(await screen.findByText('The photo is too old. Take a new one.')).toBeInTheDocument()
  })

  test('caretakers cannot pick lease rent', async () => {
    mockApi(newState())
    renderAt('/caretaker/expenses/new')
    const group = await screen.findByRole('radiogroup', { name: 'Category' })
    expect(within(group).getAllByRole('radio')[0]).toHaveTextContent('Water tanker')
    expect(within(group).queryByText('Lease rent')).not.toBeInTheDocument()
  })
})

describe('Owner expense review', () => {
  beforeEach(() => signIn(OWNER_ME))
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-42/AC5] flagged expenses show in yellow with photo, map link and note; Mark reviewed removes the flag', async () => {
    const state = newState([makeExpense()])
    mockApi(state)
    renderAt('/owner/expenses')
    fireEvent.click(await screen.findByRole('button', { name: 'Needs review' }))

    const card = await screen.findByTestId('expense-card')
    expect(card.className).toContain('bg-warning-soft')
    expect(within(card).getByText('₹2,500')).toBeInTheDocument()
    expect(within(card).getByText('Tanker without bill, borewell dry')).toBeInTheDocument()
    expect(within(card).getByText(/Ravi Kumar/)).toBeInTheDocument()
    expect(within(card).getByText('No bill: review')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /View location on map/ })).toHaveAttribute(
      'href',
      'https://maps.google.com/?q=12.9121,77.6446',
    )
    expect(await within(card).findByAltText('Expense proof')).toHaveAttribute('src', 'https://files.example/proof.jpg')

    fireEvent.click(within(card).getByRole('button', { name: 'Mark reviewed' }))

    await waitFor(() => expect(screen.queryByTestId('expense-card')).not.toBeInTheDocument())
    expect(state.reviews).toEqual(['exp-1'])
    expect(await screen.findByText('Nothing needs review.')).toBeInTheDocument()
  })

  test('the Approvals tab lists flagged expenses and an owner can void one with a reason', async () => {
    const state = newState([makeExpense()])
    mockApi(state)
    renderAt('/owner/approvals')

    const card = await screen.findByTestId('expense-card')
    fireEvent.click(within(card).getByRole('button', { name: 'Void' }))
    const sheet = await screen.findByRole('dialog')
    const confirm = within(sheet).getByRole('button', { name: 'Confirm void' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(sheet).getByLabelText('Reason'), { target: { value: 'Duplicate entry' } })
    fireEvent.click(confirm)

    await waitFor(() => expect(state.voids).toEqual([{ id: 'exp-1', body: { reason: 'Duplicate entry' } }]))
    await waitFor(() => expect(screen.queryByTestId('expense-card')).not.toBeInTheDocument())
  })
})
