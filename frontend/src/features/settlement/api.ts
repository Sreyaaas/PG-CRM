import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useOrgId } from '@/features/properties/api'

export type SettlementPreview = components['schemas']['SettlementPreview']
export type SettlementCreate = components['schemas']['SettlementCreate']
export type SettlementCreated = components['schemas']['SettlementCreated']

export function settlementPreviewKey(orgId: string, stayId: string | undefined) {
  return ['settlement-preview', orgId, stayId] as const
}

export function useSettlementPreviewQuery(stayId: string | undefined) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: settlementPreviewKey(orgId, stayId),
    enabled: Boolean(orgId && stayId),
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/stays/{stay_id}/settlement-preview', {
        params: { path: { stay_id: stayId! }, header: { 'x-org-id': orgId } },
      })
      if (!data) throw new Error('Settlement preview not found')
      return data
    },
  })
}

export function useSettleMutation(stayId: string | undefined) {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: SettlementCreate) => {
      const { data } = await apiClient.POST('/api/v1/stays/{stay_id}/settlement', {
        params: { path: { stay_id: stayId! }, header: { 'x-org-id': orgId } },
        body,
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settlementPreviewKey(orgId, stayId) }),
  })
}
