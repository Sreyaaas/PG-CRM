import { useQuery } from '@tanstack/react-query'
import { ApiError, createApiClient } from '@/api/client'
import type { components } from '@/api/schema'

export type JoinInfo = components['schemas']['JoinInfo']
export type PublicUploadRequest = components['schemas']['PublicUploadRequest']
export type UploadTicket = components['schemas']['UploadTicket']
export type OnboardingSubmit = components['schemas']['OnboardingSubmit']
export type OnboardingSubmitted = components['schemas']['OnboardingSubmitted']

// Public routes never send auth headers or trigger login/forbidden redirects.
const publicApiClient = createApiClient({
  getToken: () => null,
  getOrgId: () => null,
  onUnauthorized: () => {},
  onForbidden: () => {},
})

export function useJoinInfoQuery(slug: string | undefined) {
  return useQuery({
    queryKey: ['public-join', slug],
    enabled: Boolean(slug),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false
      return failureCount < 1
    },
    queryFn: async () => {
      const { data } = await publicApiClient.GET('/api/v1/public/join/{qr_slug}', {
        params: { path: { qr_slug: slug! } },
      })
      if (!data) throw new Error('Empty response')
      return data
    },
  })
}

export async function requestPublicUpload(
  slug: string,
  body: PublicUploadRequest,
): Promise<UploadTicket> {
  const { data } = await publicApiClient.POST('/api/v1/public/join/{qr_slug}/uploads', {
    params: { path: { qr_slug: slug } },
    body,
  })
  if (!data) throw new Error('Empty upload ticket response')
  return data
}

export async function uploadToPresignedUrl(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  })
  if (!res.ok) {
    throw new Error(`Photo upload failed (${res.status})`)
  }
}

export async function submitOnboarding(
  slug: string,
  body: OnboardingSubmit,
): Promise<OnboardingSubmitted> {
  const { data } = await publicApiClient.POST('/api/v1/public/join/{qr_slug}', {
    params: { path: { qr_slug: slug } },
    body,
  })
  if (!data) throw new Error('Empty submit response')
  return data
}
