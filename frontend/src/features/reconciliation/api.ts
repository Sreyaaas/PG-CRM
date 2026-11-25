import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useAuth } from '@/features/auth/AuthContext'

export type CsvImport = components['schemas']['CsvImport']
export type CsvImportResult = components['schemas']['CsvImportResult']
export type CsvImportRow = components['schemas']['CsvImportRow']
export type Payment = components['schemas']['Payment']
export type StatementSource = components['schemas']['Body_upload_statement_api_v1_reconciliation_imports_post']['source']
export type RowMatch = CsvImportRow['match']

/** Payments logged at least this many days ago with no statement row are "not in any statement". */
export const UNVERIFIED_OLDER_THAN_DAYS = 3

export const SOURCE_LABELS: Record<StatementSource, string> = {
  paytm_business: 'Paytm Business',
  phonepe_business: 'PhonePe Business',
  bank_statement: 'Bank statement',
  other: 'Other',
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

function useOrgId() {
  return useAuth().membership?.org_id
}

export function useImports() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['reconciliation', orgId, 'imports'],
    enabled: Boolean(orgId),
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/reconciliation/imports', {
        params: { header: { 'x-org-id': orgId! } },
      })
      return data ?? []
    },
  })
}

export function useImportRows(importId: string | null) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['reconciliation', orgId, 'rows', importId],
    enabled: Boolean(orgId) && Boolean(importId),
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/reconciliation/imports/{import_id}/rows', {
        params: { path: { import_id: importId! }, header: { 'x-org-id': orgId! } },
      })
      return data ?? []
    },
  })
}

export function useUnverifiedPayments(enabled: boolean) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['reconciliation', orgId, 'unverified'],
    enabled: Boolean(orgId) && enabled,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/reconciliation/unverified-payments', {
        params: { query: { older_than_days: UNVERIFIED_OLDER_THAN_DAYS }, header: { 'x-org-id': orgId! } },
      })
      return data ?? []
    },
  })
}

export function usePayment(paymentId: string | null) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['payment', orgId, paymentId],
    enabled: Boolean(orgId) && Boolean(paymentId),
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/payments/{payment_id}', {
        params: { path: { payment_id: paymentId! }, header: { 'x-org-id': orgId! } },
      })
      if (!data) throw new Error('Empty payment response')
      return data
    },
  })
}

export function useUploadStatement() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { source: StatementSource; file: File }): Promise<CsvImportResult> => {
      const form = new FormData()
      form.append('source', vars.source)
      form.append('file', vars.file, vars.file.name)
      const { data } = await apiClient.POST('/api/v1/reconciliation/imports', {
        params: { header: { 'x-org-id': orgId! } },
        // The generated body type models the file as a string; the real request is multipart.
        body: { source: vars.source, file: '' },
        bodySerializer: () => form,
      })
      if (!data) throw new Error('Empty upload response')
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliation', orgId] }),
  })
}

export type PaymentDecision =
  | { paymentId: string; action: 'verify' }
  | { paymentId: string; action: 'flag'; reason: string }

/** Flag or verify a payment, then refresh everything that shows it. */
export function usePaymentDecision() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: PaymentDecision) => {
      const header = { 'x-org-id': orgId! }
      const path = { payment_id: vars.paymentId }
      if (vars.action === 'flag') {
        const { data } = await apiClient.POST('/api/v1/payments/{payment_id}/flag', {
          params: { path, header },
          body: { reason: vars.reason },
        })
        return data
      }
      const { data } = await apiClient.POST('/api/v1/payments/{payment_id}/verify', { params: { path, header } })
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reconciliation', orgId] })
      void queryClient.invalidateQueries({ queryKey: ['payment', orgId] })
    },
  })
}
