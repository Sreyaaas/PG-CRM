import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useOrgId } from '@/features/properties/api'

export type Complaint = components['schemas']['Complaint']
export type ComplaintCreate = components['schemas']['ComplaintCreate']
export type ComplaintUpdate = components['schemas']['ComplaintUpdate']
export type ComplaintStatus = Complaint['status']
export type ComplaintPriority = Complaint['priority']
export type ComplaintCategory = Complaint['category']

export const CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  wifi: 'Wi-Fi',
  water: 'Water',
  electricity: 'Electricity',
  plumbing: 'Plumbing',
  ac: 'AC',
  cleaning: 'Cleaning',
  food: 'Food',
  security: 'Security',
  other: 'Other',
}

export const STATUS_LABELS: Record<ComplaintStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
}

export const PRIORITY_LABELS: Record<ComplaintPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  urgent: 'Urgent',
}

const PRIORITY_RANK: Record<ComplaintPriority, number> = { urgent: 0, normal: 1, low: 2 }
const STATUS_RANK: Record<ComplaintStatus, number> = { open: 0, in_progress: 1, resolved: 2 }

/** Unresolved first; among those urgent first, then not-yet-started, then the longest-waiting resident. */
export function sortComplaints(list: Complaint[]): Complaint[] {
  const resolved = (c: Complaint) => (c.status === 'resolved' ? 1 : 0)
  return [...list].sort(
    (a, b) =>
      resolved(a) - resolved(b) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.status === 'resolved'
        ? (b.resolved_at ?? b.updated_at).localeCompare(a.resolved_at ?? a.updated_at)
        : a.created_at.localeCompare(b.created_at)),
  )
}

/** "3h ago", "2d ago": how long a resident has been waiting. */
export function ageLabel(iso: string, now = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function complaintsKey(orgId: string) {
  return ['complaints', orgId] as const
}

export function useComplaintsQuery(filters: { propertyId?: string | null; status?: ComplaintStatus | null } = {}) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: [...complaintsKey(orgId), filters.propertyId ?? 'all', filters.status ?? 'any'],
    enabled: Boolean(orgId),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async () => {
      const query: { property_id?: string; status?: ComplaintStatus } = {}
      if (filters.propertyId) query.property_id = filters.propertyId
      if (filters.status) query.status = filters.status
      const { data } = await apiClient.GET('/api/v1/complaints', {
        params: { query, header: { 'x-org-id': orgId } },
      })
      return Array.isArray(data) ? data : []
    },
  })
}

export function useCreateComplaint() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: ComplaintCreate) => {
      const { data } = await apiClient.POST('/api/v1/complaints', {
        params: { header: { 'x-org-id': orgId } },
        body,
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: complaintsKey(orgId) }),
  })
}

export function useUpdateComplaint() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: ComplaintUpdate }) => {
      const { data } = await apiClient.PATCH('/api/v1/complaints/{complaint_id}', {
        params: { path: { complaint_id: id }, header: { 'x-org-id': orgId } },
        body,
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: complaintsKey(orgId) }),
  })
}
