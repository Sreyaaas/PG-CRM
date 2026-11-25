import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardList } from '@/components/ui/card'
import { EmptyState, ListRow } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import type { CashLedgerEntry } from './useCash'

const TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
})

const TYPE_LABEL: Record<CashLedgerEntry['type'], string> = {
  payment: 'Payment',
  expense: 'Expense',
  handover: 'Handover',
}

function LedgerRow({ entry: e }: { entry: CashLedgerEntry }) {
  const cashIn = e.amount_paise > 0
  return (
    <li data-testid="ledger-entry">
      <ListRow
        title={<span className={cn(e.voided && 'line-through')}>{e.description}</span>}
        meta={
          <>
            {TYPE_LABEL[e.type]}
            {e.property_name ? ` · ${e.property_name}` : ''} · <DateText value={e.entry_at} />{' '}
            <span className="tabular-nums">{TIME_FORMATTER.format(new Date(e.entry_at))}</span>
          </>
        }
        trailing={
          <div className="flex flex-col items-end gap-0.5">
            <span
              className={cn(
                'text-[14.5px] font-semibold tabular-nums',
                e.voided ? 'text-muted line-through' : cashIn ? 'text-success-ink' : 'text-ink',
              )}
            >
              {cashIn ? '+' : '−'}
              <Money paise={Math.abs(e.amount_paise)} />
            </span>
            {e.voided ? (
              <Badge tone="neutral">Void</Badge>
            ) : (
              <span className="text-[12px] text-muted">
                Balance <Money paise={e.balance_paise} />
              </span>
            )}
          </div>
        }
      />
      {e.notes && <p className="-mt-1 px-4 pb-3 text-[12.5px] text-muted sm:px-5">{e.notes}</p>}
    </li>
  )
}

/** The API returns entries oldest first; show the newest on top. */
export function CashLedgerList({ entries }: { entries: CashLedgerEntry[] }) {
  return (
    <Card className="overflow-hidden" aria-label="Cash ledger">
      <CardHeader title="Ledger" />
      {entries.length === 0 ? (
        <EmptyState>No cash movements yet.</EmptyState>
      ) : (
        <CardList>
          {[...entries].reverse().map((e) => (
            <LedgerRow key={`${e.type}-${e.id}`} entry={e} />
          ))}
        </CardList>
      )}
    </Card>
  )
}
