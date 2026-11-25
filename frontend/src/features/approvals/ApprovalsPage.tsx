import { useRef, useState } from 'react'
import { useToast } from '@/components/Toast'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, LoadingRows, Notice, PageHeader } from '@/components/ui/misc'
import { ExpenseReviewCard } from '@/features/expenses/ExpenseReviewCard'
import { useExpensesQuery } from '@/features/expenses/api'
import { useStaffQuery } from '@/features/staff/useStaff'
import { SectionHeader } from '@/components/ui/misc'
import { DiscountRequestCard } from './DiscountRequestCard'
import { useDecideDiscount, usePendingDiscounts } from './useDiscountRequests'

const PULL_THRESHOLD_PX = 80

export function ApprovalsPage() {
  const { showToast } = useToast()
  const query = usePendingDiscounts()
  const decide = useDecideDiscount((msg) => showToast(msg, 'error'))
  const [pendingId, setPendingId] = useState<string | null>(null)
  const touchStartY = useRef<number | null>(null)

  // Card types plug in here: each contributes its own list; empty state shows when all are empty.
  const discounts = query.data ?? []
  const expensesQuery = useExpensesQuery({ flagged: true })
  const staffQuery = useStaffQuery()
  const flaggedExpenses = (expensesQuery.data ?? []).filter((e) => !e.voided_at)
  const staffName = (id: string) =>
    Array.isArray(staffQuery.data) ? staffQuery.data.find((m) => m.user_id === id)?.full_name : undefined
  const total = discounts.length + flaggedExpenses.length

  return (
    <div
      className="flex flex-col gap-5"
      onTouchStart={(e) => {
        touchStartY.current = window.scrollY <= 0 ? e.touches[0].clientY : null
      }}
      onTouchEnd={(e) => {
        const start = touchStartY.current
        touchStartY.current = null
        if (start !== null && e.changedTouches[0].clientY - start > PULL_THRESHOLD_PX) {
          void query.refetch()
        }
      }}
    >
      <PageHeader
        title="Approvals"
        description="Discount requests and no-bill expenses from your caretakers."
        actions={
          <Button type="button" variant="secondary" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw aria-hidden="true" className={query.isFetching ? 'animate-spin' : undefined} />
            {query.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      {query.isLoading && (
        <Card>
          <LoadingRows label="Loading…" />
        </Card>
      )}
      {query.isError && (
        <Notice role="alert">
          {query.error instanceof Error ? query.error.message : 'Unable to load approvals.'}
        </Notice>
      )}
      {query.data && total === 0 && (
        <Card>
          <EmptyState>Nothing to approve.</EmptyState>
        </Card>
      )}

      {discounts.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Discount requests">
          {discounts.map((r) => (
            <DiscountRequestCard
              key={r.id}
              request={r}
              busy={decide.isPending && pendingId === r.id}
              onDecide={(decision, note) => {
                setPendingId(r.id)
                decide.mutate({ id: r.id, decision, note })
              }}
            />
          ))}
        </ul>
      )}

      {flaggedExpenses.length > 0 && (
        <section aria-label="No-bill expenses" className="flex flex-col gap-3">
          <SectionHeader title="No-bill expenses to review" />
          <ul className="flex flex-col gap-3">
            {flaggedExpenses.map((e) => (
              <ExpenseReviewCard key={e.id} expense={e} who={staffName(e.created_by)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
