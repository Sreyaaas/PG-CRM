import { CollectionCard } from '@/features/dashboard/CollectionCard'
import { RecentActivityCard } from '@/features/dashboard/RecentActivityCard'
import { OpenComplaintsCard } from '@/features/complaints/OpenComplaintsCard'
import { useEffect, useMemo, useState } from 'react'
import {
  BedDouble,
  Building2,
  CheckCircle2,
  HandCoins,
  Plus,
  UserPlus,
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
  StatTile,
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
  const stat = (v: number) => (loading ? <Skeleton className="h-7 w-10" /> : v)

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<DateLine />}
        title={isHome ? greeting(session?.me.full_name) : section}
        description={<>{membership?.organization_name} · Owner workspace</>}
        actions={
          section === 'Money' ? (
            <Button asChild variant="secondary" size="sm">
              <Link to="/owner/money/cash">
                <HandCoins aria-hidden="true" />
                Cash in hand
              </Link>
            </Button>
          ) : (
            isHome && (
              <>
                <Button asChild variant="secondary" size="sm">
                  <Link to="/owner/beds">
                    <BedDouble aria-hidden="true" />
                    Bed board
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <Link to="/owner/properties/new">
                    <Plus aria-hidden="true" />
                    Add property
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <Link to="/owner/staff">
                    <UserPlus aria-hidden="true" />
                    Add caretaker
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <Link to="/owner/approvals">
                    <CheckCircle2 aria-hidden="true" />
                    Approvals
                  </Link>
                </Button>
              </>
            )
          )
        }
      />

      {isHome && (
        <section
          aria-label="Summary"
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6"
        >
          <StatTile
            label="Properties"
            value={
              propertiesQuery.isLoading ? (
                <Skeleton className="h-7 w-10" />
              ) : (
                properties.length
              )
            }
          />
          <StatTile label="Total beds" value={stat(bedTotals.total)} />
          <StatTile label="Occupied" value={stat(bedTotals.occupied)} />
          <StatTile label="Vacant" value={stat(bedTotals.vacant)} />
          <StatTile label="On notice" value={stat(bedTotals.onNotice)} />
          <Link
            to="/owner/approvals"
            className="rounded-card active:opacity-80"
          >
            <StatTile
              label="Pending approvals"
              value={
                pendingQuery.isLoading && !dashboard ? (
                  <Skeleton className="h-7 w-10" />
                ) : (
                  pendingApprovals
                )
              }
              highlight={pendingApprovals > 0}
              className="h-full"
            />
          </Link>
        </section>
      )}

      {isHome && (
        <section aria-label="Money" className="flex flex-col gap-3">
          <PeriodSwitcher
            kind={periodKind}
            onKind={setPeriodKind}
            custom={custom}
            onCustom={setCustom}
            invalid={customInvalid}
          />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Collected" value={moneyStat(dashLoading, dashboard && totalsPnl.collected)} />
            <StatTile label="Provisional" value={moneyStat(dashLoading, dashboard && totalsPnl.provisional)} />
            <StatTile label="Flagged" value={moneyStat(dashLoading, dashboard && totalsPnl.flagged)} />
            <StatTile label="Expenses" value={moneyStat(dashLoading, dashboard && totalsPnl.expenses)} />
            <StatTile label="Net profit" value={moneyStat(dashLoading, dashboard && totalsPnl.net)} highlight />
            <Link to="/owner/money" className="rounded-card active:opacity-80">
              <StatTile
                label="Dues outstanding"
                value={moneyStat(duesQuery.isLoading, duesTotal)}
                className="h-full"
              />
            </Link>
          </div>
          {dashboard && duesTotal !== null && (
            <CollectionCard
              confirmedPaise={totalsPnl.collected}
              provisionalPaise={totalsPnl.provisional}
              duePaise={duesTotal}
              dueCount={Array.isArray(duesQuery.data) ? duesQuery.data.length : 0}
            />
          )}
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
                        <ListRow
                          leading={
                            <span className="inline-flex size-9 items-center justify-center rounded-full bg-surface-2 text-muted">
                              <Building2
                                className="size-[18px]"
                                aria-hidden="true"
                              />
                            </span>
                          }
                          title={p.name}
                          meta={
                            [
                              full?.locality,
                              full?.upi_vpa ? null : 'No UPI set',
                            ]
                              .filter(Boolean)
                              .join(' · ') || undefined
                          }
                          trailing={
                            isLoading ? (
                              <Skeleton className="h-3 w-24" />
                            ) : (
                              <div className="flex items-center gap-3">
                                <span className="text-[12.5px] text-muted tabular-nums">
                                  {counts.vacant} vacant
                                </span>
                                <OccupancyBar
                                  occupied={counts.occupied + counts.onNotice}
                                  total={counts.total}
                                />
                              </div>
                            )
                          }
                        />
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
