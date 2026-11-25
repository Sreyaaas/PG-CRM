import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge, Chip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardList } from '@/components/ui/card'
import { EmptyState, ListRow, LoadingRows, Notice, PageHeader } from '@/components/ui/misc'
import { useAuth } from '@/features/auth/AuthContext'
import { useStaffQuery } from '@/features/staff/useStaff'
import { cn } from '@/lib/utils'
import { useExpensesQuery, type Expense } from './api'
import { CATEGORY_LABELS } from './expenseForm'
import { ExpenseReviewCard } from './ExpenseReviewCard'

function ExpenseRow({ e }: { e: Expense }) {
  const voided = Boolean(e.voided_at)
  const flagged = e.flagged_for_review && !voided
  return (
    <li data-testid="expense-row" data-flagged={flagged ? 'true' : 'false'} className={cn(flagged && 'bg-warning-soft')}>
      <ListRow
        title={
          <>
            {CATEGORY_LABELS[e.category]}
            {e.quantity !== null && e.unit && (
              <span className="font-normal text-muted tabular-nums">
                {' '}
                · {e.quantity} {e.unit}
              </span>
            )}
          </>
        }
        meta={
          <>
            <DateText value={e.expense_date} />
            {(e.vendor_name || e.notes) && <> · {e.vendor_name ?? e.notes}</>}
          </>
        }
        trailing={
          <div className="flex flex-col items-end gap-1">
            <Money paise={e.amount_paise} className={cn('text-[14.5px] font-semibold text-ink', voided && 'line-through')} />
            {voided ? (
              <Badge dot className="line-through">
                Void
              </Badge>
            ) : flagged ? (
              <StatusBadge kind="expense" value="flagged_unreviewed" />
            ) : e.bill_mode === 'no_bill' ? (
              <Badge tone="success" dot>
                Reviewed
              </Badge>
            ) : null}
          </div>
        }
      />
    </li>
  )
}

export function ExpensesPage() {
  const { membership } = useAuth()
  const isOwner = membership?.role === 'owner'
  const base = isOwner ? '/owner/expenses' : '/caretaker/expenses'
  const [filter, setFilter] = useState<'all' | 'review'>('all')
  const query = useExpensesQuery({ flagged: filter === 'review' })
  const staffQuery = useStaffQuery()
  const rows = query.data ?? []
  const needsReview = (e: Expense) => isOwner && e.flagged_for_review && !e.voided_at
  const reviewRows = rows.filter(needsReview)
  const plainRows = rows.filter((e) => !needsReview(e))
  const who = (id: string) =>
    (isOwner && Array.isArray(staffQuery.data) ? staffQuery.data.find((m) => m.user_id === id)?.full_name : undefined) ??
    undefined

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Expenses"
        actions={
          <Button asChild size="sm">
            <Link to={`${base}/new`}>
              <Plus aria-hidden="true" />
              Log expense
            </Link>
          </Button>
        }
      />

      {isOwner && (
        <div role="group" aria-label="Filter expenses" className="flex gap-2">
          <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </Chip>
          <Chip pressed={filter === 'review'} onClick={() => setFilter('review')}>
            Needs review
          </Chip>
        </div>
      )}

      {query.isLoading && (
        <Card>
          <LoadingRows label="Loading expenses…" />
        </Card>
      )}
      {query.isError && (
        <Notice role="alert">{query.error instanceof Error ? query.error.message : 'Unable to load expenses.'}</Notice>
      )}
      {query.data && rows.length === 0 && (
        <Card>
          <EmptyState>{filter === 'review' ? 'Nothing needs review.' : 'No expenses logged yet.'}</EmptyState>
        </Card>
      )}

      {reviewRows.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Needs review">
          {reviewRows.map((e) => (
            <ExpenseReviewCard key={e.id} expense={e} who={who(e.created_by)} />
          ))}
        </ul>
      )}
      {plainRows.length > 0 && (
        <Card className="overflow-hidden">
          <CardList aria-label="Expenses">
            {plainRows.map((e) => (
              <ExpenseRow key={e.id} e={e} />
            ))}
          </CardList>
        </Card>
      )}
    </div>
  )
}
