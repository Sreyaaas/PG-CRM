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
  memberships: [{ org_id: 'org-1', organization_name: 'Demo PGs', role: 'owner', assigned_property_ids: [] }],
}

function row(n: number, match: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `row-${n}`,
    utr_number: `41234567890${n}`,
    amount_paise: 1050000,
    txn_at: '2026-11-01T03:44:05Z',
    payer_name: `Payer ${n}`,
    match,
    payment_id: match === 'unmatched' ? null : `pay-${n}`,
    payment_amount_paise: match === 'amount_mismatch' ? 900000 : match === 'unmatched' ? null : 1050000,
    payment_status: match === 'matched' ? 'verified' : match === 'amount_mismatch' ? 'flagged' : null,
    resident_id: match === 'unmatched' ? null : `res-${n}`,
    resident_name: match === 'unmatched' ? null : `Resident ${n}`,
    raw: {},
    ...overrides,
  }
}

const ROWS = [row(1, 'matched'), row(2, 'amount_mismatch'), row(3, 'unmatched'), row(4, 'matched')]

const UPLOAD_RESULT = { import_id: 'imp-1', row_count: 4, matched_count: 2, mismatch_count: 1, unmatched_count: 1 }

function payment(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `up-${n}`,
    property_id: 'prop-1',
    resident_id: `res-${n}`,
    resident_name: `Resident U${n}`,
    invoice_id: null,
    amount_paise: 800000,
    method: 'upi',
    utr_number: `51234567890${n}`,
    status: 'provisional',
    received_by: 'user-ct',
    received_by_name: 'Ravi',
    received_at: '2026-11-10T09:30:00Z',
    notes: null,
    verified_at: null,
    flag_reason: null,
    voided_at: null,
    void_reason: null,
    public_token: 'tok',
    receipt_url: '/receipt/tok',
    whatsapp_url: 'https://wa.me/x',
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface State {
  imports: unknown[]
  unverified: ReturnType<typeof payment>[]
  posts: { url: string; body: unknown; form?: FormData }[]
  uploadStatus?: number
  decisionStatus?: number
}

function mockApi(state: State) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const req = input as Request
    const url = req.url
    const method = req.method
    if (url.endsWith('/reconciliation/imports') && method === 'POST') {
      const form = await req.clone().formData()
      state.posts.push({ url, body: null, form })
      if (state.uploadStatus && state.uploadStatus >= 400) {
        return jsonResponse({ error: { code: 'unreadable', message: 'No UTR column found in this file' } }, state.uploadStatus)
      }
      return jsonResponse(UPLOAD_RESULT, 201)
    }
    if (url.endsWith('/reconciliation/imports') && method === 'GET') return jsonResponse(state.imports)
    if (url.includes('/reconciliation/imports/imp-1/rows')) return jsonResponse(ROWS)
    if (url.includes('/reconciliation/unverified-payments')) {
      expect(url).toContain('older_than_days=3')
      return jsonResponse(state.unverified)
    }
    if (method === 'POST' && (url.endsWith('/flag') || url.endsWith('/verify'))) {
      const body = url.endsWith('/flag') ? await req.clone().json() : null
      state.posts.push({ url, body })
      if (state.decisionStatus && state.decisionStatus >= 400) {
        return jsonResponse({ error: { code: 'conflict', message: 'Payment already voided' } }, state.decisionStatus)
      }
      const id = url.split('/payments/')[1].split('/')[0]
      state.unverified = state.unverified.filter((p) => p.id !== id)
      return jsonResponse(payment(0, { id }))
    }
    if (url.includes('/payments/pay-2') && method === 'GET') {
      return jsonResponse(payment(2, { id: 'pay-2', amount_paise: 900000, status: 'flagged', resident_name: 'Resident 2' }))
    }
    return jsonResponse({})
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/owner/money/reconcile']}>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function uploadCsv() {
  const file = new File(['a,b\n1,2'], 'paytm.csv', { type: 'text/csv' })
  fireEvent.change(await screen.findByLabelText('Statement CSV'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: /upload and reconcile/i }))
}

describe('CSV upload and reconciliation results', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'owner-jwt')
    window.localStorage.setItem('pgcrm_me', JSON.stringify(OWNER_ME))
    window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-40/AC1] uploading a CSV posts multipart and the summary shows exactly the API counts', async () => {
    const state: State = { imports: [], unverified: [], posts: [] }
    mockApi(state)
    renderPage()

    fireEvent.change(await screen.findByLabelText('Statement source'), { target: { value: 'phonepe_business' } })
    await uploadCsv()

    await waitFor(() => expect(screen.getByTestId('count-matched').textContent).toBe(String(UPLOAD_RESULT.matched_count)))
    expect(screen.getByTestId('count-mismatch').textContent).toBe(String(UPLOAD_RESULT.mismatch_count))
    expect(screen.getByTestId('count-unmatched').textContent).toBe(String(UPLOAD_RESULT.unmatched_count))

    expect(state.posts).toHaveLength(1)
    const form = state.posts[0].form!
    expect(form.get('source')).toBe('phonepe_business')
    expect(await (form.get('file') as Blob).text()).toBe('a,b\n1,2')
    expect(await screen.findAllByTestId('statement-row')).toHaveLength(4)
  })

  test('[FE-40/AC1] an upload error shows the API message in a toast', async () => {
    mockApi({ imports: [], unverified: [], posts: [], uploadStatus: 422 })
    renderPage()
    await uploadCsv()
    expect(await screen.findByText('No UTR column found in this file')).toBeInTheDocument()
  })

  test('[FE-40/AC2] rows filter by result and mismatches are red', async () => {
    mockApi({ imports: [], unverified: [], posts: [] })
    renderPage()
    await uploadCsv()

    const all = await screen.findAllByTestId('statement-row')
    expect(all).toHaveLength(4)
    const mismatchRow = all.find((r) => r.dataset.match === 'amount_mismatch')!
    expect(within(mismatchRow).getByTestId('match-badge').dataset.tone).toBe('danger')
    expect(mismatchRow.querySelector('.bg-danger-soft')).not.toBeNull()
    expect(within(mismatchRow).getByText(/Logged/)).toHaveTextContent('₹9,000')
    const matchedRow = all.find((r) => r.dataset.match === 'matched')!
    expect(within(matchedRow).getByTestId('match-badge').dataset.tone).toBe('success')

    fireEvent.click(screen.getByRole('button', { name: /^Mismatch/ }))
    expect(screen.getAllByTestId('statement-row')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^Matched/ }))
    expect(screen.getAllByTestId('statement-row')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /^Not logged/ }))
    const unmatched = screen.getAllByTestId('statement-row')
    expect(unmatched).toHaveLength(1)
    expect(within(unmatched[0]).getByTestId('match-badge').dataset.tone).toBe('neutral')
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect(screen.getAllByTestId('statement-row')).toHaveLength(4)
  })

  test('[FE-40/AC2] tapping a mismatch row opens the payment', async () => {
    mockApi({ imports: [], unverified: [], posts: [] })
    renderPage()
    await uploadCsv()
    fireEvent.click(await screen.findByRole('button', { name: 'Open payment: Payer 2' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Flagged')).toBeInTheDocument()
    expect(within(dialog).getByText('₹9,000')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Open resident' })).toHaveAttribute('href', '/owner/residents/res-2')
  })

  test('[FE-40/AC3] "Not in any statement" lists payments with Flag and Verify actions', async () => {
    const state: State = { imports: [], unverified: [payment(1), payment(2)], posts: [] }
    mockApi(state)
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Not in any statement' }))

    const items = await screen.findAllByTestId('unverified-payment')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Resident U1')).toBeInTheDocument()
    expect(within(items[0]).getByText('₹8,000')).toBeInTheDocument()
    expect(within(items[0]).getByRole('button', { name: 'Flag' })).toBeInTheDocument()
    expect(within(items[0]).getByRole('button', { name: 'Verify manually' })).toBeInTheDocument()
  })

  test('[FE-40/AC3] Verify posts to the payment and removes it; Flag sends the reason', async () => {
    const state: State = { imports: [], unverified: [payment(1), payment(2)], posts: [] }
    mockApi(state)
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Not in any statement' }))

    let items = await screen.findAllByTestId('unverified-payment')
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Verify manually' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm verify' }))
    await waitFor(() => expect(screen.getAllByTestId('unverified-payment')).toHaveLength(1))
    expect(state.posts[0].url).toContain('/payments/up-1/verify')

    items = screen.getAllByTestId('unverified-payment')
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Flag' }))
    const confirm = await screen.findByRole('button', { name: 'Confirm flag' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Screenshot looks edited' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(screen.queryByTestId('unverified-payment')).not.toBeInTheDocument())
    expect(state.posts[1].url).toContain('/payments/up-2/flag')
    expect(state.posts[1].body).toEqual({ reason: 'Screenshot looks edited' })
  })

  test('[FE-40/AC3] a failed flag shows the API message', async () => {
    mockApi({ imports: [], unverified: [payment(1)], posts: [], decisionStatus: 409 })
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Not in any statement' }))
    const item = await screen.findByTestId('unverified-payment')
    fireEvent.click(within(item).getByRole('button', { name: 'Flag' }))
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'Fake' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm flag' }))
    expect(await screen.findByText('Payment already voided')).toBeInTheDocument()
  })

  test('past imports list opens that import with its stored counts', async () => {
    mockApi({
      imports: [
        {
          id: 'imp-1',
          source: 'paytm_business',
          file_name: 'nov.csv',
          row_count: 4,
          matched_count: 2,
          mismatch_count: 1,
          unmatched_count: 1,
          uploaded_by: 'user-owner',
          uploaded_by_name: 'Demo Owner',
          created_at: '2026-11-05T10:00:00Z',
        },
      ],
      unverified: [],
      posts: [],
    })
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Past imports' }))
    expect(await screen.findByText('nov.csv')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /nov\.csv/ }))
    expect(await screen.findAllByTestId('statement-row')).toHaveLength(4)
  })
})
