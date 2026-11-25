import { apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { RetryQueue, type PhotoUpload, type QueueTransport, type WriteKind } from './retryQueue'
import { getOfflineStore } from './store'

type PaymentCreate = components['schemas']['PaymentCreate']
type ExpenseCreate = components['schemas']['ExpenseCreate']
type CashHandoverCreate = components['schemas']['CashHandoverCreate']

/** The real API calls. `apiClient` adds the bearer token and handles 401/403 like every other call. */
export const apiTransport: QueueTransport = {
  async post(kind: WriteKind, body, idempotencyKey, orgId) {
    const params = { header: { 'x-org-id': orgId, 'Idempotency-Key': idempotencyKey } }
    switch (kind) {
      case 'payment': {
        const { data } = await apiClient.POST('/api/v1/payments', { body: body as unknown as PaymentCreate, params })
        return data
      }
      case 'expense': {
        const { data } = await apiClient.POST('/api/v1/expenses', { body: body as unknown as ExpenseCreate, params })
        return data
      }
      case 'handover': {
        const { data } = await apiClient.POST('/api/v1/cash/handovers', {
          body: body as unknown as CashHandoverCreate,
          params,
        })
        return data
      }
    }
  },

  async uploadPhoto(photo: PhotoUpload, orgId) {
    const { data: ticket } = await apiClient.POST('/api/v1/uploads', {
      body: {
        kind: 'expense_proof',
        property_id: photo.propertyId,
        content_type: photo.contentType as 'image/jpeg' | 'image/png' | 'image/webp',
        size_bytes: photo.blob.size,
      },
      params: { header: { 'x-org-id': orgId } },
    })
    if (!ticket) throw new Error('Upload ticket missing')
    const put = await fetch(ticket.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': photo.contentType },
      body: photo.blob,
    })
    if (!put.ok) throw new TypeError(`Photo upload failed (${put.status})`) // not an ApiError: retried later
    return ticket.object_key
  },
}

/** The app-wide queue. Screens call `retryQueue.submit(...)`. */
export const retryQueue = new RetryQueue({ store: getOfflineStore, transport: apiTransport })
