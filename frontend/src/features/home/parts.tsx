import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatDaysLeft } from '@/features/home/useBoards'
import { cn } from '@/lib/utils'

const IST_LONG_DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Asia/Kolkata',
})

export function DateLine({ now = new Date() }: { now?: Date }) {
  return (
    <time dateTime={now.toISOString()} className="tabular-nums">
      {IST_LONG_DAY.format(now)}
    </time>
  )
}

/** Occupied / total as a thin marigold bar with the numbers beside it. */
export function OccupancyBar({ occupied, total, className }: { occupied: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.round((occupied / total) * 100) : 0
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        role="meter"
        aria-label="Occupancy"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={occupied}
        aria-valuetext={`${occupied} of ${total} beds occupied`}
        className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3 sm:w-28"
      >
        <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 text-right text-[12.5px] text-muted tabular-nums">
        {occupied}/{total}
      </span>
    </div>
  )
}

/** Single quiet line for an empty home section (AC5). */
export function QuietEmptySection({ title, message }: { title: string; message: string }) {
  return (
    <Card className="px-4 py-3 sm:px-5">
      <p className="text-[13.5px] text-muted">
        <span className="font-medium text-ink">{title}</span> · {message}
      </p>
    </Card>
  )
}

export function DaysLeftBadge({ vacateDate, now }: { vacateDate: string; now?: Date }) {
  const { label, tone } = formatDaysLeft(vacateDate, now)
  return (
    <Badge tone={tone} className="tabular-nums">
      {label}
    </Badge>
  )
}
