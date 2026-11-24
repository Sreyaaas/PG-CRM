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
  classes: string
}

const BED_SPECS: Record<BedBadgeValue, BadgeSpec> = {
  vacant: {
    label: 'Vacant',
    classes: 'bg-slate-100 text-slate-800 border-slate-300',
  },
  reserved: {
    label: 'Reserved',
    classes: 'bg-blue-50 text-blue-800 border-blue-200',
  },
  occupied: {
    label: 'Occupied',
    classes: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  on_notice: {
    label: 'On notice',
    classes: 'bg-amber-50 text-amber-900 border-amber-300',
  },
}

const PAYMENT_SPECS: Record<PaymentBadgeValue, BadgeSpec> = {
  recorded: {
    label: 'Cash',
    classes: 'bg-slate-100 text-slate-800 border-slate-300',
  },
  provisional: {
    label: 'Provisional',
    classes: 'bg-amber-50 text-amber-900 border-amber-300',
  },
  verified: {
    label: 'Verified',
    classes: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  flagged: {
    label: 'Flagged',
    classes: 'bg-red-50 text-red-800 border-red-200',
  },
  void: {
    label: 'Void',
    classes: 'bg-slate-100 text-slate-700 border-slate-300 line-through',
  },
}

const EXPENSE_SPECS: Record<ExpenseBadgeValue, BadgeSpec> = {
  'flagged & not reviewed': {
    label: 'No bill: review',
    classes: 'bg-yellow-50 text-yellow-900 border-yellow-300',
  },
  flagged_unreviewed: {
    label: 'No bill: review',
    classes: 'bg-yellow-50 text-yellow-900 border-yellow-300',
  },
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
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium tracking-tight',
        spec.classes,
        props.className,
      )}
    >
      {spec.label}
    </span>
  )
}
