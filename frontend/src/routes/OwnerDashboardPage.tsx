import { CollectionCard } from '@/features/dashboard/CollectionCard'
import { RecentActivityCard } from '@/features/dashboard/RecentActivityCard'
import { OpenComplaintsCard } from '@/features/complaints/OpenComplaintsCard'
import { useEffect, useMemo, useState } from 'react'
import {
  HandCoins,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardList } from '@/components/ui/card'
import {
  EmptyState,
  ListRow,
  LoadingRows,
  PageHeader,
  ROW_LINK,
  Skeleton,
} from '@/components/ui/misc'
import { DiscountRequestCard } from '@/features/approvals/DiscountRequestCard'
import {
  useDecideDiscount,
  usePendingDiscounts,
} from '@/features/approvals/useDiscountRequests'
import { useAuth } from '@/features/auth/AuthContext'
import {
  isDashboard,
  monthPeriod,
  sumPnl,
  useDashboardQuery,
  type PeriodKind,
} from '@/features/dashboard/api'
import { AttentionCard, PnlCard, PeriodSwitcher } from '@/features/dashboard/DashboardParts'
import { useDuesQuery } from '@/features/dues/api'
import {
  DateLine,
  DaysLeftBadge,
  OccupancyBar,
  QuietEmptySection,
} from '@/features/home/parts'
import { daysUntilIST, greeting, useBoards } from '@/features/home/useBoards'
import { usePropertiesQuery } from '@/features/properties/api'

export function OwnerDashboardPage({
  section = 'Today',
}: {
  section?: string
}) {
  const { session, membership } = useAuth()
  const { showToast } = useToast()
  const orgId = membership?.org_id ?? ''
  const propertiesQuery = usePropertiesQuery()
  const properties = Array.isArray(propertiesQuery.data)
    ? propertiesQuery.data
    : []
  const {
    boards,
    totals,
    isLoading: boardsLoading,
  } = useBoards(orgId, properties)
  const pendingQuery = usePendingDiscounts()
  const pending = Array.isArray(pendingQuery.data) ? pendingQuery.data : []
  const decide = useDecideDiscount((msg) => showToast(msg, 'error'))
  const [decidingId, setDecidingId] = useState<string | null>(null)

  const isHome = section === 'Today'

  const [periodKind, setPeriodKind] = useState<PeriodKind>('this')
  const [custom, setCustom] = useState(() => monthPeriod('this'))
  const customInvalid = periodKind === 'custom' && (!custom.from || !custom.to || custom.from > custom.to)
  const period = useMemo(
    () => (periodKind === 'custom' ? (customInvalid ? null : custom) : monthPeriod(periodKind)),
    [periodKind, custom, customInvalid],
  )
  const dashboardQuery = useDashboardQuery(isHome ? period : null)
  const dashboard = isDashboard(dashboardQuery.data) ? dashboardQuery.data : null
  const dashboardError = dashboardQuery.error
  useEffect(() => {
    if (dashboardError) showToast(dashboardError.message, 'error')
  }, [dashboardError, showToast])
  const dashLoading = dashboardQuery.isLoading
  const totalsPnl = useMemo(() => sumPnl(dashboard?.pnl ?? []), [dashboard])
  const duesQuery = useDuesQuery(null)
  const duesTotal = Array.isArray(duesQuery.data)
    ? duesQuery.data.reduce((n, d) => n + d.outstanding_paise, 0)
    : null

  // Bed counts: the dashboard's occupancy replaces the client-side tally when it is available.
  const occupancyByProperty = new Map((dashboard?.occupancy ?? []).map((o) => [o.property_id, o]))
  const bedTotals = dashboard
    ? dashboard.occupancy.reduce(
        (a, o) => ({
          total: a.total + o.beds_total,
          occupied: a.occupied + o.occupied,
          vacant: a.vacant + o.vacant,
          onNotice: a.onNotice + o.on_notice,
        }),
        { total: 0, occupied: 0, vacant: 0, onNotice: 0 },
      )
    : totals
  const pendingApprovals = dashboard ? dashboard.attention.pending_discounts : pending.length
  const loading = propertiesQuery.isLoading || (dashboard ? false : boardsLoading)

  const movingOutSoon = useMemo(() => {
    const beds = boards
      .flatMap((b) => b.beds)
      .filter((b) => b.is_active && b.status === 'on_notice')
    return beds
      .filter((b) => {
        const d = b.stay?.expected_vacate_date
        return d ? daysUntilIST(d) <= 14 : false
      })
      .sort((a, b) =>
        (a.stay?.expected_vacate_date ?? '9999-99-99').localeCompare(
          b.stay?.expected_vacate_date ?? '9999-99-99',
        ),
      )
  }, [boards])

  const filled = bedTotals.occupied + bedTotals.onNotice
  const filledPct = bedTotals.total > 0 ? Math.round((filled / bedTotals.total) * 100) : 0
  const showFlagged = Boolean(dashboard && totalsPnl.flagged > 0)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={<DateLine />}
        title={isHome ? greeting(session?.me.full_name) : section}
        actions={
          section === 'Money' ? (
            <Button asChild variant="secondary" size="sm">
              <Link to="/owner/money/cash">
                <HandCoins aria-hidden="true" />
                Cash in hand
              </Link>
            </Button>
          ) : undefined
        }
      />

      {isHome && (
        <section aria-label="Money" className="flex flex-col gap-3">
          <PeriodSwitcher
            kind={periodKind}
            onKind={setPeriodKind}
            custom={custom}
            onCustom={setCustom}
            invalid={customInvalid}
          />
          {dashLoading && <Skeleton className="h-52 w-full rounded-card" />}
          {dashboard && (
            <CollectionCard
              confirmedPaise={totalsPnl.collected}
              provisionalPaise={totalsPnl.provisional}
              duePaise={duesTotal}
              dueCount={Array.isArray(duesQuery.data) ? duesQuery.data.length : 0}
            />
          )}
          <Card className="overflow-hidden">
            <dl className="grid grid-cols-2 lg:grid-cols-3 [&>*:nth-last-child(-n+2)]:border-b-0">
              <MoneyRow label="Expenses" value={moneyStat(dashLoading, dashboard && totalsPnl.expenses)} to="/owner/expenses" />
              <MoneyRow label="Net profit" value={moneyStat(dashLoading, dashboard && totalsPnl.net)} strong />
              {showFlagged && (
                <MoneyRow label="Flagged" value={moneyStat(dashLoading, totalsPnl.flagged)} to="/owner/money/reconcile" tone="danger" />
              )}
            </dl>
          </Card>
        </section>
      )}

      {isHome && (
        <section aria-label="Quick actions" className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link to="/owner/beds">Bed board</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link to="/owner/money/dues">Dues &amp; rent</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link to="/owner/check-ins">Check-ins</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link to="/owner/expenses">Expenses</Link>
          </Button>
        </section>
      )}

      {isHome && (
        <section aria-label="Summary">
          <Card className="flex flex-col gap-4 border-brand/30 bg-gradient-to-br from-brand/12 via-surface to-surface p-4 sm:p-5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-brand-ink">Beds filled</p>
                {loading ? (
                  <Skeleton className="mt-1 h-8 w-28" />
                ) : (
                  <p className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink tabular-nums">
                    <span>{filled}</span>
                    <span className="text-[17px] font-semibold text-muted"> of </span>
                    <span>{bedTotals.total}</span>
                  </p>
                )}
              </div>
              {!loading && bedTotals.total > 0 && (
                <span className="rounded-full bg-brand/20 px-3 py-1 text-[16px] font-bold text-brand-ink tabular-nums">
                  {filledPct}%
                </span>
              )}
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-amber-500 transition-all"
                style={{ width: `${filledPct}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Link
                to="/owner/beds"
                className="flex flex-col gap-0.5 rounded-control border border-line bg-surface/90 px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                <span className="text-[12px] font-medium text-muted">Vacant beds</span>
                <span className="text-[18px] font-bold text-success-ink tabular-nums">{bedTotals.vacant}</span>
              </Link>
              <Link
                to="/owner/beds"
                className="flex flex-col gap-0.5 rounded-control border border-line bg-surface/90 px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                <span className="text-[12px] font-medium text-muted">On notice</span>
                <span className="text-[18px] font-bold text-warning-ink tabular-nums">{bedTotals.onNotice}</span>
              </Link>
              <Link
                to="/owner/money/dues"
                className="flex flex-col gap-0.5 rounded-control border border-line bg-surface/90 px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                <span className="text-[12px] font-medium text-muted">Pending dues</span>
                <span className="text-[18px] font-bold text-danger-ink tabular-nums">
                  {duesTotal != null ? <Money paise={duesTotal} /> : '—'}
                </span>
              </Link>
              <Link
                to={pendingApprovals > 0 ? '/owner/approvals' : '/owner/properties'}
                className="flex flex-col gap-0.5 rounded-control border border-line bg-surface/90 px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                <span className="text-[12px] font-medium text-muted">
                  {pendingApprovals > 0 ? 'Approvals' : properties.length === 1 ? 'Building' : 'Buildings'}
                </span>
                <span className="text-[18px] font-bold text-brand-ink tabular-nums">
                  {pendingApprovals > 0 ? pendingApprovals : properties.length}
                </span>
              </Link>
            </div>
          </Card>
        </section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {isHome && dashboard && <PnlCard rows={dashboard.pnl} />}
          <Card className="overflow-hidden" aria-label="Occupancy">
            <CardHeader
              title="Occupancy"
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link to="/owner/properties">View all</Link>
                </Button>
              }
            />
            {propertiesQuery.isLoading && (
              <LoadingRows label="Loading properties…" />
            )}
            {propertiesQuery.data && properties.length === 0 && (
              <EmptyState
                action={
                  <Button asChild>
                    <Link to="/owner/properties/new">Add property</Link>
                  </Button>
                }
              >
                No buildings added yet.
              </EmptyState>
            )}
            {properties.length > 0 && (
              <CardList>
                {boards.map(({ property: p, counts: boardCounts, isLoading: boardLoading }) => {
                  const occ = occupancyByProperty.get(p.id)
                  const counts = occ
                    ? { total: occ.beds_total, vacant: occ.vacant, occupied: occ.occupied, onNotice: occ.on_notice }
                    : boardCounts
                  const isLoading = occ ? false : boardLoading
                  const full = properties.find((x) => x.id === p.id)
                  return (
                    <li key={p.id}>
                      <Link
                        to={`/owner/properties/${p.id}`}
                        className={ROW_LINK}
                      >
                        <div className="flex flex-col gap-2 px-4 py-3.5 sm:px-5">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate text-[14.5px] font-semibold text-ink">{p.name}</span>
                            {isLoading ? (
                              <Skeleton className="h-3 w-14" />
                            ) : (
                              <span
                                className={
                                  'shrink-0 text-[13px] tabular-nums ' +
                                  (counts.vacant > 0 ? 'font-semibold text-success-ink' : 'text-muted')
                                }
                              >
                                {counts.vacant} vacant
                              </span>
                            )}
                          </div>
                          {!isLoading && (
                            <OccupancyBar wide occupied={counts.occupied + counts.onNotice} total={counts.total} />
                          )}
                          {(full?.locality || !full?.upi_vpa) && (
                            <span className="truncate text-[12.5px] text-muted">
                              {[full?.locality, full?.upi_vpa ? null : 'No UPI set'].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </CardList>
            )}
          </Card>

          {isHome &&
            (!loading && movingOutSoon.length === 0 ? (
              <QuietEmptySection
                title="Moving out soon"
                message="Nobody moving out in the next 14 days."
              />
            ) : (
              <Card className="overflow-hidden" aria-label="Moving out soon">
                <CardHeader
                  title={
                    <>
                      Moving out soon{' '}
                      {!loading && (
                        <span className="ml-1 text-muted tabular-nums">
                          ({movingOutSoon.length})
                        </span>
                      )}
                    </>
                  }
                  description="On-notice beds in the next 14 days"
                />
                {loading ? (
                  <LoadingRows label="Loading move-outs…" rows={2} />
                ) : (
                  <CardList>
                    {movingOutSoon.map((b) => {
                      const row = (
                        <ListRow
                          title={
                            <>
                              {b.label}
                              {b.stay?.resident.full_name && (
                                <span className="font-normal text-muted">
                                  {' '}
                                  · {b.stay.resident.full_name}
                                </span>
                              )}
                            </>
                          }
                          meta={
                            <>
                              {b.propertyName} · Room {b.roomLabel}
                              {b.stay?.expected_vacate_date && (
                                <>
                                  {' · '}
                                  <DateText
                                    value={b.stay.expected_vacate_date}
                                  />
                                </>
                              )}
                            </>
                          }
                          trailing={
                            b.stay?.expected_vacate_date ? (
                              <DaysLeftBadge
                                vacateDate={b.stay.expected_vacate_date}
                              />
                            ) : (
                              <StatusBadge kind="bed" value="on_notice" />
                            )
                          }
                        />
                      )
                      return (
                        <li key={b.id}>
                          {b.stay ? (
                            <Link
                              to={`/owner/residents/${b.stay.resident.id}`}
                              className={ROW_LINK}
                            >
                              {row}
                            </Link>
                          ) : (
                            row
                          )}
                        </li>
                      )
                    })}
                  </CardList>
                )}
              </Card>
            ))}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
        {isHome && dashboard && <AttentionCard attention={dashboard.attention} />}
        {isHome && <OpenComplaintsCard base="/owner" showProperty={(properties?.length ?? 0) > 1} />}
        {isHome && <RecentActivityCard />}
        {isHome &&
          (!pendingQuery.isLoading && pending.length === 0 ? (
            <QuietEmptySection
              title="Needs your decision"
              message="Nothing waiting for you."
            />
          ) : (
            <Card className="overflow-hidden" aria-label="Needs your decision">
              <CardHeader
                title={
                  <>
                    Needs your decision{' '}
                    {!pendingQuery.isLoading && (
                      <span className="ml-1 text-muted tabular-nums">
                        ({pending.length})
                      </span>
                    )}
                  </>
                }
                action={
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/owner/approvals">Open approvals</Link>
                  </Button>
                }
              />
              {pendingQuery.isLoading ? (
                <LoadingRows label="Loading approvals…" rows={2} />
              ) : (
                <ul
                  className="flex flex-col gap-3 p-4 sm:p-5"
                  aria-label="Pending discount requests"
                >
                  {pending.slice(0, 3).map((r) => (
                    <DiscountRequestCard
                      key={r.id}
                      request={r}
                      busy={decide.isPending && decidingId === r.id}
                      onDecide={(decision, note) => {
                        setDecidingId(r.id)
                        decide.mutate({ id: r.id, decision, note })
                      }}
                    />
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

function moneyStat(loading: boolean, paise: number | null | undefined) {
  if (loading) return <Skeleton className="h-7 w-20" />
  return typeof paise === 'number' ? <Money paise={paise} /> : '–'
}

function MoneyRow({
  label,
  value,
  to,
  strong = false,
  tone,
}: {
  label: string
  value: React.ReactNode
  to?: string
  strong?: boolean
  tone?: 'danger'
}) {
  const body = (
    <>
      <dt className="text-[12.5px] font-medium text-muted">{label}</dt>
      <dd
        className={
          'mt-0.5 text-[17px] font-bold tracking-[-0.01em] tabular-nums ' +
          (tone === 'danger' ? 'text-danger-ink' : strong ? 'text-brand-ink' : 'text-ink')
        }
      >
        {value}
      </dd>
    </>
  )
  const cls = 'block border-b border-r border-line px-4 py-3 [&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(3n)]:border-r-0'
  return to ? (
    <Link to={to} className={cls + ' transition-colors hover:bg-surface-2 active:bg-surface-2'}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
