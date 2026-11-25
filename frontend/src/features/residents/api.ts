import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useOrgId } from '@/features/properties/api'

export type Resident = components['schemas']['Resident']
export type Stay = components['schemas']['Stay']
export type NoticeRequest = components['schemas']['NoticeRequest']
export type MoveOutRequest = components['schemas']['MoveOutRequest']
export type StayCorrection = components['schemas']['StayCorrection']

export function residentKey(orgId: string, residentId: string | undefined) {
  return ['resident', orgId, residentId] as const
}

export function getTodayIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Mirrors backend `billing.notice_last_day`:
 * Notice on or before `deadlineDay` of month M -> last day of M.
 * After `deadlineDay` -> last day of M+1.
 */
export function computeNoticeLastDay(noticeDateIso: string, deadlineDay: number): string {
  const [y, m, d] = noticeDateIso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return noticeDateIso
  if (d <= deadlineDay) {
    return `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`
  }
  const nextYear = m === 12 ? y + 1 : y
  const nextMonth = m === 12 ? 1 : m + 1
  return `${nextYear}-${pad2(nextMonth)}-${pad2(daysInMonth(nextYear, nextMonth))}`
}

export function ordinalDay(day: number): string {
  const mod100 = day % 100
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`
  switch (day % 10) {
    case 1:
      return `${day}st`
    case 2:
      return `${day}nd`
    case 3:
      return `${day}rd`
    default:
      return `${day}th`
  }
}

const MONTH_NAME_IST = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'Asia/Kolkata' })
const SHORT_DATE_IST = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

export function formatNoticeRuleSummary(noticeDateIso: string, deadlineDay: number, lastDayIso: string): string {
  const noticeDate = new Date(`${noticeDateIso.slice(0, 10)}T00:00:00Z`)
  const lastDate = new Date(`${lastDayIso.slice(0, 10)}T00:00:00Z`)
  const day = Number(noticeDateIso.slice(8, 10))
  const noticeShort = SHORT_DATE_IST.format(noticeDate)
  const lastShort = SHORT_DATE_IST.format(lastDate)
  const lastMonth = MONTH_NAME_IST.format(lastDate)
  if (day <= deadlineDay) {
    return `Notice today (${noticeShort}) is on or before the ${ordinalDay(deadlineDay)}: last month is ${lastMonth}, must leave by ${lastShort}.`
  }
  return `Notice today (${noticeShort}) is after the ${ordinalDay(deadlineDay)}: last month is ${lastMonth}, must leave by ${lastShort}.`
}

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}

export function useResidentQuery(residentId: string | undefined) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: residentKey(orgId, residentId),
    enabled: Boolean(orgId && residentId),
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/residents/{resident_id}', {
        params: { path: { resident_id: residentId! }, header: { 'x-org-id': orgId } },
      })
      if (!data) throw new Error('Resident not found')
      return data
    },
  })
}

function useInvalidateStayQueries(residentId: string | undefined) {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: residentKey(orgId, residentId) }),
      queryClient.invalidateQueries({ queryKey: ['bed-board', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['properties', orgId] }),
    ])
  }
}

export function useGiveNoticeMutation(residentId: string | undefined) {
  const orgId = useOrgId()
  const invalidate = useInvalidateStayQueries(residentId)
  return useMutation({
    mutationFn: async (vars: { stayId: string; body?: NoticeRequest | null }) => {
      const { data } = await apiClient.POST('/api/v1/stays/{stay_id}/notice', {
        params: { path: { stay_id: vars.stayId }, header: { 'x-org-id': orgId } },
        ...(vars.body ? { body: vars.body } : {}),
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: invalidate,
  })
}

export function useWithdrawNoticeMutation(residentId: string | undefined) {
  const orgId = useOrgId()
  const invalidate = useInvalidateStayQueries(residentId)
  return useMutation({
    mutationFn: async (stayId: string) => {
      const { data } = await apiClient.POST('/api/v1/stays/{stay_id}/withdraw-notice', {
        params: { path: { stay_id: stayId }, header: { 'x-org-id': orgId } },
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: invalidate,
  })
}

export function useMoveOutMutation(residentId: string | undefined) {
  const orgId = useOrgId()
  const invalidate = useInvalidateStayQueries(residentId)
  return useMutation({
    mutationFn: async (vars: { stayId: string; actual_vacate_date: string }) => {
      const { data } = await apiClient.POST('/api/v1/stays/{stay_id}/move-out', {
        params: { path: { stay_id: vars.stayId }, header: { 'x-org-id': orgId } },
        body: { actual_vacate_date: vars.actual_vacate_date },
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: invalidate,
  })
}

export function useCheckInMutation(residentId: string | undefined) {
  const orgId = useOrgId()
  const invalidate = useInvalidateStayQueries(residentId)
  return useMutation({
    mutationFn: async (stayId: string) => {
      const { data } = await apiClient.POST('/api/v1/stays/{stay_id}/check-in', {
        params: { path: { stay_id: stayId }, header: { 'x-org-id': orgId } },
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: invalidate,
  })
}

export function useCorrectStayMutation(residentId: string | undefined) {
  const orgId = useOrgId()
  const invalidate = useInvalidateStayQueries(residentId)
  return useMutation({
    mutationFn: async (vars: { stayId: string; body: StayCorrection }) => {
      const { data } = await apiClient.PATCH('/api/v1/stays/{stay_id}', {
        params: { path: { stay_id: vars.stayId }, header: { 'x-org-id': orgId } },
        body: vars.body,
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: invalidate,
  })
}
