import { useMemo, useState } from 'react'
import { BedDouble } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge, type Tone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardList } from '@/components/ui/card'
import { EmptyState, ListRow, LoadingRows, PageHeader, ROW_LINK, Skeleton, StatTile } from '@/components/ui/misc'
import { useMyDiscountRequests } from '@/features/approvals/useDiscountRequests'
import { useAuth } from '@/features/auth/AuthContext'
import { DateLine, DaysLeftBadge, QuietEmptySection } from '@/features/home/parts'
import { addCounts, greeting, useBoards, type BoardBedWithRoom } from '@/features/home/useBoards'
import { usePropertiesQuery } from '@/features/properties/api'
import { cn } from '@/lib/utils'

const DISCOUNT_STATUS: Record<'pending' | 'approved' | 'rejected', { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
}

export function CaretakerHomePage({ section = 'Home' }: { section?: string }) {
  const { session, membership } = useAuth()
  const orgId = membership?.org_id ?? ''
  const propertiesQuery = usePropertiesQuery()
  const properties = Array.isArray(propertiesQuery.data) ? propertiesQuery.data : []
  const { boards, isLoading: boardsLoading } = useBoards(orgId, properties)
  const discountsQuery = useMyDiscountRequests()

  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('all')
  const effectivePropertyId =
    selectedPropertyId !== 'all' && properties.some((p) => p.id === selectedPropertyId) ? selectedPropertyId : 'all'

  const visibleBoards = useMemo(
    () => (effectivePropertyId === 'all' ? boards : boards.filter((b) => b.property.id === effectivePropertyId)),
    [boards, effectivePropertyId],
  )
  const totals = useMemo(() => addCounts(visibleBoards.map((b) => b.counts)), [visibleBoards])
  const beds = useMemo(() => visibleBoards.flatMap((b) => b.beds).filter((b) => b.is_active), [visibleBoards])

  const loading = propertiesQuery.isLoading || boardsLoading
  const multi = properties.length > 1
  const showPropertyInMeta = multi && effectivePropertyId === 'all'

  const movingOut = useMemo(
    () =>
      beds
        .filter((b) => b.status === 'on_notice')
        .sort((a, b) => (a.stay?.expected_vacate_date ?? '9999-99-99').localeCompare(b.stay?.expected_vacate_date ?? '9999-99-99')),
    [beds],
  )

  const vacant = useMemo(
    () => beds.filter((b) => b.status === 'vacant').sort((a, b) => a.label.localeCompare(b.label)),
    [beds],
  )

  const vacantByRoom = useMemo(() => {
    const groups = new Map<string, { key: string; roomLabel: string; propertyName: string; beds: BoardBedWithRoom[] }>()
    for (const bed of vacant) {
      const key = `${bed.propertyId}:${bed.roomLabel}`
      const existing = groups.get(key)
      if (existing) existing.beds.push(bed)
      else groups.set(key, { key, roomLabel: bed.roomLabel, propertyName: bed.propertyName, beds: [bed] })
    }
    return Array.from(groups.values()).sort((a, b) =>
      showPropertyInMeta
        ? `${a.propertyName} ${a.roomLabel}`.localeCompare(`${b.propertyName} ${b.roomLabel}`)
        : a.roomLabel.localeCompare(b.roomLabel),
    )
  }, [vacant, showPropertyInMeta])

  const myDiscounts = useMemo(() => {
    const all = Array.isArray(discountsQuery.data) ? discountsQuery.data : []
    const userId = session?.me.id
    return all.filter((r) => {
      if (userId && r.requested_by !== userId) return false
      if (effectivePropertyId !== 'all' && r.property_id !== effectivePropertyId) return false
      return true
    })
  }, [discountsQuery.data, session?.me.id, effectivePropertyId])

  const stat = (v: number) => (loading ? <Skeleton className="h-7 w-10" /> : v)
  const where = (b: BoardBedWithRoom) =>
    showPropertyInMeta ? `${b.propertyName} · Room ${b.roomLabel}` : `Room ${b.roomLabel}`

  const selectedPropName =
    effectivePropertyId !== 'all' ? properties.find((p) => p.id === effectivePropertyId)?.name : undefined

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<DateLine />}
        title={section === 'Home' ? greeting(session?.me.full_name) : section}
        description={
          <>
            Issues · {selectedPropName ?? (properties.length === 1 ? properties[0].name : membership?.organization_name)} · Caretaker workspace
          </>
        }
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link to="/caretaker/beds">
              <BedDouble aria-hidden="true" />
              Bed board
            </Link>
          </Button>
        }
      />

      {multi && (
        <div role="group" aria-label="Property filter" className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={effectivePropertyId === 'all'}
            onClick={() => setSelectedPropertyId('all')}
            className={cn(
              'min-h-9 rounded-chip border px-3.5 text-[13px] font-medium transition-colors',
              effectivePropertyId === 'all'
                ? 'border-brand bg-brand-soft text-brand-ink'
                : 'border-line bg-surface text-muted hover:text-ink',
            )}
          >
            All properties
          </button>
          {properties.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={effectivePropertyId === p.id}
              onClick={() => setSelectedPropertyId(p.id)}
              className={cn(
                'min-h-9 rounded-chip border px-3.5 text-[13px] font-medium transition-colors',
                effectivePropertyId === p.id
                  ? 'border-brand bg-brand-soft text-brand-ink'
                  : 'border-line bg-surface text-muted hover:text-ink',
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <section aria-label="Beds summary" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile label="Beds" value={stat(totals.total)} />
        <StatTile label="Occupied" value={stat(totals.occupied)} />
        <StatTile label="Vacant" value={stat(totals.vacant)} highlight={!loading && totals.vacant > 0} />
        <StatTile label="On notice" value={stat(totals.onNotice)} />
      </section>

      {propertiesQuery.data && properties.length === 0 && (
        <Card>
          <EmptyState>No buildings assigned yet.</EmptyState>
        </Card>
      )}

      {(loading || properties.length > 0) && (
        <>
          {!loading && movingOut.length === 0 ? (
            <QuietEmptySection title="Notices and move-outs" message="Nobody is on notice." />
          ) : (
            <Card className="overflow-hidden" aria-label="Notices and move-outs">
              <CardHeader
                title={
                  <>
                    Notices and move-outs{' '}
                    {!loading && <span className="ml-1 text-muted tabular-nums">({movingOut.length})</span>}
                  </>
                }
                description="Overdue and soonest vacate date first"
              />
              {loading ? (
                <LoadingRows label="Loading notices…" rows={2} />
              ) : (
                <CardList>
                  {movingOut.map((b) => {
                    const row = (
                      <ListRow
                        title={
                          <>
                            {b.label}
                            {b.stay?.resident.full_name && (
                              <span className="font-normal text-muted"> · {b.stay.resident.full_name}</span>
                            )}
                          </>
                        }
                        meta={
                          <>
                            {where(b)}
                            {b.stay?.expected_vacate_date && (
                              <>
                                {' · '}
                                <DateText value={b.stay.expected_vacate_date} />
                              </>
                            )}
                          </>
                        }
                        trailing={
                          b.stay?.expected_vacate_date ? (
                            <DaysLeftBadge vacateDate={b.stay.expected_vacate_date} />
                          ) : (
                            <StatusBadge kind="bed" value="on_notice" />
                          )
                        }
                      />
                    )
                    return (
                      <li key={b.id}>
                        {b.stay ? (
                          <Link to={`/caretaker/residents/${b.stay.resident.id}`} className={ROW_LINK}>
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
          )}

          {!loading && vacant.length === 0 ? (
            <QuietEmptySection title="Vacant beds" message="No vacant beds." />
          ) : (
            <Card className="overflow-hidden" aria-label="Vacant beds">
              <CardHeader
                title={
                  <>
                    Vacant beds {!loading && <span className="ml-1 text-muted tabular-nums">({vacant.length})</span>}
                  </>
                }
                description="Grouped by room, floor rent per bed"
              />
              {loading ? (
                <LoadingRows label="Loading vacant beds…" rows={2} />
              ) : (
                <div className="divide-y divide-line">
                  {vacantByRoom.map((group) => (
                    <div key={group.key}>
                      <div className="bg-surface-2 px-4 py-1.5 text-[12px] font-semibold text-muted sm:px-5">
                        {showPropertyInMeta ? `${group.propertyName} · Room ${group.roomLabel}` : `Room ${group.roomLabel}`}
                      </div>
                      <CardList>
                        {group.beds.map((b) => (
                          <li key={b.id}>
                            <ListRow
                              title={b.label}
                              meta={`Room ${b.roomLabel}`}
                              trailing={
                                <span className="text-[14px] font-semibold text-ink">
                                  <Money paise={b.base_rent_paise} />
                                </span>
                              }
                            />
                          </li>
                        ))}
                      </CardList>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {!discountsQuery.isLoading && myDiscounts.length === 0 ? (
            <QuietEmptySection title="My discount requests" message="No discount requests." />
          ) : (
            <Card className="overflow-hidden" aria-label="My discount requests">
              <CardHeader
                title={
                  <>
                    My discount requests{' '}
                    {!discountsQuery.isLoading && (
                      <span className="ml-1 text-muted tabular-nums">({myDiscounts.length})</span>
                    )}
                  </>
                }
                description="Pending and decided requests"
              />
              {discountsQuery.isLoading ? (
                <LoadingRows label="Loading discount requests…" rows={2} />
              ) : (
                <CardList>
                  {myDiscounts.map((r) => {
                    const spec = DISCOUNT_STATUS[r.status]
                    return (
                      <li key={r.id}>
                        <ListRow
                          title={
                            <>
                              {showPropertyInMeta ? `${r.property_name} · ${r.bed_label}` : r.bed_label}
                              {r.resident_name && (
                                <span className="font-normal text-muted"> · {r.resident_name}</span>
                              )}
                            </>
                          }
                          meta={
                            <>
                              <DateText value={r.created_at} />
                              {r.decision_note ? ` · ${r.decision_note}` : ` · ${r.reason}`}
                            </>
                          }
                          trailing={
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-semibold text-ink">
                                <Money paise={r.requested_rent_paise} />
                              </span>
                              <Badge tone={spec.tone}>{spec.label}</Badge>
                            </div>
                          }
                        />
                      </li>
                    )
                  })}
                </CardList>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  )
}
