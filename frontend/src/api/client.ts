import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './schema'

export const API_URL: string =
  import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

export const API_ROOT_URL: string = API_URL.replace(/\/api\/v1\/?$/, '')

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface AuthStateGetter {
  getToken: () => string | null
  getOrgId: () => string | null
}

export interface ApiEventHandlers {
  onUnauthorized?: () => void
  onForbidden?: (message: string) => void
}

const TOKEN_STORAGE_KEY = 'pgcrm_access_token'
const ORG_STORAGE_KEY = 'pgcrm_org_id'

let authStateGetter: AuthStateGetter = {
  getToken: () =>
    typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null,
  getOrgId: () =>
    typeof window !== 'undefined' ? window.localStorage.getItem(ORG_STORAGE_KEY) : null,
}

let apiEventHandlers: ApiEventHandlers = {}

export function configureAuthGetter(getter: AuthStateGetter): void {
  authStateGetter = getter
}

export function configureApiHandlers(handlers: ApiEventHandlers): void {
  apiEventHandlers = handlers
}

export interface CreateApiClientOptions {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  getToken?: () => string | null
  getOrgId?: () => string | null
  onUnauthorized?: () => void
  onForbidden?: (message: string) => void
}

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
  }
}

export function createApiClient(options: CreateApiClientOptions = {}) {
  const rawBaseUrl = options.baseUrl ?? API_URL
  // OpenAPI paths already include `/api/v1/...`, so strip any trailing `/api/v1` from baseUrl
  // to avoid doubling `/api/v1/api/v1/...` and to allow `/health` on the same root.
  const baseUrl = rawBaseUrl.replace(/\/api\/v1\/?$/, '')
  const getToken = options.getToken ?? (() => authStateGetter.getToken())
  const getOrgId = options.getOrgId ?? (() => authStateGetter.getOrgId())

  const client = createClient<paths>({
    baseUrl,
    fetch: (input: Request) => {
      const fetchImpl = options.fetch ?? globalThis.fetch
      return fetchImpl(input)
    },
  })

  const middleware: Middleware = {
    async onRequest({ request }) {
      const token = getToken()
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`)
      }

      const orgId = getOrgId()
      if (orgId) {
        request.headers.set('X-Org-Id', orgId)
      }

      return request
    },
    async onResponse({ request, response }) {
      if (!response.ok) {
        let code = 'http_error'
        let message = response.statusText || `Request failed with status ${response.status}`

        try {
          const body = (await response.clone().json()) as ErrorEnvelope
          if (body?.error) {
            if (typeof body.error.code === 'string' && body.error.code.length > 0) {
              code = body.error.code
            }
            if (typeof body.error.message === 'string' && body.error.message.length > 0) {
              message = body.error.message
            }
          }
        } catch {
          // Non-JSON error body; keep fallback code and message
        }

        const isPublicAuthCall =
          request.url.includes('/auth/login') || request.url.includes('/auth/signup')

        if (response.status === 401 && !isPublicAuthCall) {
          const handler = options.onUnauthorized ?? apiEventHandlers.onUnauthorized
          handler?.()
        } else if (response.status === 403) {
          const handler = options.onForbidden ?? apiEventHandlers.onForbidden
          handler?.("You don't have access to this")
        }

        throw new ApiError(response.status, code, message)
      }
      return response
    },
  }

  client.use(middleware)
  return client
}

export const apiClient = createApiClient()

export async function fetchHealth(
  customFetch?: typeof globalThis.fetch,
): Promise<Record<string, string>> {
  const rootClient = createApiClient({
    baseUrl: API_ROOT_URL,
    fetch: customFetch,
  })
  const { data } = await rootClient.GET('/health')
  return data ?? { status: 'unknown' }
}
