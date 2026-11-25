import { useState } from 'react'
import { Chip, Badge, type Tone } from '@/components/ui/badge'
import { Card, CardList } from '@/components/ui/card'
import { EmptyState, LoadingRows, Notice } from '@/components/ui/misc'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { Utr } from '@/components/Utr'
import { cn } from '@/lib/utils'
import { errorMessage, useImportRows, type CsvImportRow, type RowMatch } from './api'
import { PaymentSheet } from './PaymentSheet'

const MATCH_SPECS: Record<RowMatch, { label: string; filter: string; tone: Tone }> = {
  matched: { label: 'Matched', filter: 'Matched', tone: 'success' },
  amount_mismatch: { label: 'Amount mismatch', filter: 'Mismatch', tone: 'danger' },
  unmatched: { label: 'Not logged', filter: 'Not logged', tone: 'neutral' },
  already_verified: { label: 'Already verified', filter: 'Already verified', tone: 'info' },
}

const MATCH_ORDER: RowMatch[] = ['matched', 'amount_mismatch', 'unmatched', 'already_verified']

/** Mobile: payer + amount, then date + UTR, then result. From sm: one table row, six columns. */
const GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[96px_168px_minmax(0,1fr)_104px_156px_minmax(0,1fr)] sm:gap-x-4'

function RowBody({ row }: { row: CsvImportRow }) {
  const spec = MATCH_SPECS[row.match]
  const mismatch = row.match === 'amount_mismatch'
  return (
    <>
      <span className="order-1 min-w-0 truncate text-[14.5px] font-medium text-ink sm:order-3">
        {row.payer_name ?? 'Unknown payer'}
      </span>
      <span className="order-2 text-right text-[14.5px] font-semibold text-ink sm:order-4">
        {row.amount_paise === null ? '—' : <Money paise={row.amount_paise} />}
      </span>
      <span className="order-3 col-span-2 flex min-w-0 items-center gap-3 text-[12.5px] text-muted sm:contents">
        <span className="sm:order-1 sm:text-[13px]">
          {row.txn_at ? <DateText value={row.txn_at} /> : '—'}
        </span>
        <span className="min-w-0 truncate sm:order-2 sm:text-[13px]">
          {row.utr_number ? <Utr value={row.utr_number} /> : '—'}
        </span>
      </span>
      <span className="order-4 col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:contents">
        <span className="sm:order-5">
          <Badge tone={spec.tone} dot data-testid="match-badge" data-match={row.match}>
            {spec.label}
          </Badge>
        </span>
        <span className="min-w-0 truncate text-[12.5px] text-muted sm:order-6 sm:text-[13px]">
          {row.resident_name ?? ''}
          {mismatch && row.payment_amount_paise !== null && (
            <>
              {row.resident_name ? ' · ' : ''}
              <span className="font-medium text-danger-ink">
                Logged <Money paise={row.payment_amount_paise} />
              </span>
            </>
          )}
        </span>
      </span>
    </>
  )
}

export function RowsPanel({ importId }: { importId: string }) {
  const query = useImportRows(importId)
  const [filter, setFilter] = useState<RowMatch | 'all'>('all')
  const [openPaymentId, setOpenPaymentId] = useState<string | null>(null)

  const rows = query.data ?? []
  const counts = rows.reduce<Record<RowMatch, number>>(
    (acc, r) => ({ ...acc, [r.match]: acc[r.match] + 1 }),
    { matched: 0, amount_mismatch: 0, unmatched: 0, already_verified: 0 },
  )
  const shown = filter === 'all' ? rows : rows.filter((r) => r.match === filter)

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Filter by result" className="flex flex-wrap gap-2">
        <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All <span className="tabular-nums text-muted">{rows.length}</span>
        </Chip>
        {MATCH_ORDER.map((m) => (
          <Chip key={m} pressed={filter === m} onClick={() => setFilter(m)}>
            {MATCH_SPECS[m].filter} <span className="tabular-nums text-muted">{counts[m]}</span>
          </Chip>
        ))}
      </div>

      {query.isLoading && (
        <Card>
          <LoadingRows label="Loading statement rows…" />
        </Card>
      )}
      {query.isError && <Notice role="alert">{errorMessage(query.error, 'Unable to load the statement rows.')}</Notice>}

      {query.data && (
        <Card className="overflow-hidden">
          {shown.length === 0 ? (
            <EmptyState>{rows.length === 0 ? 'This statement has no credit rows.' : 'No rows with this result.'}</EmptyState>
          ) : (
            <>
              <div
                aria-hidden="true"
                className={cn(
                  GRID,
                  'hidden border-b border-line bg-surface-2 px-5 py-2 text-[12px] font-semibold text-muted sm:grid',
                )}
              >
                <span>Date</span>
                <span>UTR</span>
                <span>Payer</span>
                <span>Amount</span>
                <span>Result</span>
                <span>Resident</span>
              </div>
              <CardList aria-label="Statement rows">
                {shown.map((row) => {
                  const mismatch = row.match === 'amount_mismatch'
                  const rowCls = cn(
                    GRID,
                    'min-h-15 w-full px-4 py-3 text-left sm:px-5',
                    mismatch && 'bg-danger-soft',
                  )
                  return (
                    <li key={row.id} data-testid="statement-row" data-match={row.match}>
                      {row.payment_id ? (
                        <button
                          type="button"
                          aria-label={`Open payment: ${row.payer_name ?? 'Unknown payer'}`}
                          onClick={() => setOpenPaymentId(row.payment_id)}
                          className={cn(rowCls, 'transition-colors', mismatch ? 'hover:bg-danger-soft' : 'hover:bg-surface-2', 'active:bg-surface-2')}
                        >
                          <RowBody row={row} />
                        </button>
                      ) : (
                        <div className={rowCls}>
                          <RowBody row={row} />
                        </div>
                      )}
                    </li>
                  )
                })}
              </CardList>
            </>
          )}
        </Card>
      )}

      <PaymentSheet paymentId={openPaymentId} onClose={() => setOpenPaymentId(null)} />
    </div>
  )
}
