import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Money } from '@/components/Money'
import { Badge, Chip } from '@/components/ui/badge'
import { Card, CardHeader, CardList } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ListRow, ROW_LINK } from '@/components/ui/misc'
import { ATTENTION_LINKS, type DashboardAttention, type DashboardPnl, type PeriodKind } from './api'

export function PeriodSwitcher({
  kind,
  onKind,
  custom,
  onCustom,
  invalid,
}: {
  kind: PeriodKind
  onKind: (k: PeriodKind) => void
  custom: { from: string; to: string }
  onCustom: (v: { from: string; to: string }) => void
  invalid: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
        <Chip pressed={kind === 'this'} onClick={() => onKind('this')}>
          This month
        </Chip>
        <Chip pressed={kind === 'last'} onClick={() => onKind('last')}>
          Last month
        </Chip>
        <Chip pressed={kind === 'custom'} onClick={() => onKind('custom')}>
          Custom
        </Chip>
      </div>
      {kind === 'custom' && (
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field id="dash-from" label="From">
            <Input
              id="dash-from"
              type="date"
              value={custom.from}
              onChange={(e) => onCustom({ ...custom, from: e.target.value })}
            />
          </Field>
          <Field
            id="dash-to"
            label="To"
            error={invalid ? 'Choose an end date on or after the start date.' : undefined}
          >
            <Input
              id="dash-to"
              type="date"
              value={custom.to}
              onChange={(e) => onCustom({ ...custom, to: e.target.value })}
            />
          </Field>
        </div>
      )}
    </div>
  )
}


/** One row per property: collected, provisional, flagged, expenses, net. */
export function PnlCard({ rows }: { rows: DashboardPnl[] }) {
  return (
    <Card className="overflow-hidden" aria-label="Profit and loss">
      <CardHeader title="Profit and loss" />
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13.5px] text-muted sm:px-5">No payments or expenses in this period.</p>
      ) : (
        <CardList>
          {rows.map((r) => (
            <li key={r.property_id} data-testid="pnl-row" className="px-4 py-3 sm:px-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="truncate text-[14px] font-semibold text-ink">{r.property_name}</h3>
                <p className="shrink-0 text-[14px] font-semibold tabular-nums text-ink">
                  <span className="mr-1.5 text-[12px] font-normal text-muted">Net</span>
                  <Money paise={r.net_paise} />
                </p>
              </div>
              <PnlBreakdown row={r} />
            </li>
          ))}
        </CardList>
      )}
    </Card>
  )
}

interface AttentionItem {
  key: string
  label: string
  to: string
  count?: number
  paise?: number
  tone: 'warning' | 'danger'
}

/** Each row is a count that equals the list it links to. Zero rows are hidden. */
export function AttentionCard({ attention: a }: { attention: DashboardAttention }) {
  const items: AttentionItem[] = [
    { key: 'onboarding', label: 'Check-ins waiting', to: ATTENTION_LINKS.onboarding, count: a.pending_onboarding, tone: 'warning' },
    { key: 'discounts', label: 'Discount requests', to: ATTENTION_LINKS.discounts, count: a.pending_discounts, tone: 'warning' },
    { key: 'expenses', label: 'No-bill expenses to review', to: ATTENTION_LINKS.expenses, count: a.flagged_expenses_unreviewed, tone: 'warning' },
    {
      key: 'provisional',
      label: 'Payments not in a statement for 3+ days',
      to: ATTENTION_LINKS.provisional,
      count: a.provisional_payments_older_than_3_days,
      tone: 'warning',
    },
    { key: 'payments', label: 'Flagged payments', to: ATTENTION_LINKS.payments, count: a.flagged_payments, tone: 'danger' },
    { key: 'overstaying', label: 'Residents past their vacate date', to: ATTENTION_LINKS.overstaying, count: a.overstaying_residents, tone: 'danger' },
    { key: 'cash', label: 'Cash with caretakers', to: ATTENTION_LINKS.cash, paise: a.cash_in_hand_total_paise, tone: 'warning' },
  ]
  const shown = items.filter((i) => (i.count ?? i.paise ?? 0) > 0)
  return (
    <Card className="overflow-hidden" aria-label="Needs attention">
      <CardHeader title="Needs attention" />
      {shown.length === 0 ? (
        <p className="px-4 py-4 text-[13.5px] text-muted sm:px-5">Nothing needs attention.</p>
      ) : (
        <CardList>
          {shown.map((i) => (
            <li key={i.key}>
              <Link to={i.to} className={ROW_LINK} data-testid={`attention-${i.key}`}>
                <ListRow
                  title={i.label}
                  trailing={
                    <>
                      {i.paise !== undefined ? (
                        <span className="text-[14px] font-semibold tabular-nums text-ink">
                          <Money paise={i.paise} />
                        </span>
                      ) : (
                        <Badge tone={i.tone} className="tabular-nums">
                          {i.count}
                        </Badge>
                      )}
                      <ChevronRight className="size-4 text-subtle" aria-hidden="true" />
                    </>
                  }
                />
              </Link>
            </li>
          ))}
        </CardList>
      )}
    </Card>
  )
}

/** One quiet line under each building: only the figures that aren't zero. */
function PnlBreakdown({ row: r }: { row: DashboardPnl }) {
  const parts: { label: string; paise: number; tone?: string }[] = [
    { label: 'Verified', paise: r.collected_verified_paise },
    { label: 'Cash', paise: r.collected_cash_paise },
    { label: 'UPI to verify', paise: r.provisional_paise, tone: 'text-warning-ink' },
    { label: 'Flagged', paise: r.flagged_paise, tone: 'text-danger-ink' },
    { label: 'Expenses', paise: r.expenses_paise },
  ].filter((p) => p.paise !== 0)
  if (parts.length === 0) return <p className="mt-1 text-[12.5px] text-muted">Nothing collected or spent yet.</p>
  return (
    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
      {parts.map((p) => (
        <div key={p.label} className="flex gap-1">
          <dt>{p.label}</dt>
          <dd className={p.tone ?? 'text-ink'}>
            <Money paise={p.paise} className="font-medium tabular-nums" />
          </dd>
        </div>
      ))}
    </dl>
  )
}
