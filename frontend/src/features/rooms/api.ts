import { useQuery } from '@tanstack/react-query'
import type { components } from '@/api/schema'
import { apiClient } from '@/api/client'
import { useOrgId } from '@/features/properties/api'

export type Room = components['schemas']['Room']
export type RoomCreate = components['schemas']['RoomCreate']
export type RoomUpdate = components['schemas']['RoomUpdate']
export type Bed = components['schemas']['Bed']
export type BedUpdate = components['schemas']['BedUpdate']
export type BoardRoom = components['schemas']['BoardRoom']
export type BoardBed = components['schemas']['BoardBed']

export function useBedBoardQuery(propertyId: string | undefined) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['bed-board', orgId, propertyId],
    enabled: Boolean(orgId && propertyId),
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/properties/{property_id}/bed-board', {
        params: { path: { property_id: propertyId! }, header: { 'x-org-id': orgId } },
      })
      return data?.rooms ?? []
    },
    retry: false,
  })
}
