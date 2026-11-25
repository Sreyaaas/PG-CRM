import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AppRouter } from '@/routes/AppRouter'

const UPI_URI = 'upi://pay?pa=sunrise@okbank&pn=Sunrise%20Stays&am=8000.00&cu=INR&tn=INV-0007'

const RECEIPT = {
  type: 'payment_receipt',
  receipt_no: 'a1b2c3d4',
  amount_paise: 800000,
  method: 'upi',
  utr_number: '412345678901',
  status: 'verified',
  received_at: '2026-11-05T09:30:00Z',
  resident_name: 'Asha Rao',
  property_name: 'Sunrise HSR',
  invoice_no: 'INV-0007',
  period_start: '2026-11-01',
  period_end: '2026-11-30',
}

const INVOICE = {
  type: 'invoice',
  invoice_no: 'INV-0007',
  kind: 'rent',
  amount_paise: 1000000,
  paid_paise: 200000,
  outstanding_paise: 800000,
  due_date: '2026-11-05',
  period_start: '2026-11-01',
  period_end: '2026-11-30',
  status: null,
  resident_name: 'Asha Rao',
  property_name: 'Sunrise HSR',
  upi_vpa: 'sunrise@okbank',
  upi_payee_name: 'Sunrise Stays',
  upi_mcc: '6513',
  fallback_upi_id: 'fallback@okbank',
  bank_details: 'Sunrise Stays\nA/c 1234567890\nIFSC HDFC0001234',
  upi_uri: UPI_URI,
}

const SETTLEMENT = {
  type: 'exit_settlement',
  resident_name: 'Asha Rao',
  property_name: 'Sunrise HSR',
  check_in_date: '2026-01-10',
  vacate_date: '2026-11-30',
  deposit_paise: 1000000,
  exit_deduction_paise: 150000,
  other_deductions_paise: 20000,
  other_deductions_note: 'Broken chair',
  pending_dues_paise: 0,
  net_refund_paise: 830000,
  refund_method: 'upi',
  refund_utr: '412345678999',
  settled_at: '2026-11-30T10:00:00Z',
}

function mockDoc(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    status === 200
      ? new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      : new Response(null, { status }),
  )
}

function renderReceipt(token = 'a'.repeat(64)) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/receipt/${token}`]}>
        <AppRouter />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FE-32 public receipt', () => {
  test('[FE-32/AC1] payment receipt shows amount, method, UTR and status', async () => {
    mockDoc(RECEIPT)
    renderReceipt()
    expect(await screen.findByRole('heading', { name: 'Payment receipt' })).toBeInTheDocument()
    expect(screen.getAllByText(/8,000/).length).toBeGreaterThan(0)
    expect(screen.getByText('UPI')).toBeInTheDocument()
    expect(screen.getByText('4123 4567 8901')).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('Sunrise HSR')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download \/ print/i })).toBeInTheDocument()
  })

  test('[FE-32/AC1] provisional receipt says verification is pending', async () => {
    mockDoc({ ...RECEIPT, status: 'provisional' })
    renderReceipt()
    expect(await screen.findByText('Payment received; verification pending.')).toBeInTheDocument()
  })

  test('[FE-32/AC2] invoice shows a QR of upi_uri and Copy buttons for UPI ID and bank details', async () => {
    mockDoc(INVOICE)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderReceipt()

    const qr = await screen.findByRole('img', { name: 'UPI QR code for this invoice' })
    await waitFor(() => expect(qr.getAttribute('src') ?? '').toMatch(/^data:image\/png/))
    expect(screen.getByText("Scan with another phone's camera / UPI app")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /pay with upi app/i })).toHaveAttribute('href', UPI_URI)
    // Amount due = amount - paid
    expect(screen.getAllByText(/8,000/).length).toBeGreaterThan(0)

    // fallback_upi_id wins over upi_vpa
    expect(screen.getByText('fallback@okbank')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy UPI ID' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('fallback@okbank'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Bank details' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(INVOICE.bank_details))
  })

  test('[FE-32/AC2] invoice without upi_uri still offers the UPI ID and no QR', async () => {
    mockDoc({ ...INVOICE, upi_uri: null, fallback_upi_id: null })
    renderReceipt()
    expect(await screen.findByText('sunrise@okbank')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /UPI QR/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /pay with upi app/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy UPI ID' })).toBeInTheDocument()
  })

  test('[FE-32/AC3] exit settlement shows net refund in green', async () => {
    mockDoc(SETTLEMENT)
    renderReceipt()
    expect(await screen.findByRole('heading', { name: 'Exit settlement' })).toBeInTheDocument()
    expect(screen.getAllByText('Net refund').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/8,300/).length).toBeGreaterThan(0)
    expect(screen.getByText('Broken chair')).toBeInTheDocument()
    const hero = screen.getAllByText(/8,300/)[0].parentElement as HTMLElement
    expect(hero.className).toContain('text-success-ink')
  })

  test('[FE-32/AC3] negative net refund shows amount payable in red', async () => {
    mockDoc({ ...SETTLEMENT, net_refund_paise: -250000, pending_dues_paise: 1400000 })
    renderReceipt()
    expect((await screen.findAllByText('Amount payable')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Net refund')).not.toBeInTheDocument()
    const hero = screen.getAllByText(/2,500/)[0].parentElement as HTMLElement
    expect(hero.className).toContain('text-danger-ink')
  })

  test('[FE-32/AC4] invalid token shows the invalid or expired message', async () => {
    mockDoc(null, 404)
    renderReceipt('nope')
    expect(await screen.findByText('This link is invalid or expired.')).toBeInTheDocument()
  })

  test('[FE-32/AC5] page is noindex, sends no auth and loads no third-party scripts', async () => {
    const spy = mockDoc(RECEIPT)
    localStorage.setItem('pgcrm_access_token', 'secret-token')
    renderReceipt()
    await screen.findByRole('heading', { name: 'Payment receipt' })
    expect(document.head.querySelector('meta[name="robots"][content="noindex"]')).not.toBeNull()
    const scripts = Array.from(document.querySelectorAll('script[src]'))
    expect(scripts.filter((s) => /^https?:\/\//.test(s.getAttribute('src') ?? ''))).toHaveLength(0)
    const req = spy.mock.calls[0][0] as Request
    expect(req.headers.get('Authorization')).toBeNull()
    expect(req.url).toContain('/api/v1/public/documents/')
    localStorage.removeItem('pgcrm_access_token')
    cleanup()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })
})
