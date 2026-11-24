import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AppRouter } from '@/routes/AppRouter'
import { AuthProvider } from './AuthContext'
import { ORG_STORAGE_KEY, TOKEN_STORAGE_KEY } from './session'

function renderApp(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  })

  const view = render(
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

  return { ...view, queryClient }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const OWNER_TOKEN_RESPONSE = {
  access_token: 'owner-jwt',
  token_type: 'bearer',
  expires_in: 43200,
  me: {
    id: 'user-owner',
    phone: '9000000001',
    full_name: 'Demo Owner',
    memberships: [
      {
        org_id: 'org-1',
        organization_name: 'Demo PGs',
        role: 'owner',
        assigned_property_ids: [],
      },
    ],
  },
}

const CARETAKER_TOKEN_RESPONSE = {
  access_token: 'caretaker-jwt',
  token_type: 'bearer',
  expires_in: 43200,
  me: {
    id: 'user-caretaker',
    phone: '9000000002',
    full_name: 'Ravi (Caretaker)',
    memberships: [
      {
        org_id: 'org-1',
        organization_name: 'Demo PGs',
        role: 'caretaker',
        assigned_property_ids: ['prop-1'],
      },
    ],
  },
}

const MULTI_ORG_TOKEN_RESPONSE = {
  access_token: 'multi-jwt',
  token_type: 'bearer',
  expires_in: 43200,
  me: {
    id: 'user-multi',
    phone: '9000000003',
    full_name: 'Multi User',
    memberships: [
      {
        org_id: 'org-1',
        organization_name: 'Sunrise Group',
        role: 'owner',
        assigned_property_ids: [],
      },
      {
        org_id: 'org-2',
        organization_name: 'Lakeview Group',
        role: 'caretaker',
        assigned_property_ids: ['prop-2'],
      },
    ],
  },
}

describe('Auth, login, org picker, and session guards', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('[FE-02/AC1] owner login lands in owner shell and caretaker login lands in caretaker shell', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
      if (url.endsWith('/auth/login')) return jsonResponse(OWNER_TOKEN_RESPONSE)
      if (url.endsWith('/properties')) return jsonResponse([])
      return jsonResponse({})
    })

    renderApp(['/login'])
    await user.type(screen.getByLabelText(/mobile number/i), '9000000001')
    await user.type(screen.getByLabelText(/password/i), 'devpass123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/Owner workspace/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Owner navigation', { exact: false }) || screen.getByLabelText('Owner sidebar')).toBeInTheDocument()

    // Now test caretaker login
    cleanup()
    window.localStorage.clear()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
      if (url.endsWith('/auth/login')) return jsonResponse(CARETAKER_TOKEN_RESPONSE)
      if (url.endsWith('/properties')) return jsonResponse([])
      return jsonResponse({})
    })

    renderApp(['/login'])
    await user.type(screen.getByLabelText(/mobile number/i), '9000000002')
    await user.type(screen.getByLabelText(/password/i), 'devpass123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/Caretaker workspace/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Caretaker navigation')).toBeInTheDocument()
  })

  test('[FE-02/AC2] wrong password shows the API error message', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
      if (url.endsWith('/auth/login')) {
        return jsonResponse(
          { error: { code: 'unauthenticated', message: 'Wrong phone number or password' } },
          401,
        )
      }
      return jsonResponse({})
    })

    renderApp(['/login'])
    await user.type(screen.getByLabelText(/mobile number/i), '9000000001')
    await user.type(screen.getByLabelText(/password/i), 'wrong-pass')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((el) => el.textContent?.includes('Wrong phone number or password'))).toBe(
      true,
    )
    // Should remain on login (no token saved)
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })

  test('[FE-02/AC3] API 401 sends authenticated user to login with "Session expired"', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, OWNER_TOKEN_RESPONSE.access_token)
    window.localStorage.setItem('pgcrm_me', JSON.stringify(OWNER_TOKEN_RESPONSE.me))
    window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
      if (url.endsWith('/properties')) {
        return jsonResponse({ error: { code: 'unauthenticated', message: 'Token expired' } }, 401)
      }
      return jsonResponse({})
    })

    renderApp(['/owner'])

    expect(await screen.findByText(/Sign in to PG-CRM/i)).toBeInTheDocument()
    expect(await screen.findByText('Session expired')).toBeInTheDocument()
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(ORG_STORAGE_KEY)).toBeNull()
  })

  test('[FE-02/AC4] single membership auto-selects org and multiple memberships show the picker', async () => {
    const user = userEvent.setup()

    // Single membership -> auto-selects org-1 and skips picker
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
      if (url.endsWith('/auth/login')) return jsonResponse(OWNER_TOKEN_RESPONSE)
      if (url.endsWith('/properties')) return jsonResponse([])
      return jsonResponse({})
    })

    renderApp(['/login'])
    await user.type(screen.getByLabelText(/mobile number/i), '9000000001')
    await user.type(screen.getByLabelText(/password/i), 'devpass123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/Owner workspace/i)).toBeInTheDocument()
    expect(window.localStorage.getItem(ORG_STORAGE_KEY)).toBe('org-1')

    // Multiple memberships -> shows org picker, clicking selects org and navigates to its role shell
    cleanup()
    window.localStorage.clear()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
      if (url.endsWith('/auth/login')) return jsonResponse(MULTI_ORG_TOKEN_RESPONSE)
      if (url.endsWith('/properties')) return jsonResponse([])
      return jsonResponse({})
    })

    renderApp(['/login'])
    await user.type(screen.getByLabelText(/mobile number/i), '9000000003')
    await user.type(screen.getByLabelText(/password/i), 'devpass123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Select organization')).toBeInTheDocument()
    expect(screen.getByText('Sunrise Group')).toBeInTheDocument()
    expect(screen.getByText('Lakeview Group')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Lakeview Group/i }))
    expect(await screen.findByText(/Caretaker workspace/i)).toBeInTheDocument()
    expect(window.localStorage.getItem(ORG_STORAGE_KEY)).toBe('org-2')
  })

  test('[FE-02/AC5] logout clears token, selected org, and TanStack Query cache', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(TOKEN_STORAGE_KEY, OWNER_TOKEN_RESPONSE.access_token)
    window.localStorage.setItem('pgcrm_me', JSON.stringify(OWNER_TOKEN_RESPONSE.me))
    window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })
      if (url.endsWith('/properties')) {
        return jsonResponse([{ id: 'p1', name: 'Sunrise HSR', locality: 'HSR', upi_vpa: null }])
      }
      return jsonResponse({})
    })

    const { queryClient } = renderApp(['/owner'])

    expect(await screen.findByText('Sunrise HSR')).toBeInTheDocument()
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0)

    const logoutButtons = screen.getAllByRole('button', { name: /log out/i })
    await user.click(logoutButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/Sign in to PG-CRM/i)).toBeInTheDocument()
    })
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(ORG_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem('pgcrm_me')).toBeNull()
    expect(queryClient.getQueryCache().getAll().length).toBe(0)
  })
})
