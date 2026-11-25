import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Money } from '@/components/Money'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardList } from '@/components/ui/card'
import { Avatar, ListRow, LoadingRows, ROW_LINK } from '@/components/ui/misc'
import { usePendingCheckins } from '@/features/checkins/useCheckins'
import { ageLabel } from '@/features/complaints/api'
import { useDuesQuery, type DueRow } from '@/features/dues/api'
import { LogPaymentSheet } from '@/features/payments/LogPaymentSheet'
import { QuietEmptySection } from './parts'

function overdueText(d: DueRow): { text: string; danger: boolean } {
  if (d.days_overdue > 0) return { text: `${d.days_overdue} ${d.days_overdue === 1 ? 'day' : 'days'} overdue`, danger: true }
  return { text: 'Due now', danger: false }
}

/** Who owes rent in the caretaker's buildings, most overdue first, with a one-tap Log payment. */
export function RentToCollectCard({ propertyId, limit = 5 }: { propertyId: string | null; limit?: number }) {
  const query = useDuesQuery(propertyId)
  const [logFor, setLogFor] = useState<DueRow | null>(null)
  const rows = [...(Array.isArray(query.data) ? query.data : [])].sort((a, b) => b.days_overdue - a.days_overdue || b.outstanding_paise - a.outstanding_paise)
  const total = rows.reduce((sum, r) => sum + r.outstanding_paise, 0)
  const overdue = rows.filter((r) => r.days_overdue > 0).length

  if (query.isError) return null
  if (!query.isLoading && rows.length === 0) {
    return <QuietEmptySection title="Rent to collect" message="Everyone has paid." />
  }

  return (
    <Card className="overflow-hidden" aria-label="Rent to collect">
      <CardHeader
        title={
          <>
            Rent to collect{' '}
            {!query.isLoading && (
              <span className="ml-1 font-semibold text-ink tabular-nums">
                · <Money paise={total} />
              </span>
            )}
          </>
        }
        description={query.isLoading ? 'Loading…' : `${rows.length} residents · ${overdue} overdue · most overdue first`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/caretaker/payments">View all</Link>
          </Button>
        }
      />
      {query.isLoading ? (
        <LoadingRows label="Loading dues…" rows={3} />
      ) : (
        <CardList>
          {rows.slice(0, limit).map((d) => {
            const o = overdueText(d)
            return (
              <li key={d.resident_id} className="flex items-center gap-2 pr-3 sm:pr-4">
                <Link to={`/caretaker/residents/${d.resident_id}/ledger`} className={`${ROW_LINK} min-w-0 flex-1`}>
                  <ListRow
                    leading={<Avatar name={d.full_name} />}
                    title={d.full_name}
                    meta={
                      <>
                        {d.bed_label ?? 'Moved out'} ·{' '}
                        <span className={o.danger ? 'font-medium text-danger-ink' : undefined}>{o.text}</span>
                      </>
                    }
                    trailing={<Money paise={d.outstanding_paise} className="text-[14.5px] font-semibold text-ink" />}
                  />
                </Link>
                <Button
                  type="button"
                  size="sm"
                  aria-label={`Log payment for ${d.full_name}`}
                  onClick={() => setLogFor(d)}
                  className="shrink-0"
                >
                  Collect
                </Button>
              </li>
            )
          })}
        </CardList>
      )}
      {logFor && (
        <LogPaymentSheet
          residentId={logFor.resident_id}
          residentName={logFor.full_name}
          outstandingPaise={logFor.outstanding_paise}
          onClose={() => setLogFor(null)}
        />
      )}
    </Card>
  )
}

/** Residents who scanned the reception QR and are waiting at the desk. */
export function PendingCheckinsCard({ limit = 4 }: { limit?: number }) {
  const query = usePendingCheckins()
  const rows = [...(Array.isArray(query.data) ? query.data : [])].sort((a, b) => a.created_at.localeCompare(b.created_at))

  if (query.isError) return null
  if (!query.isLoading && rows.length === 0) {
    return <QuietEmptySection title="Check-ins" message="Nobody is waiting to check in." />
  }

  return (
    <Card className="overflow-hidden" aria-label="Pending check-ins">
      <CardHeader
        title={
          <>
            Waiting to check in{' '}
            {!query.isLoading && <span className="ml-1 text-muted tabular-nums">({rows.length})</span>}
          </>
        }
        description="Longest waiting first"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/caretaker/check-ins">View all</Link>
          </Button>
        }
      />
      {query.isLoading ? (
        <LoadingRows label="Loading check-ins…" rows={2} />
      ) : (
        <CardList>
          {rows.slice(0, limit).map((r) => (
            <li key={r.id}>
              <Link to={`/caretaker/check-ins/${r.id}`} className={ROW_LINK}>
                <ListRow
                  leading={<Avatar name={r.full_name} />}
                  title={r.full_name}
                  meta={
                    <>
                      {r.employer_or_college ?? (r.occupation === 'student' ? 'Student' : 'Working')}
                      {r.is_foreign_national && ' · Foreign national'} · {ageLabel(r.created_at)}
                    </>
                  }
                  trailing={<span className="text-[13px] font-semibold text-brand-ink">Review</span>}
                />
              </Link>
            </li>
          ))}
        </CardList>
      )}
    </Card>
  )
}
