import { useEffect, useState } from 'react'
import { ChevronRight, HandCoins } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Money } from '@/components/Money'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardList } from '@/components/ui/card'
import { Avatar, EmptyState, ListRow, LoadingRows, Notice, PageHeader, ROW_LINK, StatTile } from '@/components/ui/misc'
import { CashLedgerList } from './CashLedgerList'
import { HandoverSheet } from './HandoverSheet'
import { errorMessage, useCashBalances, useCashLedger } from './useCash'

/** Owner: every caretaker's cash in hand, highest first. */
export function OwnerCashPage() {
  const { showToast } = useToast()
  const query = useCashBalances()
  useEffect(() => {
    if (query.error) showToast(errorMessage(query.error, 'Could not load cash'), 'error')
  }, [query.error, showToast])

  const rows = [...(query.data ?? [])].sort((a, b) => b.in_hand_paise - a.in_hand_paise)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={{ to: '/owner/money', label: 'Money' }}
        title="Cash in hand"
        description="Cash each caretaker is holding."
      />
      {query.isLoading && (
        <Card>
          <LoadingRows label="Loading cash…" />
        </Card>
      )}
      {query.isError && <Notice role="alert">{errorMessage(query.error, 'Unable to load cash.')}</Notice>}
      {query.data && rows.length === 0 && (
        <Card>
          <EmptyState>No caretakers yet.</EmptyState>
        </Card>
      )}
      {rows.length > 0 && (
        <Card className="overflow-hidden" aria-label="Caretakers">
          <CardList>
            {rows.map((r) => (
              <li key={r.user_id} data-testid="caretaker-cash-row">
                <Link to={`/owner/money/cash/${r.user_id}`} className={ROW_LINK}>
                  <ListRow
                    leading={<Avatar name={r.full_name} />}
                    title={r.full_name}
                    meta="In hand"
                    trailing={
                      <>
                        <span className="text-[15px] font-semibold tabular-nums text-ink">
                          <Money paise={r.in_hand_paise} />
                        </span>
                        <ChevronRight className="size-4 text-subtle" aria-hidden="true" />
                      </>
                    }
                  />
                </Link>
              </li>
            ))}
          </CardList>
        </Card>
      )}
    </div>
  )
}

/** Owner: one caretaker's ledger plus the Record handover action. */
export function OwnerCaretakerCashPage() {
  const { userId = '' } = useParams()
  const { showToast } = useToast()
  const balances = useCashBalances()
  const ledger = useCashLedger(userId)
  const [recording, setRecording] = useState(false)

  const balance = balances.data?.find((b) => b.user_id === userId)
  const name = ledger.data?.full_name ?? balance?.full_name ?? 'Caretaker'
  const inHand = ledger.data?.in_hand_paise ?? balance?.in_hand_paise

  const error = balances.error ?? ledger.error
  useEffect(() => {
    if (error) showToast(errorMessage(error, 'Could not load cash'), 'error')
  }, [error, showToast])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={{ to: '/owner/money/cash', label: 'Cash in hand' }}
        title={name}
        actions={
          inHand !== undefined && (
            <Button type="button" onClick={() => setRecording(true)}>
              <HandCoins aria-hidden="true" />
              Record handover
            </Button>
          )
        }
      />

      {ledger.isLoading && (
        <Card>
          <LoadingRows label="Loading ledger…" />
        </Card>
      )}
      {ledger.isError && <Notice role="alert">{errorMessage(ledger.error, 'Unable to load the ledger.')}</Notice>}

      {inHand !== undefined && <StatTile highlight label="Cash in hand" value={<Money paise={inHand} />} />}
      {balance && (
        <section aria-label="Breakdown" className="grid grid-cols-3 gap-2.5">
          <StatTile label="Collected" value={<Money paise={balance.collected_paise} />} />
          <StatTile label="Spent" value={<Money paise={balance.spent_paise} />} />
          <StatTile label="Handed over" value={<Money paise={balance.handed_over_paise} />} />
        </section>
      )}
      {ledger.data && <CashLedgerList entries={ledger.data.entries} />}

      {recording && inHand !== undefined && (
        <HandoverSheet
          caretakerUserId={userId}
          caretakerName={name}
          inHandPaise={inHand}
          onClose={() => setRecording(false)}
        />
      )}
    </div>
  )
}
