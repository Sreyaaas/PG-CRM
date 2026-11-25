import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useOrgId } from '@/features/properties/api'

export type Payment = components['schemas']['Payment']
export type PaymentMethod = components['schemas']['PaymentCreate']['method']

export interface LogPaymentVars {
  residentId: string
  amountPaise: number
  method: PaymentMethod
  /** 12 digits, only for upi and bank_transfer. */
  utr: string | null
  invoiceId: string | null
  notes: string
  idempotencyKey: string
}

export function useLogPayment() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: LogPaymentVars) => {
      const notes = vars.notes.trim()
      const { data } = await apiClient.POST('/api/v1/payments', {
        params: { header: { 'x-org-id': orgId, 'Idempotency-Key': vars.idempotencyKey } },
        body: {
          resident_id: vars.residentId,
          amount_paise: vars.amountPaise,
          method: vars.method,
          utr_number: vars.method === 'cash' ? null : vars.utr,
          invoice_id: vars.invoiceId,
          notes: notes ? notes : null,
        },
      })
      if (!data) throw new Error('No response from the server')
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dues', orgId] })
      void queryClient.invalidateQueries({ queryKey: ['ledger', orgId] })
      void queryClient.invalidateQueries({ queryKey: ['cash', orgId] })
    },
  })
}
