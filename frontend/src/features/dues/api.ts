import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useOrgId } from '@/features/properties/api'

export type DueRow = components['schemas']['DueRow']
export type ResidentLedger = components['schemas']['ResidentLedger']
export type LedgerEntry = components['schemas']['LedgerEntry']

export function duesKey(orgId: string, propertyId: string | null) {
  return ['dues', orgId, propertyId] as const
}

export function ledgerKey(orgId: string, residentId: string | undefined) {
  return ['ledger', orgId, residentId] as const
}

/** The API already returns dues most overdue first; the UI shows them in that order. */
export function useDuesQuery(propertyId: string | null) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: duesKey(orgId, propertyId),
    enabled: Boolean(orgId),
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/dues', {
        params: {
          query: propertyId ? { property_id: propertyId } : {},
          header: { 'x-org-id': orgId },
        },
      })
      return data ?? []
    },
  })
}

export function useLedgerQuery(residentId: string | undefined) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ledgerKey(orgId, residentId),
    enabled: Boolean(orgId && residentId),
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/residents/{resident_id}/ledger', {
        params: { path: { resident_id: residentId! }, header: { 'x-org-id': orgId } },
      })
      if (!data) throw new Error('Ledger not found')
      return data
    },
  })
}

export function useGenerateInvoices() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (propertyId: string | null) => {
      const { data } = await apiClient.POST('/api/v1/invoices/generate-due', {
        params: { header: { 'x-org-id': orgId } },
        body: propertyId ? { property_id: propertyId } : {},
      })
      if (!data) throw new Error('No response from the server')
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dues', orgId] })
      void queryClient.invalidateQueries({ queryKey: ['ledger', orgId] })
    },
  })
}
