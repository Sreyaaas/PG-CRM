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

const TOKEN_STORAGE_KEY = 'pgcrm_access_token'
const ORG_STORAGE_KEY = 'pgcrm_org_id'

let authStateGetter: AuthStateGetter = {
  getToken: () =>
    typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null,
  getOrgId: () =>
    typeof window !== 'undefined' ? window.localStorage.getItem(ORG_STORAGE_KEY) : null,
}

export function configureAuthGetter(getter: AuthStateGetter): void {
  authStateGetter = getter
}

export interface CreateApiClientOptions {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  getToken?: () => string | null
  getOrgId?: () => string | null
}

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
  }
}

export function createApiClient(options: CreateApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? API_URL
  const getToken = options.getToken ?? (() => authStateGetter.getToken())
  const getOrgId = options.getOrgId ?? (() => authStateGetter.getOrgId())

  const client = createClient<paths>({
    baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })

  const middleware: Middleware = {
    async onRequest({ request }) {
      const normalizedUrl = request.url.replace(/\/api\/v1\/api\/v1(\/|$)/, '/api/v1$1')
      const req = normalizedUrl !== request.url ? new Request(normalizedUrl, request) : request

      const token = getToken()
      if (token) {
        req.headers.set('Authorization', `Bearer ${token}`)
      }

      const orgId = getOrgId()
      if (orgId) {
        req.headers.set('X-Org-Id', orgId)
      }

      return req
    },
    async onResponse({ response }) {
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
