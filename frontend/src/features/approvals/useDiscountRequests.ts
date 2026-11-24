import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiClient } from '@/api/client'
import { useAuth } from '@/features/auth/AuthContext'

export const APPROVALS_REFETCH_MS = 60_000

export function pendingDiscountsKey(orgId: string | undefined) {
  return ['discount-requests', orgId, 'pending'] as const
}

export function usePendingDiscounts() {
  const { membership } = useAuth()
  const orgId = membership?.org_id
  return useQuery({
    queryKey: pendingDiscountsKey(orgId),
    enabled: Boolean(orgId) && membership?.role === 'owner',
    refetchInterval: APPROVALS_REFETCH_MS,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/discount-requests', {
        params: { query: { status: 'pending' }, header: { 'x-org-id': orgId! } },
      })
      return data ?? []
    },
  })
}

/** Total pending items across all approval card types. New card types add their count here. */
export function usePendingApprovalsCount(): number {
  const discounts = usePendingDiscounts()
  return discounts.data?.length ?? 0
}

export function useDecideDiscount(onError: (message: string) => void) {
  const { membership } = useAuth()
  const queryClient = useQueryClient()
  const orgId = membership?.org_id
  return useMutation({
    mutationFn: async (vars: { id: string; decision: 'approved' | 'rejected'; note?: string }) => {
      const note = vars.note?.trim()
      const { data } = await apiClient.POST('/api/v1/discount-requests/{request_id}/decide', {
        params: { path: { request_id: vars.id }, header: { 'x-org-id': orgId! } },
        body: { decision: vars.decision, note: note ? note : null },
      })
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discount-requests', orgId] }),
    onError: (err) => {
      onError(err instanceof ApiError ? err.message : 'Unable to save the decision. Please try again.')
      // e.g. 409 already decided: the card should leave the list
      void queryClient.invalidateQueries({ queryKey: ['discount-requests', orgId] })
    },
  })
}
