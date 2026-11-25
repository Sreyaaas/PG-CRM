import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useOrgId } from '@/features/properties/api'

export type Dashboard = components['schemas']['Dashboard']
export type DashboardPnl = components['schemas']['DashboardPnl']
export type DashboardOccupancy = components['schemas']['DashboardOccupancy']
export type DashboardAttention = components['schemas']['DashboardAttention']

export type PeriodKind = 'this' | 'last' | 'custom'
export interface Period {
  from: string
  to: string
}

function istYearMonth(now: Date): { y: number; m: number } {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
    .format(now)
    .split('-')
    .map(Number)
  return { y, m }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** First and last day (IST) of this month or last month. */
export function monthPeriod(kind: 'this' | 'last', now = new Date()): Period {
  const { y, m } = istYearMonth(now)
  const idx = kind === 'this' ? m - 1 : m - 2
  const first = new Date(Date.UTC(y, idx, 1))
  const last = new Date(Date.UTC(y, idx + 1, 0))
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return { from: fmt(first), to: fmt(last) }
}

export function dashboardKey(orgId: string, period: Period) {
  return ['dashboard', orgId, period.from, period.to] as const
}

export function useDashboardQuery(period: Period | null) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: dashboardKey(orgId, period ?? { from: '', to: '' }),
    enabled: Boolean(orgId && period),
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/dashboard', {
        params: { query: { from: period!.from, to: period!.to }, header: { 'x-org-id': orgId } },
      })
      if (!data) {
        const msg = (error as { error?: { message?: string } } | undefined)?.error?.message
        throw new Error(msg ?? 'Could not load the dashboard')
      }
      return data
    },
  })
}

/** Guards against an unexpected body so the page can fall back to bed boards. */
export function isDashboard(d: unknown): d is Dashboard {
  const x = d as Dashboard | undefined
  return Boolean(x && Array.isArray(x.pnl) && Array.isArray(x.occupancy) && x.attention)
}

export function sumPnl(rows: DashboardPnl[]) {
  return rows.reduce(
    (a, r) => ({
      collected: a.collected + r.collected_verified_paise + r.collected_cash_paise,
      provisional: a.provisional + r.provisional_paise,
      flagged: a.flagged + r.flagged_paise,
      expenses: a.expenses + r.expenses_paise,
      net: a.net + r.net_paise,
    }),
    { collected: 0, provisional: 0, flagged: 0, expenses: 0, net: 0 },
  )
}

/** Where each "Needs attention" count opens. Lists not built yet are linked at their planned routes. */
export const ATTENTION_LINKS = {
  onboarding: '/owner/check-ins',
  discounts: '/owner/approvals',
  expenses: '/owner/expenses?flagged=true',
  provisional: '/owner/reconcile?older_than_days=3',
  payments: '/owner/payments?status=flagged',
  cash: '/owner/money/cash',
  overstaying: '/owner/beds',
} as const
