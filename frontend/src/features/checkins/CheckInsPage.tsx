import { useRef } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Avatar, EmptyState, LoadingRows, Notice, PageHeader } from '@/components/ui/misc'
import { getErrorMessage, usePendingCheckins } from './useCheckins'

const PULL_THRESHOLD_PX = 80

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function CheckInsPage() {
  const { pathname } = useLocation()
  const basePath = pathname.startsWith('/owner') ? '/owner/check-ins' : '/caretaker/check-ins'
  const query = usePendingCheckins()
  const touchStartY = useRef<number | null>(null)
  const items = Array.isArray(query.data) ? query.data : []

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
        title="Check-ins"
        description="Pending resident submissions waiting at the desk."
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden="true" className={query.isFetching ? 'animate-spin' : undefined} />
            {query.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      {query.isLoading && (
        <Card>
          <LoadingRows label="Loading check-ins…" />
        </Card>
      )}

      {query.isError && (
        <Notice role="alert">{getErrorMessage(query.error, 'Unable to load check-ins.')}</Notice>
      )}

      {query.data && items.length === 0 && (
        <Card>
          <EmptyState>No pending check-ins.</EmptyState>
        </Card>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Pending check-ins">
          {items.map((item) => {
            const companyOrOcc =
              item.employer_or_college ||
              (item.occupation === 'working'
                ? 'Working'
                : item.occupation === 'student'
                  ? 'Student'
                  : 'Other')
            return (
              <li key={item.id} data-testid="checkin-card">
                <Link
                  to={`${basePath}/${item.id}`}
                  className="flex items-center gap-3.5 rounded-card border border-line bg-surface p-4 shadow-sm transition-colors hover:bg-surface-2 active:bg-surface-2 sm:p-5"
                >
                  <Avatar name={item.full_name} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[15px] font-semibold text-ink">{item.full_name}</span>
                      {item.is_foreign_national && <Badge tone="warning">Foreign national</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                      <span className="tabular-nums">{item.phone}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{companyOrOcc}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[12px] text-subtle tabular-nums">{formatTimeAgo(item.created_at)}</span>
                    <ChevronRight className="size-4 text-subtle" aria-hidden="true" />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
