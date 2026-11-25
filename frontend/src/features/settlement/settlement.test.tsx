import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { AppRouter } from '@/routes/AppRouter'

function me(role: 'owner' | 'caretaker') {
  return {
    id: `user-${role}`,
    phone: '9000000001',
    full_name: 'Demo',
    memberships: [{ org_id: 'org-1', organization_name: 'Demo PGs', role, assigned_property_ids: [] }],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const RESIDENT = {
  id: 'res-1',
  property_id: 'prop-1',
  full_name: 'Asha Rao',
  phone: '9111111111',
  current_stay: null,
  past_stays: [
    {
      id: 'stay-1',
      resident_id: 'res-1',
      room_label: '101',
      bed_label: 'A',
      stay_type: 'monthly',
      status: 'vacated',
      rent_paise: 800000,
      deposit_paise: 1600000,
      check_in_date: '2026-01-01',
      actual_vacate_date: '2026-11-20',
      updated_at: '2026-11-20T00:00:00Z',
    },
  ],
}

const PREVIEW = {
  deposit_held_paise: 1600000,
  exit_deduction_paise: 250000,
  pending_dues_paise: 123450,
  suggested_net_refund_paise: 1226550,
}

const CREATED = {
  id: 'set-1',
  net_refund_paise: 1176550,
  public_token: 'tok',
  settlement_url: 'https://app.example.com/receipt/tok',
  whatsapp_url: 'https://wa.me/919111111111?text=Hi%20Asha',
}

interface State {
  posts: unknown[]
  postResponse: { status: number; body: unknown }
}

function mockApi(state: State) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const req = input as Request
    const url = req.url
    if (url.includes('/settlement-preview')) return jsonResponse(PREVIEW)
    if (url.endsWith('/settlement') && req.method === 'POST') {
      state.posts.push(await req.clone().json())
      return jsonResponse(state.postResponse.body, state.postResponse.status)
    }
    if (url.includes('/residents/res-1')) return jsonResponse(RESIDENT)
    if (url.includes('/properties')) return jsonResponse([])
    return jsonResponse({})
  })
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

function signIn(role: 'owner' | 'caretaker') {
  window.localStorage.clear()
  window.localStorage.setItem(TOKEN_STORAGE_KEY, `${role}-jwt`)
  window.localStorage.setItem('pgcrm_me', JSON.stringify(me(role)))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
}

const PATH = '/owner/residents/res-1/settlement/stay-1'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Settlement', () => {
  beforeEach(() => signIn('owner'))

  test('[FE-50/AC1] preview shows the API numbers and the recorded net equals net_refund_paise', async () => {
    const state: State = { posts: [], postResponse: { status: 201, body: CREATED } }
    mockApi(state)
    renderAt(PATH)

    const card = await screen.findByLabelText('Settlement preview')
    expect(card.textContent).toContain('₹16,000')
    expect(card.textContent).toContain('₹2,500')
    expect(card.textContent).toContain('₹1,234.50')
    expect(card.textContent).toContain('₹12,265.50')

    fireEvent.click(screen.getByRole('button', { name: 'Confirm settlement' }))
    const done = await screen.findByLabelText('Settlement recorded')
    expect(done.textContent).toContain('₹11,765.50')
    expect(state.posts).toEqual([
      { other_deductions_paise: 0, other_deductions_note: null, refund_method: null, refund_utr: null },
    ])
  })

  test('[FE-50/AC2] other deductions above zero require a note', async () => {
    const state: State = { posts: [], postResponse: { status: 201, body: CREATED } }
    mockApi(state)
    renderAt(PATH)

    fireEvent.change(await screen.findByLabelText('Other deductions (optional)'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm settlement' }))
    expect(await screen.findByText('Add a note explaining the deduction.')).toBeInTheDocument()
    expect(state.posts).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('Reason for deduction'), { target: { value: 'Broken door' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm settlement' }))
    await screen.findByLabelText('Settlement recorded')
    expect(state.posts).toEqual([
      {
        other_deductions_paise: 50000,
        other_deductions_note: 'Broken door',
        refund_method: null,
        refund_utr: null,
      },
    ])
  })

  test('UPI refund needs a 12-digit UTR and an API error shows its message', async () => {
    const state: State = {
      posts: [],
      postResponse: { status: 409, body: { error: { code: 'conflict', message: 'Already settled' } } },
    }
    mockApi(state)
    renderAt(PATH)

    fireEvent.change(await screen.findByLabelText('Refund method'), { target: { value: 'upi' } })
    fireEvent.change(screen.getByLabelText('Refund UTR'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm settlement' }))
    expect(await screen.findByText('Enter the 12-digit UTR.')).toBeInTheDocument()
    expect(state.posts).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('Refund UTR'), { target: { value: '1234 5678 9012' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm settlement' }))
    await waitFor(() => expect(screen.getAllByText('Already settled').length).toBeGreaterThan(0))
    expect((state.posts[0] as { refund_utr: string }).refund_utr).toBe('123456789012')
  })

  test('[FE-50/AC3] the share links are the API whatsapp_url and settlement_url', async () => {
    mockApi({ posts: [], postResponse: { status: 201, body: CREATED } })
    renderAt(PATH)

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm settlement' }))
    const wa = await screen.findByRole('link', { name: /Share on WhatsApp/ })
    expect(wa).toHaveAttribute('href', CREATED.whatsapp_url)
    expect(wa).toHaveAttribute('target', '_blank')
    const link = screen.getByRole('link', { name: CREATED.settlement_url })
    expect(link).toHaveAttribute('href', CREATED.settlement_url)
    expect(screen.getByRole('button', { name: /Copy link/ })).toBeInTheDocument()
  })
})

describe('Settlement as caretaker', () => {
  beforeEach(() => signIn('caretaker'))

  test('is read-only with no confirm button', async () => {
    mockApi({ posts: [], postResponse: { status: 201, body: CREATED } })
    renderAt('/caretaker/residents/res-1/settlement/stay-1')
    await screen.findByLabelText('Settlement preview')
    expect(screen.queryByRole('button', { name: 'Confirm settlement' })).not.toBeInTheDocument()
  })

  test('resident detail links a vacated stay to the settlement', async () => {
    mockApi({ posts: [], postResponse: { status: 201, body: CREATED } })
    renderAt('/caretaker/residents/res-1')
    const link = await screen.findByRole('link', { name: 'View settlement' })
    expect(link).toHaveAttribute('href', '/caretaker/residents/res-1/settlement/stay-1')
  })
})
