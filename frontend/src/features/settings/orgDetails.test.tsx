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
  memberships: [{ org_id: 'org-1', organization_name: 'Demo PGs', role: 'owner', assigned_property_ids: [] }],
}
const ORG = { id: 'org-1', name: 'Demo PGs', gstin: null, whatsapp_language: 'en', receipt_footer: null, created_at: '2026-11-01T00:00:00Z' }

const RESIDENT = {
  id: 'res-1', property_id: 'prop-1', onboarding_request_id: null, full_name: 'Arjun Menon', phone: '9876543210',
  email: null, date_of_birth: null, permanent_address: null, occupation: 'working', employer_or_college: 'Infosys',
  emergency_contact_name: 'Ramesh', emergency_contact_phone: '9876500000', id_doc_type: 'aadhaar', id_doc_number: null,
  id_doc_url: null, selfie_url: null, url_expires_in: null, is_foreign_national: false, passport_number: null,
  visa_number: null, visa_expiry: null, emergency_contact_relation: null, food_preference: null, vehicle_number: null,
  police_verification_status: 'pending', police_verification_date: null, created_at: '2026-11-01T00:00:00Z',
  current_stay: null, past_stays: [],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockApi(opts: { orgPatchError?: string } = {}) {
  const patches: { path: string; body: Record<string, unknown> }[] = []
  let resident = { ...RESIDENT }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const req = input as Request
    const path = new URL(req.url).pathname
    if (path.endsWith('/organization') && req.method === 'GET') return json(ORG)
    if (path.endsWith('/organization') && req.method === 'PATCH') {
      const body = (await req.clone().json()) as Record<string, unknown>
      patches.push({ path, body })
      if (opts.orgPatchError) return json({ error: { code: 'bad', message: opts.orgPatchError } }, 422)
      return json({ ...ORG, ...body })
    }
    if (path.endsWith('/residents/res-1') && req.method === 'GET') return json(resident)
    if (path.endsWith('/residents/res-1/profile') && req.method === 'PATCH') {
      const body = (await req.clone().json()) as Record<string, unknown>
      patches.push({ path, body })
      resident = { ...resident, ...(body as Partial<typeof RESIDENT>) } as typeof RESIDENT
      return json(resident)
    }
    if (path.endsWith('/complaints')) {
      return json([{ id: 'c1', property_id: 'prop-1', property_name: 'Sunrise HSR', room_id: null, room_label: null, bed_id: null, bed_label: null, resident_id: null, resident_name: 'Priya', category: 'wifi', title: 'Wi-Fi down on 2nd floor', note: null, priority: 'urgent', status: 'open', photo_path: null, assigned_to: null, assigned_to_name: null, created_by: 'u', created_by_name: 'Ravi', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), resolved_by: null, resolved_at: null, resolution_note: null }])
    }
    if (path.endsWith('/activity')) {
      return json([{ id: 1, at: new Date().toISOString(), actor_id: 'u', actor_name: 'Ravi', entity_type: 'payment', entity_id: null, action: 'insert', property_id: null, summary: 'Ravi logged ₹6,000 cash from Arjun' }])
    }
    return json([])
  })
  return patches
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

describe('Business details, resident profile, activity', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-06/AC4] owner saves business name, GSTIN, WhatsApp language and receipt footer', async () => {
    const patches = mockApi()
    renderAt('/owner/settings')
    const name = await screen.findByLabelText('Business name')
    fireEvent.change(name, { target: { value: 'Sunrise Living PGs' } })
    fireEvent.change(screen.getByLabelText('GSTIN (optional)'), { target: { value: '29abcde1234f1z5' } })
    fireEvent.change(screen.getByLabelText('WhatsApp message language'), { target: { value: 'kn' } })
    fireEvent.change(screen.getByLabelText('Receipt footer (optional)'), { target: { value: 'Thank you' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].body).toEqual({
      name: 'Sunrise Living PGs', gstin: '29ABCDE1234F1Z5', whatsapp_language: 'kn', receipt_footer: 'Thank you',
    })
  })

  test('[FE-06/AC4] an invalid GSTIN is not sent and the API error message is shown', async () => {
    const patches = mockApi({ orgPatchError: 'That name is too short.' })
    renderAt('/owner/settings')
    fireEvent.change(await screen.findByLabelText('GSTIN (optional)'), { target: { value: '12345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    expect(await screen.findByText('GSTIN should be 15 characters, like 29ABCDE1234F1Z5.')).toBeInTheDocument()
    expect(patches).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('GSTIN (optional)'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Ok PGs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    expect(await screen.findByText('That name is too short.')).toBeInTheDocument()
  })

  test('[FE-06/AC5] editing a resident profile saves police verification with a date, food and vehicle', async () => {
    const patches = mockApi()
    renderAt('/owner/residents/res-1')
    const details = await screen.findByLabelText('Resident details')
    fireEvent.click(within(details).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit profile' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verified' }))
    expect(within(dialog).getByLabelText('Verified on')).toHaveValue(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()),
    )
    fireEvent.change(within(dialog).getByLabelText('Verified on'), { target: { value: '2026-11-20' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Veg' }))
    fireEvent.change(within(dialog).getByLabelText('Vehicle number (optional)'), { target: { value: 'ka01ab1234' } })
    fireEvent.change(within(dialog).getByLabelText('Emergency contact is their…'), { target: { value: 'Father' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({
      path: '/api/v1/residents/res-1/profile',
      body: {
        food_preference: 'veg', vehicle_number: 'KA01AB1234', emergency_contact_relation: 'Father',
        police_verification_status: 'verified', police_verification_date: '2026-11-20',
      },
    })
  })

  test('[FE-06/AC6] owner home shows open complaints and recent staff activity', async () => {
    mockApi()
    renderAt('/owner')
    const complaints = await screen.findByLabelText('Open complaints')
    expect(await within(complaints).findByText('Wi-Fi down on 2nd floor')).toBeInTheDocument()
    expect(within(complaints).getByText('1 urgent · urgent and longest waiting first')).toBeInTheDocument()
    expect(await screen.findByText('Ravi logged ₹6,000 cash from Arjun')).toBeInTheDocument()
  })
})
