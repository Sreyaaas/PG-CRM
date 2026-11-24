import { useRef, useState } from 'react'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
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
  const total = discounts.length

  return (
    <div
      className="space-y-4"
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
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">Approvals</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {query.isError && (
        <p role="alert" className="text-sm text-red-700">
          {query.error instanceof Error ? query.error.message : 'Unable to load approvals.'}
        </p>
      )}
      {query.data && total === 0 && <p className="text-sm text-slate-500">Nothing to approve.</p>}

      {discounts.length > 0 && (
        <ul className="space-y-3" aria-label="Discount requests">
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
    </div>
  )
}
