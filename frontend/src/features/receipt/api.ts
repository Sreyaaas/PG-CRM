import { useQuery } from '@tanstack/react-query'
import { ApiError, createApiClient } from '@/api/client'
import type { components } from '@/api/schema'

export type PublicDocument =
  | components['schemas']['PublicPaymentReceipt']
  | components['schemas']['PublicInvoice']
  | components['schemas']['PublicExitSettlement']

// Public route: never sends auth headers and never triggers login/forbidden redirects.
const publicApiClient = createApiClient({
  getToken: () => null,
  getOrgId: () => null,
  onUnauthorized: () => {},
  onForbidden: () => {},
})

export function usePublicDocumentQuery(token: string | undefined) {
  return useQuery({
    queryKey: ['public-document', token],
    enabled: Boolean(token),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false
      return failureCount < 1
    },
    queryFn: async (): Promise<PublicDocument> => {
      const { data } = await publicApiClient.GET('/api/v1/public/documents/{token}', {
        params: { path: { token: token! } },
      })
      if (!data) throw new Error('Empty response')
      return data
    },
  })
}
