import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useAuth } from '@/features/auth/AuthContext'

export type CashBalance = components['schemas']['CashBalance']
export type CashLedger = components['schemas']['CashLedger']
export type CashLedgerEntry = components['schemas']['CashLedgerEntry']
export type CashHandoverResult = components['schemas']['CashHandoverResult']

export function cashKey(orgId: string | undefined) {
  return ['cash', orgId] as const
}

/** Caretakers get one row (their own); owners get one row per caretaker. */
export function useCashBalances() {
  const { membership } = useAuth()
  const orgId = membership?.org_id
  return useQuery({
    queryKey: [...cashKey(orgId), 'balances'],
    enabled: Boolean(orgId),
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/cash/balances', {
        params: { header: { 'x-org-id': orgId! } },
      })
      return data ?? []
    },
  })
}

/** Ledger for one caretaker. Omit `caretakerUserId` to get the signed-in user's own ledger. */
export function useCashLedger(caretakerUserId?: string) {
  const { membership } = useAuth()
  const orgId = membership?.org_id
  return useQuery({
    queryKey: [...cashKey(orgId), 'ledger', caretakerUserId ?? 'self'],
    enabled: Boolean(orgId),
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/cash/ledger', {
        params: {
          query: caretakerUserId ? { caretaker_user_id: caretakerUserId } : {},
          header: { 'x-org-id': orgId! },
        },
      })
      return data ?? null
    },
  })
}

export function useRecordHandover() {
  const { membership } = useAuth()
  const queryClient = useQueryClient()
  const orgId = membership?.org_id
  return useMutation({
    mutationFn: async (vars: {
      caretakerUserId: string
      amountPaise: number
      notes: string
      idempotencyKey: string
    }) => {
      const notes = vars.notes.trim()
      const { data } = await apiClient.POST('/api/v1/cash/handovers', {
        params: { header: { 'x-org-id': orgId!, 'Idempotency-Key': vars.idempotencyKey } },
        body: {
          caretaker_user_id: vars.caretakerUserId,
          amount_paise: vars.amountPaise,
          notes: notes ? notes : null,
        },
      })
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cashKey(orgId) }),
  })
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : err instanceof Error && err.message ? err.message : fallback
}
