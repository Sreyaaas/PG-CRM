import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useAuth } from '@/features/auth/AuthContext'

export type OnboardingRequestSummary = components['schemas']['OnboardingRequestSummary']
export type OnboardingRequestDetail = components['schemas']['OnboardingRequestDetail']
export type OnboardingApprove = components['schemas']['OnboardingApprove']
export type OnboardingApproved = components['schemas']['OnboardingApproved'] & {
  whatsapp_url?: string | null
}
export type BedBoard = components['schemas']['BedBoard']
export type BoardRoom = components['schemas']['BoardRoom']
export type BoardBed = components['schemas']['BoardBed']
export type DiscountRequest = components['schemas']['DiscountRequest']

export const CHECKINS_REFETCH_MS = 60_000

export function pendingCheckinsKey(orgId: string | undefined) {
  return ['onboarding-requests', orgId, 'pending'] as const
}

export function usePendingCheckins() {
  const { membership } = useAuth()
  const orgId = membership?.org_id
  return useQuery({
    queryKey: pendingCheckinsKey(orgId),
    enabled: Boolean(orgId),
    refetchInterval: CHECKINS_REFETCH_MS,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/onboarding-requests', {
        params: { query: { status: 'pending' }, header: { 'x-org-id': orgId! } },
      })
      return data ?? []
    },
  })
}

export function usePendingOnboardingCount(): number {
  const query = usePendingCheckins()
  return Array.isArray(query.data) ? query.data.length : 0
}

export function useCheckinDetail(
  requestId: string | undefined,
  options?: { bedId?: string | null; stayType?: 'monthly' | 'short_term' },
) {
  const { membership } = useAuth()
  const orgId = membership?.org_id
  const bedId = options?.bedId ?? undefined
  const stayType = options?.stayType ?? undefined
  return useQuery({
    queryKey: ['onboarding-requests', orgId, 'detail', requestId, bedId ?? null, stayType ?? null],
    enabled: Boolean(orgId && requestId),
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/onboarding-requests/{request_id}', {
        params: {
          path: { request_id: requestId! },
          query: {
            ...(bedId ? { bed_id: bedId } : {}),
            ...(stayType ? { stay_type: stayType } : {}),
          },
          header: { 'x-org-id': orgId! },
        },
      })
      if (!data) throw new Error('Check-in request not found')
      return data
    },
  })
}

export function useBedBoard(propertyId: string | undefined) {
  const { membership } = useAuth()
  const orgId = membership?.org_id
  return useQuery({
    queryKey: ['bed-board', orgId, propertyId],
    enabled: Boolean(orgId && propertyId),
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/properties/{property_id}/bed-board', {
        params: { path: { property_id: propertyId! }, header: { 'x-org-id': orgId! } },
      })
      if (!data) throw new Error('Unable to load beds')
      return data
    },
  })
}

export function useDiscountRequestsList(enabled: boolean) {
  const { membership } = useAuth()
  const orgId = membership?.org_id
  return useQuery({
    queryKey: ['discount-requests', orgId, 'all'],
    enabled: Boolean(orgId) && enabled,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/discount-requests', {
        params: { header: { 'x-org-id': orgId! } },
      })
      return data ?? []
    },
  })
}

export function useCreateDiscountRequest() {
  const { membership } = useAuth()
  const orgId = membership?.org_id
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { bed_id: string; requested_rent_paise: number; reason: string }) => {
      const { data } = await apiClient.POST('/api/v1/discount-requests', {
        params: { header: { 'x-org-id': orgId! } },
        body: vars,
      })
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['discount-requests', orgId] })
    },
  })
}

export function useApproveCheckin(requestId: string, propertyId: string | undefined) {
  const { membership } = useAuth()
  const orgId = membership?.org_id
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: OnboardingApprove) => {
      const { data } = await apiClient.POST('/api/v1/onboarding-requests/{request_id}/approve', {
        params: { path: { request_id: requestId }, header: { 'x-org-id': orgId! } },
        body,
      })
      return data as OnboardingApproved
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['onboarding-requests', orgId] })
      if (propertyId) {
        void queryClient.invalidateQueries({ queryKey: ['bed-board', orgId, propertyId] })
      }
      void queryClient.invalidateQueries({ queryKey: ['properties', orgId] })
    },
  })
}

export function useRejectCheckin(requestId: string) {
  const { membership } = useAuth()
  const orgId = membership?.org_id
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (note: string) => {
      const { data } = await apiClient.POST('/api/v1/onboarding-requests/{request_id}/reject', {
        params: { path: { request_id: requestId }, header: { 'x-org-id': orgId! } },
        body: { note },
      })
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['onboarding-requests', orgId] })
    },
  })
}

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}
