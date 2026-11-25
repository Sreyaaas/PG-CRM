import { Badge, type Tone } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type BedBadgeValue = 'vacant' | 'reserved' | 'occupied' | 'on_notice'
export type PaymentBadgeValue = 'recorded' | 'provisional' | 'verified' | 'flagged' | 'void'
export type ExpenseBadgeValue = 'flagged & not reviewed' | 'flagged_unreviewed'

export type StatusBadgeProps =
  | { kind: 'bed'; value: BedBadgeValue; className?: string }
  | { kind: 'payment'; value: PaymentBadgeValue; className?: string }
  | { kind: 'expense'; value: ExpenseBadgeValue; className?: string }

interface BadgeSpec {
  label: string
  tone: Tone
  extra?: string
}

const BED_SPECS: Record<BedBadgeValue, BadgeSpec> = {
  vacant: { label: 'Vacant', tone: 'neutral' },
  reserved: { label: 'Reserved', tone: 'info' },
  occupied: { label: 'Occupied', tone: 'success' },
  on_notice: { label: 'On notice', tone: 'warning' },
}

const PAYMENT_SPECS: Record<PaymentBadgeValue, BadgeSpec> = {
  recorded: { label: 'Cash', tone: 'neutral' },
  provisional: { label: 'Provisional', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  flagged: { label: 'Flagged', tone: 'danger' },
  void: { label: 'Void', tone: 'neutral', extra: 'line-through' },
}

const EXPENSE_SPECS: Record<ExpenseBadgeValue, BadgeSpec> = {
  'flagged & not reviewed': { label: 'No bill: review', tone: 'warning' },
  flagged_unreviewed: { label: 'No bill: review', tone: 'warning' },
}

function getSpec(props: StatusBadgeProps): BadgeSpec {
  switch (props.kind) {
    case 'bed':
      return BED_SPECS[props.value]
    case 'payment':
      return PAYMENT_SPECS[props.value]
    case 'expense':
      return EXPENSE_SPECS[props.value]
  }
}

export function StatusBadge(props: StatusBadgeProps) {
  const spec = getSpec(props)
  return (
    <Badge tone={spec.tone} dot className={cn(spec.extra, props.className)}>
      {spec.label}
    </Badge>
  )
}
