import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { Utr } from '@/components/Utr'
import { Button } from '@/components/ui/button'
import { LoadingRows, Notice } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { errorMessage, usePayment } from './api'

const METHOD_LABELS = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer' } as const

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <dt className="text-[13.5px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[14px] font-medium text-ink">{children}</dd>
    </div>
  )
}

/** The payment behind a statement row, opened when the owner taps the row. */
export function PaymentSheet({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const query = usePayment(paymentId)
  const payment = query.data
  return (
    <Sheet
      open={paymentId !== null}
      onClose={onClose}
      title="Payment"
      description={payment?.resident_name}
      footer={
        payment ? (
          <Button asChild variant="secondary">
            <Link to={`/owner/residents/${payment.resident_id}`}>Open resident</Link>
          </Button>
        ) : undefined
      }
    >
      {query.isLoading && <LoadingRows label="Loading payment…" rows={4} />}
      {query.isError && <Notice role="alert">{errorMessage(query.error, 'Unable to load this payment.')}</Notice>}
      {payment && (
        <dl>
          <Detail label="Amount">
            <Money paise={payment.amount_paise} />
          </Detail>
          <Detail label="Status">
            <StatusBadge kind="payment" value={payment.voided_at ? 'void' : payment.status} />
          </Detail>
          <Detail label="Method">{METHOD_LABELS[payment.method]}</Detail>
          {payment.utr_number && (
            <Detail label="UTR">
              <Utr value={payment.utr_number} />
            </Detail>
          )}
          <Detail label="Logged">
            <DateText value={payment.received_at} /> · {payment.received_by_name}
          </Detail>
          {payment.flag_reason && <Detail label="Flag reason">{payment.flag_reason}</Detail>}
        </dl>
      )}
    </Sheet>
  )
}
