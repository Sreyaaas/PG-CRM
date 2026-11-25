import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToastProvider } from '@/components/Toast'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ME_STORAGE_KEY, ORG_STORAGE_KEY, TOKEN_STORAGE_KEY, type Me } from '@/features/auth/session'
import { AppRouter } from '@/routes/AppRouter'
import {
  DENSITY_STORAGE_KEY,
  RADIUS_STORAGE_KEY,
  THEME_STORAGE_KEY,
  initAppearance,
} from './appearance'
import { resetInstallPromptForTest } from './installPrompt'

const OWNER_ME: Me = {
  id: 'user-owner',
  phone: '9000000001',
  full_name: 'Meera Nair',
  memberships: [
    {
      org_id: 'org-1',
      organization_name: 'Demo PGs',
      role: 'owner',
      assigned_property_ids: [],
    },
  ],
}

const CARETAKER_ME: Me = {
  id: 'user-caretaker',
  phone: '9000000002',
  full_name: 'Ravi Kumar',
  memberships: [
    {
      org_id: 'org-1',
      organization_name: 'Demo PGs',
      role: 'caretaker',
      assigned_property_ids: ['prop-1'],
    },
  ],
}

function seedSession(me: Me = OWNER_ME) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'test-jwt')
  window.localStorage.setItem(ME_STORAGE_KEY, JSON.stringify(me))
  window.localStorage.setItem(ORG_STORAGE_KEY, 'org-1')
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderApp(initialEntries: string[] = ['/owner/settings']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
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

const defaultUserAgent = window.navigator.userAgent
const defaultMatchMedia = window.matchMedia

function mockDefaultFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    if (url.includes('/api/v1/properties')) {
      return jsonResponse([{ id: 'prop-1', name: 'Sunrise PG' }])
    }
    if (url.includes('/api/v1/staff')) {
      return jsonResponse([{ user_id: 'u-1', full_name: 'Ravi', role: 'caretaker' }])
    }
    if (url.includes('/api/v1/discount-requests')) {
      return jsonResponse([])
    }
    return jsonResponse({})
  })
}

beforeEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.density
  delete document.documentElement.dataset.radius
  resetInstallPromptForTest()
  Object.defineProperty(window.navigator, 'userAgent', { value: defaultUserAgent, configurable: true })
  Object.defineProperty(window.navigator, 'standalone', { value: undefined, configurable: true })
  window.matchMedia = defaultMatchMedia
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Settings (FE-05)', () => {
  test('links to settings from avatar menu and More page for owner and caretaker', () => {
    mockDefaultFetch()
    seedSession(OWNER_ME)
    renderApp(['/owner/more'])

    expect(screen.getByRole('link', { name: /Settings/ })).toHaveAttribute('href', '/owner/settings')
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/owner/settings',
    )

    cleanup()
    seedSession(CARETAKER_ME)
    renderApp(['/caretaker/more'])
    expect(screen.getByRole('link', { name: /Settings/ })).toHaveAttribute('href', '/caretaker/settings')
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/caretaker/settings',
    )
  })

  test('[FE-05/AC1] Change password sends current + new and shows the API error message on failure', async () => {
    seedSession(OWNER_ME)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      if (url.includes('/api/v1/auth/change-password')) {
        return jsonResponse(
          { error: { code: 'invalid_password', message: 'Current password is incorrect' } },
          422,
        )
      }
      if (url.includes('/api/v1/properties')) return jsonResponse([])
      if (url.includes('/api/v1/staff')) return jsonResponse([])
      if (url.includes('/api/v1/discount-requests')) return jsonResponse([])
      return jsonResponse({}, init ? 200 : 200)
    })

    renderApp(['/owner/settings'])

    const currentInput = screen.getByLabelText('Current password') as HTMLInputElement
    const newInput = screen.getByLabelText('New password') as HTMLInputElement
    expect(currentInput.type).toBe('password')
    expect(newInput.type).toBe('password')

    fireEvent.click(screen.getByRole('button', { name: 'Show current password' }))
    expect(currentInput.type).toBe('text')

    fireEvent.change(currentInput, { target: { value: 'wrong-pass' } })
    fireEvent.change(newInput, { target: { value: 'new-pass-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Current password is incorrect')
    })

    const changeCall = fetchMock.mock.calls.find(([req]) => {
      const url = typeof req === 'string' ? req : req instanceof Request ? req.url : String(req)
      return url.includes('/api/v1/auth/change-password')
    })
    expect(changeCall).toBeDefined()
    const req = changeCall![0] as Request
    expect(await req.clone().json()).toEqual({
      current_password: 'wrong-pass',
      new_password: 'new-pass-123',
    })
  })

  test('[FE-05/AC2] Sign out of all devices asks for confirmation, calls the API, then returns to login', async () => {
    seedSession(OWNER_ME)
    let logoutAllCalled = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      if (url.includes('/api/v1/auth/logout-all')) {
        logoutAllCalled = true
        return new Response(null, { status: 204 })
      }
      if (url.includes('/api/v1/properties')) return jsonResponse([])
      if (url.includes('/api/v1/staff')) return jsonResponse([])
      if (url.includes('/api/v1/discount-requests')) return jsonResponse([])
      return jsonResponse({})
    })

    renderApp(['/owner/settings'])

    fireEvent.click(screen.getByRole('button', { name: 'Sign out of all devices' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign out of all devices?' })
    expect(logoutAllCalled).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }))

    await waitFor(() => {
      expect(logoutAllCalled).toBe(true)
      expect(screen.getByRole('heading', { name: 'Sign in to PG-CRM' })).toBeInTheDocument()
    })
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })

  test('[FE-05/AC3] Theme, density and corner choices apply immediately and survive a reload', () => {
    mockDefaultFetch()
    seedSession(OWNER_ME)
    renderApp(['/owner/settings'])

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sharp' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(document.documentElement.dataset.radius).toBe('sharp')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact')
    expect(window.localStorage.getItem(RADIUS_STORAGE_KEY)).toBe('sharp')

    // Simulate reload: clear DOM attributes and re-run boot initializer
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.density
    delete document.documentElement.dataset.radius

    initAppearance()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(document.documentElement.dataset.radius).toBe('sharp')
  })

  test('[FE-05/AC4] Install section shows iOS steps, Install button on beforeinstallprompt, and nothing when standalone', async () => {
    mockDefaultFetch()
    seedSession(OWNER_ME)

    // 1. iOS Safari
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      configurable: true,
    })
    renderApp(['/owner/settings'])
    const iosSection = screen.getByTestId('install-app-section')
    expect(iosSection).toHaveTextContent('Share')
    expect(iosSection).toHaveTextContent('Add to Home Screen')
    expect(iosSection).toHaveTextContent('Add')

    // 2. Android/Chrome beforeinstallprompt
    cleanup()
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      configurable: true,
    })
    renderApp(['/owner/settings'])
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument()

    const promptSpy = vi.fn().mockResolvedValue(undefined)
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
    }
    event.prompt = promptSpy
    event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' })

    act(() => {
      window.dispatchEvent(event)
    })

    const installBtn = screen.getByRole('button', { name: 'Install app' })
    fireEvent.click(installBtn)
    await waitFor(() => {
      expect(promptSpy).toHaveBeenCalledTimes(1)
    })

    // 3. Standalone hides the install section completely
    cleanup()
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    renderApp(['/owner/settings'])
    expect(screen.queryByTestId('install-app-section')).not.toBeInTheDocument()
  })
})
