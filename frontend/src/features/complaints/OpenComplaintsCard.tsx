import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardList } from '@/components/ui/card'
import { LoadingRows } from '@/components/ui/misc'
import { QuietEmptySection } from '@/features/home/parts'
import { sortComplaints, useComplaintsQuery, type Complaint } from './api'
import { ComplaintRow, ComplaintSheet } from './ComplaintsPage'

/** Home-screen queue: the unresolved complaints that need someone next, urgent and longest-waiting first. */
export function OpenComplaintsCard({
  base,
  propertyId = null,
  limit = 4,
  showProperty = false,
}: {
  base: '/owner' | '/caretaker'
  propertyId?: string | null
  limit?: number
  showProperty?: boolean
}) {
  const query = useComplaintsQuery({ propertyId })
  const [selected, setSelected] = useState<Complaint | null>(null)
  const open = useMemo(() => sortComplaints((query.data ?? []).filter((c) => c.status !== 'resolved')), [query.data])
  const urgent = open.filter((c) => c.priority === 'urgent').length

  if (query.isError) return null
  if (!query.isLoading && open.length === 0) {
    return <QuietEmptySection title="Complaints" message="No open complaints." />
  }

  const current = selected ? (open.find((c) => c.id === selected.id) ?? null) : null

  return (
    <Card className="overflow-hidden" aria-label="Open complaints">
      <CardHeader
        title={
          <>
            Open complaints{' '}
            {!query.isLoading && <span className="ml-1 text-muted tabular-nums">({open.length})</span>}
          </>
        }
        description={urgent > 0 ? `${urgent} urgent` : undefined}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to={`${base}/complaints`}>View all</Link>
          </Button>
        }
      />
      {query.isLoading ? (
        <LoadingRows label="Loading complaints…" rows={2} />
      ) : (
        <CardList>
          {open.slice(0, limit).map((c) => (
            <ComplaintRow key={c.id} c={c} onOpen={setSelected} showProperty={showProperty} />
          ))}
        </CardList>
      )}
      <ComplaintSheet complaint={current} onClose={() => setSelected(null)} />
    </Card>
  )
}
