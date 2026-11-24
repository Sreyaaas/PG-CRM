import { useQuery } from '@tanstack/react-query'
import type { components } from '@/api/schema'
import { apiClient } from '@/api/client'
import { useAuth } from '@/features/auth/AuthContext'

export type Property = components['schemas']['Property']
export type PropertyCreate = components['schemas']['PropertyCreate']
export type PropertyUpdate = components['schemas']['PropertyUpdate']
export type UpiPayeeDetails = components['schemas']['UpiPayeeDetails']

export function useOrgId(): string {
  const { membership } = useAuth()
  return membership?.org_id ?? ''
}

export function usePropertiesQuery() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['properties', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/properties', {
        params: { header: { 'x-org-id': orgId } },
      })
      return data ?? []
    },
    retry: false,
  })
}

export function usePropertyQuery(propertyId: string | undefined) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['properties', orgId, propertyId],
    enabled: Boolean(orgId && propertyId),
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/properties/{property_id}', {
        params: { path: { property_id: propertyId! }, header: { 'x-org-id': orgId } },
      })
      if (!data) throw new Error('Property not found')
      return data
    },
    retry: false,
  })
}
