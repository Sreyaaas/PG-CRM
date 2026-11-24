import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/features/auth/session'
import { AppRouter } from '@/routes/AppRouter'

const toDataURL = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,AAAA'))
vi.mock('qrcode', () => ({ default: { toDataURL } }))

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

function makeProperty(over: Record<string, unknown> = {}) {
  return {
    id: 'prop-1',
    name: 'Sunrise PG',
    address: null,
    locality: 'Koramangala',
    qr_slug: 'sunrise-abc',
    upi_vpa: 'sunrise@okbank',
    upi_payee_name: 'Sunrise Stays',
    upi_mcc: null,
    fallback_upi_id: null,
    bank_details: null,
    short_term_daily_rate_paise: 45000,
    exit_deduction_paise: 100000,
    house_rules: 'No smoking.\nGate closes at 11 pm.',
    rent_due_day: 5,
    security_deposit_paise: 800000,
    maintenance_charge_paise: 150000,
    notice_deadline_day: 5,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function mockProperty(property: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(JSON.stringify(property), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

function renderPoster() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/owner/properties/prop-1/poster']}>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('Reception QR poster', () => {
  beforeEach(() => {
    window.localStorage.clear()
    toDataURL.mockClear()
    signIn()
    vi.stubEnv('VITE_PUBLIC_APP_URL', 'https://app.example.com')
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  test('[FE-13/AC1] QR encodes VITE_PUBLIC_APP_URL/join/<qr_slug> at error level M and the same URL is printed', async () => {
    mockProperty(makeProperty())
    renderPoster()

    const printed = await screen.findByTestId('poster-url')
    expect(printed).toHaveTextContent('https://app.example.com/join/sunrise-abc')
    await screen.findByAltText(/qr code to check in at sunrise pg/i)

    expect(toDataURL).toHaveBeenCalledTimes(1)
    const [encoded, opts] = toDataURL.mock.calls[0] as unknown as [string, { errorCorrectionLevel: string }]
    expect(encoded).toBe('https://app.example.com/join/sunrise-abc')
    expect(encoded).toBe(printed.textContent)
    expect(opts.errorCorrectionLevel).toBe('M')
  })

  test('[FE-13/AC2] poster shows the UPI warning box, security deposit, maintenance charge and exit deduction', async () => {
    mockProperty(makeProperty())
    renderPoster()

    const poster = await screen.findByRole('article', { name: /reception qr poster/i })
    expect(within(poster).getByText('Scan to check in')).toBeInTheDocument()

    const box = within(poster).getByTestId('upi-warning')
    expect(box).toHaveTextContent('Pay rent only to this UPI ID: sunrise@okbank (Sunrise Stays)')
    expect(box).toHaveTextContent('Never pay staff personally.')

    const row = (label: string) => within(poster).getByText(label).closest('div') as HTMLElement
    expect(row('Security deposit')).toHaveTextContent('8,000')
    expect(row('Maintenance charge')).toHaveTextContent('1,500')
    expect(row('Exit deduction')).toHaveTextContent('1,000')
    expect(row('Daily rate (short stay)')).toHaveTextContent('450')
    expect(poster).toHaveTextContent('No smoking.')
  })
})
