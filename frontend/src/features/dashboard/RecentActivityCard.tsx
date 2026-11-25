import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { Card, CardHeader, CardList } from '@/components/ui/card'
import { Avatar, ListRow, LoadingRows } from '@/components/ui/misc'
import { ageLabel } from '@/features/complaints/api'
import { QuietEmptySection } from '@/features/home/parts'
import { useOrgId } from '@/features/properties/api'

/** What staff did recently, from the audit log: lets an absentee owner see the day at a glance. */
export function RecentActivityCard({ limit = 8 }: { limit?: number }) {
  const orgId = useOrgId()
  const query = useQuery({
    queryKey: ['activity', orgId, limit],
    enabled: Boolean(orgId),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/activity', {
        params: { query: { limit }, header: { 'x-org-id': orgId } },
      })
      return Array.isArray(data) ? data : []
    },
  })

  if (query.isError) return null
  if (query.data && query.data.length === 0) {
    return <QuietEmptySection title="Recent activity" message="Nothing has happened yet." />
  }

  return (
    <Card className="overflow-hidden" aria-label="Recent activity">
      <CardHeader title="Recent activity" description="Latest changes by you and your staff" />
      {query.isLoading ? (
        <LoadingRows label="Loading activity…" rows={3} />
      ) : (
        <CardList>
          {query.data?.map((a) => (
            <li key={a.id}>
              <ListRow
                leading={<Avatar name={a.actor_name ?? 'System'} />}
                title={<span className="whitespace-normal">{a.summary}</span>}
                meta={
                  <>
                    {a.actor_name ?? 'System'} · {ageLabel(a.at)}
                  </>
                }
              />
            </li>
          ))}
        </CardList>
      )}
    </Card>
  )
}
