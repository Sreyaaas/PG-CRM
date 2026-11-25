import { useEffect } from 'react'
import { Money } from '@/components/Money'
import { useToast } from '@/components/Toast'
import { Card } from '@/components/ui/card'
import { LoadingRows, Notice, PageHeader, StatTile } from '@/components/ui/misc'
import { CashLedgerList } from './CashLedgerList'
import { errorMessage, useCashBalances, useCashLedger } from './useCash'

/** Caretaker: their own cash in hand, exactly as the API reports it. No handover action here. */
export function MyCashPage() {
  const { showToast } = useToast()
  const balances = useCashBalances()
  const ledger = useCashLedger()
  const mine = balances.data?.[0]

  const error = balances.error ?? ledger.error
  useEffect(() => {
    if (error) showToast(errorMessage(error, 'Could not load your cash'), 'error')
  }, [error, showToast])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader back={{ to: '/caretaker/more', label: 'More' }} title="My cash" />

      {balances.isLoading && (
        <Card>
          <LoadingRows label="Loading your cash…" />
        </Card>
      )}
      {balances.isError && <Notice role="alert">{errorMessage(balances.error, 'Unable to load your cash.')}</Notice>}

      {mine && (
        <>
          <StatTile
            highlight
            label="Cash with you"
            value={<Money paise={mine.in_hand_paise} />}
            foot="Collected − spent − handed over"
          />
          <section aria-label="Breakdown" className="grid grid-cols-3 gap-2.5">
            <StatTile label="Collected" value={<Money paise={mine.collected_paise} />} />
            <StatTile label="Spent" value={<Money paise={mine.spent_paise} />} />
            <StatTile label="Handed over" value={<Money paise={mine.handed_over_paise} />} />
          </section>
        </>
      )}

      {ledger.isLoading && (
        <Card>
          <LoadingRows label="Loading ledger…" />
        </Card>
      )}
      {ledger.data && <CashLedgerList entries={ledger.data.entries} />}
    </div>
  )
}
