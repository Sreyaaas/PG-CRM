import { useLocation, useParams } from 'react-router-dom'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Card, CardList } from '@/components/ui/card'
import { EmptyState, LoadingRows, Notice, PageHeader, StatTile } from '@/components/ui/misc'
import { getErrorMessage } from '@/features/residents/api'
import { cn } from '@/lib/utils'
import { useLedgerQuery, type LedgerEntry } from './api'

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const isPayment = entry.type === 'payment'
  const struck = entry.voided ? 'line-through text-muted' : ''
  return (
    <li
      data-testid="ledger-row"
      data-voided={entry.voided ? 'true' : 'false'}
      className="flex min-h-15 items-center gap-3 px-4 py-3 sm:px-5"
    >
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-[14.5px] font-medium text-ink', struck)}>{entry.description}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
          <DateText value={entry.entry_date} className={struck} />
          <span aria-hidden="true">·</span>
          <span className={cn('tabular-nums', struck)}>{entry.reference}</span>
          {entry.voided ? (
            <StatusBadge kind="payment" value="void" />
          ) : (
            <Badge tone="neutral">{isPayment ? 'Payment' : 'Invoice'}</Badge>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <Money
          paise={entry.amount_paise}
          className={cn(
            'text-[14.5px] font-semibold',
            entry.voided ? 'text-muted line-through' : isPayment ? 'text-success-ink' : 'text-ink',
          )}
        />
        <span className="text-[12.5px] text-muted" data-testid="ledger-balance">
          Balance <Money paise={entry.balance_paise} />
        </span>
      </div>
    </li>
  )
}

export function LedgerPage() {
  const { residentId } = useParams<{ residentId: string }>()
  const { pathname } = useLocation()
  const base = pathname.startsWith('/owner') ? '/owner' : '/caretaker'
  const query = useLedgerQuery(residentId)
  const ledger = query.data

  return (
    <div className="flex max-w-2xl flex-col gap-5 pb-8">
      <PageHeader
        back={{ to: `${base}/residents/${residentId}`, label: 'Resident' }}
        title={ledger ? ledger.full_name : 'Ledger'}
        description="Invoices and payments, oldest first."
      />

      {query.isError && <Notice role="alert">{getErrorMessage(query.error, 'Unable to load the ledger.')}</Notice>}

      {ledger && (
        <StatTile
          label="Outstanding"
          value={<Money paise={ledger.outstanding_paise} />}
          highlight={ledger.outstanding_paise > 0}
        />
      )}

      <Card className="overflow-hidden" aria-label="Ledger">
        {query.isLoading && <LoadingRows label="Loading ledger…" rows={4} />}
        {ledger && ledger.entries.length === 0 && <EmptyState>No invoices or payments yet.</EmptyState>}
        {ledger && ledger.entries.length > 0 && (
          <CardList>
            {ledger.entries.map((e) => (
              <LedgerRow key={`${e.type}-${e.id}`} entry={e} />
            ))}
          </CardList>
        )}
      </Card>
    </div>
  )
}
