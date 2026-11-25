import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { Card, CardHeader, CardList } from '@/components/ui/card'
import { EmptyState, ListRow, LoadingRows, PageHeader, Skeleton, StatTile } from '@/components/ui/misc'
import { useAuth } from '@/features/auth/AuthContext'
import { DateLine } from '@/features/home/parts'
import { greeting, useBoards } from '@/features/home/useBoards'
import { usePropertiesQuery } from '@/features/properties/api'

export function CaretakerHomePage({ section = 'Home' }: { section?: string }) {
  const { session, membership } = useAuth()
  const orgId = membership?.org_id ?? ''
  const propertiesQuery = usePropertiesQuery()
  const properties = Array.isArray(propertiesQuery.data) ? propertiesQuery.data : []
  const { boards, totals, isLoading: boardsLoading } = useBoards(orgId, properties)
  const loading = propertiesQuery.isLoading || boardsLoading
  const multi = properties.length > 1
  const beds = boards.flatMap((b) => b.beds).filter((b) => b.is_active)

  const movingOut = beds
    .filter((b) => b.status === 'on_notice')
    .sort((a, b) => (a.stay?.expected_vacate_date ?? '9999').localeCompare(b.stay?.expected_vacate_date ?? '9999'))
  const vacant = beds.filter((b) => b.status === 'vacant').sort((a, b) => a.label.localeCompare(b.label))
  const stat = (v: number) => (loading ? <Skeleton className="h-7 w-10" /> : v)
  const where = (b: (typeof beds)[number]) => (multi ? `${b.propertyName} · Room ${b.roomLabel}` : `Room ${b.roomLabel}`)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<DateLine />}
        title={section === 'Home' ? greeting(session?.me.full_name) : section}
        description={
          <>
            {properties.length === 1 ? properties[0].name : membership?.organization_name} · Caretaker workspace
          </>
        }
      />

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
          <Card className="overflow-hidden">
            <CardHeader title="Moving out soon" description="Residents on notice, earliest first" />
            {loading && <LoadingRows label="Loading beds…" rows={2} />}
            {!loading && movingOut.length === 0 && <EmptyState>Nobody is on notice.</EmptyState>}
            {!loading && movingOut.length > 0 && (
              <CardList>
                {movingOut.map((b) => (
                  <li key={b.id}>
                    <ListRow
                      title={
                        <>
                          {b.label}
                          {b.stay?.resident.full_name && (
                            <span className="font-normal text-muted"> · {b.stay.resident.full_name}</span>
                          )}
                        </>
                      }
                      meta={where(b)}
                      trailing={
                        b.stay?.expected_vacate_date ? (
                          <span className="text-[13px] font-medium text-ink">
                            <DateText value={b.stay.expected_vacate_date} />
                          </span>
                        ) : (
                          <StatusBadge kind="bed" value="on_notice" />
                        )
                      }
                    />
                  </li>
                ))}
              </CardList>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Vacant beds" description="Floor rent per bed" />
            {loading && <LoadingRows label="Loading beds…" rows={2} />}
            {!loading && vacant.length === 0 && <EmptyState>No vacant beds.</EmptyState>}
            {!loading && vacant.length > 0 && (
              <CardList>
                {vacant.map((b) => (
                  <li key={b.id}>
                    <ListRow
                      title={b.label}
                      meta={where(b)}
                      trailing={
                        <span className="text-[14px] font-semibold text-ink">
                          <Money paise={b.base_rent_paise} />
                        </span>
                      }
                    />
                  </li>
                ))}
              </CardList>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
