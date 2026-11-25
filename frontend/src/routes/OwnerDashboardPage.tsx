import { Building2, CheckCircle2, ChevronRight, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Money } from '@/components/Money'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardList } from '@/components/ui/card'
import { EmptyState, ListRow, LoadingRows, PageHeader, ROW_LINK, Skeleton, StatTile } from '@/components/ui/misc'
import { usePendingDiscounts } from '@/features/approvals/useDiscountRequests'
import { useAuth } from '@/features/auth/AuthContext'
import { DateLine, OccupancyBar } from '@/features/home/parts'
import { greeting, useBoards } from '@/features/home/useBoards'
import { usePropertiesQuery } from '@/features/properties/api'

export function OwnerDashboardPage({ section = 'Today' }: { section?: string }) {
  const { session, membership } = useAuth()
  const orgId = membership?.org_id ?? ''
  const propertiesQuery = usePropertiesQuery()
  const properties = Array.isArray(propertiesQuery.data) ? propertiesQuery.data : []
  const { boards, totals, isLoading: boardsLoading } = useBoards(orgId, properties)
  const pendingQuery = usePendingDiscounts()
  const pending = Array.isArray(pendingQuery.data) ? pendingQuery.data : []

  const loading = propertiesQuery.isLoading || boardsLoading
  const isHome = section === 'Today'
  const stat = (v: number) => (loading ? <Skeleton className="h-7 w-10" /> : v)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<DateLine />}
        title={isHome ? greeting(session?.me.full_name) : section}
        description={<>{membership?.organization_name} · Owner workspace</>}
        actions={
          isHome && (
            <Button asChild variant="secondary" className="max-sm:flex-1">
              <Link to="/owner/properties/new">
                <Plus aria-hidden="true" />
                Add property
              </Link>
            </Button>
          )
        }
      />

      {isHome && (
        <section aria-label="Summary" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Properties" value={propertiesQuery.isLoading ? <Skeleton className="h-7 w-10" /> : properties.length} />
          <StatTile label="Total beds" value={stat(totals.total)} />
          <StatTile label="Occupied" value={stat(totals.occupied)} />
          <StatTile label="Vacant" value={stat(totals.vacant)} />
          <StatTile label="On notice" value={stat(totals.onNotice)} />
          <Link to="/owner/approvals" className="rounded-card active:opacity-80">
            <StatTile
              label="Pending approvals"
              value={pendingQuery.isLoading ? <Skeleton className="h-7 w-10" /> : pending.length}
              highlight={pending.length > 0}
              className="h-full"
            />
          </Link>
        </section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Properties"
            action={
              <Button asChild variant="ghost" size="sm">
                <Link to="/owner/properties">View all</Link>
              </Button>
            }
          />
          {propertiesQuery.isLoading && <LoadingRows label="Loading properties…" />}
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
              {boards.map(({ property: p, counts, isLoading }) => {
                const full = properties.find((x) => x.id === p.id)
                return (
                  <li key={p.id}>
                    <Link to={`/owner/properties/${p.id}`} className={ROW_LINK}>
                      <ListRow
                        leading={
                          <span className="inline-flex size-9 items-center justify-center rounded-full bg-surface-2 text-muted">
                            <Building2 className="size-[18px]" aria-hidden="true" />
                          </span>
                        }
                        title={p.name}
                        meta={
                          [full?.locality, full?.upi_vpa ? null : 'No UPI set'].filter(Boolean).join(' · ') || undefined
                        }
                        trailing={
                          isLoading ? (
                            <Skeleton className="h-3 w-24" />
                          ) : (
                            <OccupancyBar occupied={counts.occupied + counts.onNotice} total={counts.total} />
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

        {isHome && (
          <Card className="overflow-hidden">
            <CardHeader
              title="Pending approvals"
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link to="/owner/approvals">Open approvals</Link>
                </Button>
              }
            />
            {pendingQuery.isLoading && <LoadingRows label="Loading approvals…" rows={2} />}
            {!pendingQuery.isLoading && pending.length === 0 && <EmptyState>Nothing waiting for you.</EmptyState>}
            {pending.length > 0 && (
              <CardList>
                {pending.slice(0, 3).map((r) => (
                  <li key={r.id}>
                    <Link to="/owner/approvals" className={ROW_LINK}>
                      <ListRow
                        leading={
                          <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                            <CheckCircle2 className="size-[18px]" aria-hidden="true" />
                          </span>
                        }
                        title={`Discount · ${r.bed_label}`}
                        meta={[r.resident_name, r.requested_by_name].filter(Boolean).join(' · ')}
                        trailing={
                          <>
                            <span className="text-[13px] font-semibold text-ink tabular-nums">
                              <Money paise={r.requested_rent_paise} />
                            </span>
                            <ChevronRight className="size-4 text-subtle" aria-hidden="true" />
                          </>
                        }
                      />
                    </Link>
                  </li>
                ))}
              </CardList>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
