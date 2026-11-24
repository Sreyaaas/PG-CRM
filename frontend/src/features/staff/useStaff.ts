import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useAuth } from '@/features/auth/AuthContext'

export type StaffMember = components['schemas']['StaffMember']
export type StaffCreate = components['schemas']['StaffCreate']
export type StaffUpdate = components['schemas']['StaffUpdate']

export function useOrgId(): string {
  const { membership } = useAuth()
  return membership?.org_id ?? ''
}

export function useStaffQuery() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['staff', orgId],
    enabled: Boolean(orgId),
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/staff', {
        params: { header: { 'x-org-id': orgId } },
      })
      return data ?? []
    },
  })
}

export function usePropertiesQuery() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['properties', orgId],
    enabled: Boolean(orgId),
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/properties', {
        params: { header: { 'x-org-id': orgId } },
      })
      return data ?? []
    },
  })
}

export function useAddStaff() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: StaffCreate) => {
      const { data } = await apiClient.POST('/api/v1/staff', {
        params: { header: { 'x-org-id': orgId } },
        body,
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff', orgId] }),
  })
}

export function useUpdateStaff() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, body }: { userId: string; body: StaffUpdate }) => {
      const { data } = await apiClient.PATCH('/api/v1/staff/{user_id}', {
        params: { header: { 'x-org-id': orgId }, path: { user_id: userId } },
        body,
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff', orgId] }),
  })
}
