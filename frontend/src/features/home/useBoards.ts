import { useQueries } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { Property } from '@/features/properties/api'
import type { BoardBed, BoardRoom } from '@/features/rooms/api'

export interface BedCounts {
  total: number
  occupied: number
  vacant: number
  reserved: number
  onNotice: number
}

export interface BoardBedWithRoom extends BoardBed {
  roomLabel: string
  propertyId: string
  propertyName: string
}

export function countBeds(rooms: BoardRoom[]): BedCounts {
  const counts: BedCounts = { total: 0, occupied: 0, vacant: 0, reserved: 0, onNotice: 0 }
  for (const room of rooms) {
    for (const bed of room.beds ?? []) {
      if (!bed.is_active) continue
      counts.total += 1
      if (bed.status === 'occupied') counts.occupied += 1
      else if (bed.status === 'vacant') counts.vacant += 1
      else if (bed.status === 'reserved') counts.reserved += 1
      else if (bed.status === 'on_notice') counts.onNotice += 1
    }
  }
  return counts
}

export function addCounts(all: BedCounts[]): BedCounts {
  return all.reduce(
    (acc, c) => ({
      total: acc.total + c.total,
      occupied: acc.occupied + c.occupied,
      vacant: acc.vacant + c.vacant,
      reserved: acc.reserved + c.reserved,
      onNotice: acc.onNotice + c.onNotice,
    }),
    { total: 0, occupied: 0, vacant: 0, reserved: 0, onNotice: 0 },
  )
}

/** Loads GET /properties/{id}/bed-board for every property, sharing the rooms page cache key. */
export function useBoards(orgId: string, properties: Pick<Property, 'id' | 'name'>[]) {
  const results = useQueries({
    queries: properties.map((p) => ({
      queryKey: ['bed-board', orgId, p.id],
      enabled: Boolean(orgId),
      refetchOnWindowFocus: true,
      retry: false,
      queryFn: async () => {
        const { data } = await apiClient.GET('/api/v1/properties/{property_id}/bed-board', {
          params: { path: { property_id: p.id }, header: { 'x-org-id': orgId } },
        })
        return data?.rooms ?? []
      },
    })),
  })

  const boards = properties.map((p, i) => {
    const rooms = (results[i]?.data ?? []) as BoardRoom[]
    const beds: BoardBedWithRoom[] = rooms.flatMap((r) =>
      (r.beds ?? []).map((b) => ({ ...b, roomLabel: r.label, propertyId: p.id, propertyName: p.name })),
    )
    return { property: p, rooms, beds, counts: countBeds(rooms), isLoading: results[i]?.isLoading ?? false }
  })

  return {
    boards,
    isLoading: results.some((r) => r.isLoading),
    totals: addCounts(boards.map((b) => b.counts)),
  }
}

const IST_HOUR = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' })
const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })

export function greeting(name: string | undefined, now = new Date()): string {
  const hour = Number(IST_HOUR.format(now))
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const first = name?.trim().split(/\s+/)[0]
  return first ? `${part}, ${first}` : part
}

/** Whole calendar days from today (IST) until an ISO date (YYYY-MM-DD). Negative means overdue. */
export function daysUntilIST(isoDate: string, now = new Date()): number {
  const todayStr = IST_DATE.format(now)
  const [ty, tm, td] = todayStr.split('-').map(Number)
  const [vy, vm, vd] = isoDate.slice(0, 10).split('-').map(Number)
  const todayMs = Date.UTC(ty, tm - 1, td)
  const vacateMs = Date.UTC(vy, vm - 1, vd)
  return Math.round((vacateMs - todayMs) / 86_400_000)
}

export function formatDaysLeft(isoDate: string, now = new Date()): { label: string; tone: 'danger' | 'warning' | 'neutral' } {
  const diff = daysUntilIST(isoDate, now)
  if (diff < 0) {
    const abs = Math.abs(diff)
    return { label: `${abs} ${abs === 1 ? 'day' : 'days'} overdue`, tone: 'danger' }
  }
  if (diff === 0) return { label: 'Today', tone: 'warning' }
  if (diff === 1) return { label: '1 day left', tone: 'warning' }
  return { label: `${diff} days left`, tone: diff <= 7 ? 'warning' : 'neutral' }
}

