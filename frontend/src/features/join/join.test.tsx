import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AppRouter } from '@/routes/AppRouter'

const SAMPLE_INFO = {
  property_name: 'Sunrise HSR',
  locality: 'HSR Layout',
  organization_name: 'Sunrise Stays',
  house_rules: 'No smoking indoors.\nQuiet hours after 11 pm.',
  exit_deduction_paise: 150000,
  short_term_daily_rate_paise: 80000,
  upi_vpa: 'sunrise@okbank',
  upi_payee_name: 'Sunrise Stays',
  rent_due_day: 5,
  security_deposit_paise: 800000,
  maintenance_charge_paise: 150000,
  notice_deadline_day: 5,
}

function renderJoin(slug = 'sunrise-hsr') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/join/${slug}`]}>
          <Routes>
            <Route path="*" element={<AppRouter />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function mockJoinFetch(options?: {
  infoStatus?: number
  submitStatus?: number
  submitBody?: Record<string, unknown>
  onSubmit?: (body: Record<string, unknown>) => void
}) {
  const infoStatus = options?.infoStatus ?? 200
  const submitStatus = options?.submitStatus ?? 201
  let uploadCount = 0

  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')

    if (url.includes('/api/v1/public/join/') && url.endsWith('/uploads') && method === 'POST') {
      uploadCount += 1
      const key = `onboarding/prop-1/file-${uploadCount}.jpg`
      return new Response(
        JSON.stringify({
          object_key: key,
          upload_url: `https://storage.example.com/${key}`,
          expires_in: 300,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    if (url.startsWith('https://storage.example.com/') && method === 'PUT') {
      return new Response(null, { status: 200 })
    }

    if (url.includes('/api/v1/public/join/') && method === 'GET') {
      if (infoStatus === 404) {
        return new Response(
          JSON.stringify({ error: { code: 'not_found', message: 'This QR code is not active' } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify(SAMPLE_INFO), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.includes('/api/v1/public/join/') && method === 'POST') {
      const rawBody =
        typeof init?.body === 'string'
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : '{}'
      const parsed = JSON.parse(rawBody) as Record<string, unknown>
      options?.onSubmit?.(parsed)
      if (submitStatus >= 400) {
        return new Response(JSON.stringify(options?.submitBody ?? { error: { code: 'conflict', message: 'A request from this phone is already waiting for approval' } }), {
          status: submitStatus,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify(options?.submitBody ?? { request_id: '12345678-90ab-cdef-1234-567890abcdef' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response('Not found', { status: 404 })
  })
}

async function fillStep1And2() {
  fireEvent.change(await screen.findByLabelText(/Full name/), { target: { value: 'Aarav Sharma' } })
  fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '9876543210' } })
  fireEvent.change(screen.getByLabelText(/Permanent address/), {
    target: { value: '12 MG Road, Bengaluru' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  fireEvent.change(await screen.findByLabelText(/Emergency contact name/), {
    target: { value: 'Priya Sharma' },
  })
  fireEvent.change(screen.getByLabelText(/Emergency contact phone/), {
    target: { value: '9876500000' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
}

describe('Public /join/:slug onboarding form', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-20/AC1] valid slug loads property name, official charges and the notice rule', async () => {
    mockJoinFetch()
    renderJoin('sunrise-hsr')

    expect(await screen.findByRole('heading', { name: 'Sunrise HSR' })).toBeInTheDocument()
    expect(screen.getByText('Sunrise Stays')).toBeInTheDocument()

    await fillStep1And2()

    // Step 3: upload both photos to reach Step 4
    fireEvent.change(await screen.findByLabelText(/ID number/), { target: { value: '123412341234' } })
    const idFile = new File(['id-bytes'], 'id.jpg', { type: 'image/jpeg' })
    const selfieFile = new File(['selfie-bytes'], 'selfie.jpg', { type: 'image/jpeg' })
    fireEvent.change(document.getElementById('join-id-photo')!, { target: { files: [idFile] } })
    fireEvent.change(document.getElementById('join-selfie')!, { target: { files: [selfieFile] } })

    await screen.findByText(/ID photo uploaded/)
    await screen.findByText(/Live selfie uploaded/)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/Security deposit \(refundable\)/)).toBeInTheDocument()
    expect(screen.getByText('₹8,000')).toBeInTheDocument()
    expect(screen.getByText(/Maintenance charge \(one-time, not refundable\)/)).toBeInTheDocument()
    expect(screen.getByText(/Rent is due by the 5th of every month/)).toBeInTheDocument()
    expect(
      screen.getByText(/To leave at the end of a month, tell us on or before the 5th of that month/),
    ).toBeInTheDocument()
    expect(screen.getByText(/will be deducted from your deposit at move-out/)).toBeInTheDocument()
    expect(screen.getByText(/No smoking indoors/)).toBeInTheDocument()
  })

  test('[FE-20/AC2] unknown slug shows inactive QR message', async () => {
    mockJoinFetch({ infoStatus: 404 })
    renderJoin('bad-slug')

    expect(
      await screen.findByRole('heading', {
        name: 'This QR code is not active. Please ask the reception.',
      }),
    ).toBeInTheDocument()
  })

  test('[FE-20/AC4] selfie input has capture="user" and no gallery option', async () => {
    mockJoinFetch()
    renderJoin('sunrise-hsr')
    await screen.findByRole('heading', { name: 'Sunrise HSR' })
    await fillStep1And2()

    const selfieInput = document.getElementById('join-selfie') as HTMLInputElement
    expect(selfieInput).toHaveAttribute('type', 'file')
    expect(selfieInput).toHaveAttribute('accept', 'image/*')
    expect(selfieInput).toHaveAttribute('capture', 'user')

    const idInput = document.getElementById('join-id-photo') as HTMLInputElement
    expect(idInput).toHaveAttribute('accept', 'image/*')
    expect(idInput).not.toHaveAttribute('capture')
  })

  test('[FE-20/AC5] turning on Foreign national makes passport, visa number and visa expiry required', async () => {
    mockJoinFetch()
    renderJoin('sunrise-hsr')
    await screen.findByRole('heading', { name: 'Sunrise HSR' })
    await fillStep1And2()

    fireEvent.change(await screen.findByLabelText(/ID number/), { target: { value: 'P1234567' } })
    const idFile = new File(['id'], 'id.jpg', { type: 'image/jpeg' })
    const selfieFile = new File(['selfie'], 'selfie.jpg', { type: 'image/jpeg' })
    fireEvent.change(document.getElementById('join-id-photo')!, { target: { files: [idFile] } })
    fireEvent.change(document.getElementById('join-selfie')!, { target: { files: [selfieFile] } })
    await screen.findByText(/ID photo uploaded/)
    await screen.findByText(/Live selfie uploaded/)

    fireEvent.click(screen.getByLabelText(/Foreign national\?/))
    expect(screen.getByLabelText(/Passport number/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Visa number/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Visa expiry/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Passport number is required for foreign nationals')).toBeInTheDocument()
    expect(screen.getByText('Visa number is required for foreign nationals')).toBeInTheDocument()
    expect(screen.getByText('Visa expiry date is required for foreign nationals')).toBeInTheDocument()
  })

  test('[FE-20/AC6] entered data survives a page reload via sessionStorage', async () => {
    mockJoinFetch()
    const first = renderJoin('sunrise-hsr')
    fireEvent.change(await screen.findByLabelText(/Full name/), { target: { value: 'Meera Nair' } })
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '9876543211' } })
    fireEvent.change(screen.getByLabelText(/Permanent address/), {
      target: { value: '45 Indiranagar, Bengaluru' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Emergency contact name/)

    first.unmount()

    renderJoin('sunrise-hsr')
    expect(await screen.findByLabelText(/Emergency contact name/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText(/Full name/)).toHaveValue('Meera Nair')
    expect(screen.getByLabelText(/Mobile number/)).toHaveValue('9876543211')
  })

  test('[FE-20/AC3] full submission with both photos shows success screen with short request id and clears draft', async () => {
    const submitted: Array<Record<string, unknown>> = []
    mockJoinFetch({
      onSubmit: (body) => {
        submitted.push(body)
      },
    })

    renderJoin('sunrise-hsr')
    await screen.findByRole('heading', { name: 'Sunrise HSR' })
    await fillStep1And2()

    fireEvent.change(await screen.findByLabelText(/ID number/), { target: { value: 'ABCDE1234F' } })
    const idFile = new File(['id'], 'id.jpg', { type: 'image/jpeg' })
    const selfieFile = new File(['selfie'], 'selfie.jpg', { type: 'image/jpeg' })
    fireEvent.change(document.getElementById('join-id-photo')!, { target: { files: [idFile] } })
    fireEvent.change(document.getElementById('join-selfie')!, { target: { files: [selfieFile] } })
    await screen.findByText(/ID photo uploaded/)
    await screen.findByText(/Live selfie uploaded/)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(await screen.findByLabelText(/I accept the house rules and this exit deduction/))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(
      await screen.findByRole('heading', { name: 'Done! Show this screen to the caretaker.' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('request-id')).toHaveTextContent('12345678')

    await waitFor(() => {
      expect(submitted).toHaveLength(1)
    })
    expect(submitted[0]?.accepted_exit_deduction_paise).toBe(150000)
    expect(submitted[0]?.accepted_rules).toBe(true)
    expect(window.sessionStorage.getItem('pgcrm_join_draft:sunrise-hsr')).toBeNull()
  })
})
