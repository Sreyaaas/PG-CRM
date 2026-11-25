import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useAuth } from '@/features/auth/AuthContext'
import { uploadToPresignedUrl } from '@/features/join/api'

export type Expense = components['schemas']['Expense']
export type ExpenseCreate = components['schemas']['ExpenseCreate']
export type ExpenseCategory = ExpenseCreate['category']
export type UploadContentType = components['schemas']['UploadRequest']['content_type']

function useOrgId(): string {
  const { membership } = useAuth()
  return membership?.org_id ?? ''
}

export function expensesKey(orgId: string) {
  return ['expenses', orgId] as const
}

export function useExpensesQuery(opts: { flagged?: boolean } = {}) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: [...expensesKey(orgId), opts.flagged ? 'flagged' : 'all'],
    enabled: Boolean(orgId),
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/expenses', {
        params: { query: opts.flagged ? { flagged: true } : {}, header: { 'x-org-id': orgId } },
      })
      return Array.isArray(data) ? data : []
    },
  })
}

/** Signed GET url for a stored proof photo (valid 5 minutes). */
export function useProofUrl(key: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['file-url', orgId, key],
    enabled: Boolean(orgId && key),
    staleTime: 4 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/files/url', {
        params: { query: { key }, header: { 'x-org-id': orgId } },
      })
      return data?.url ?? null
    },
  })
}

/** Presigned ticket, then PUT the bytes. Returns the object key to store as `proof_path`. */
export async function uploadExpenseProof(
  orgId: string,
  propertyId: string,
  blob: Blob,
  contentType: UploadContentType,
  sizeBytes: number,
): Promise<string> {
  const { data } = await apiClient.POST('/api/v1/uploads', {
    params: { header: { 'x-org-id': orgId } },
    body: { content_type: contentType, size_bytes: sizeBytes, kind: 'expense_proof', property_id: propertyId },
  })
  if (!data) throw new Error('Empty upload ticket response')
  await uploadToPresignedUrl(data.upload_url, blob, contentType)
  return data.object_key
}

export function useCreateExpense() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { body: ExpenseCreate; idempotencyKey: string }) => {
      const { data } = await apiClient.POST('/api/v1/expenses', {
        params: { header: { 'x-org-id': orgId, 'Idempotency-Key': vars.idempotencyKey } },
        body: vars.body,
      })
      if (!data) throw new Error('Empty expense response')
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: expensesKey(orgId) }),
  })
}

export function useReviewExpense() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; note?: string }) => {
      const note = vars.note?.trim()
      const { data } = await apiClient.POST('/api/v1/expenses/{expense_id}/review', {
        params: { path: { expense_id: vars.id }, header: { 'x-org-id': orgId } },
        body: { note: note ? note : null },
      })
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: expensesKey(orgId) }),
  })
}

export function useVoidExpense() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; reason: string }) => {
      const { data } = await apiClient.POST('/api/v1/expenses/{expense_id}/void', {
        params: { path: { expense_id: vars.id }, header: { 'x-org-id': orgId } },
        body: { reason: vars.reason.trim() },
      })
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: expensesKey(orgId) }),
  })
}
