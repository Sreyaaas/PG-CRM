import { useState } from 'react'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { Utr } from '@/components/Utr'
import { Button } from '@/components/ui/button'
import { Card, CardList } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/input'
import { EmptyState, LoadingRows, Notice } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { errorMessage, usePaymentDecision, useUnverifiedPayments, UNVERIFIED_OLDER_THAN_DAYS, type Payment } from './api'

const METHOD_LABELS = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer' } as const

type Pending = { payment: Payment; action: 'flag' | 'verify' }

function DecisionSheet({ pending, onClose }: { pending: Pending | null; onClose: () => void }) {
  const { showToast } = useToast()
  const decide = usePaymentDecision()
  const [reason, setReason] = useState('')

  if (!pending) return null
  const { payment, action } = pending
  const reasonTooShort = action === 'flag' && reason.trim().length < 3

  const submit = () => {
    const done = (message: string) => {
      showToast(message, 'success')
      onClose()
    }
    const fail = (err: unknown) => showToast(errorMessage(err, 'Unable to save. Please try again.'), 'error')
    if (action === 'flag') {
      decide.mutate(
        { paymentId: payment.id, action: 'flag', reason: reason.trim() },
        { onSuccess: () => done('Payment flagged'), onError: fail },
      )
    } else {
      decide.mutate({ paymentId: payment.id, action: 'verify' }, { onSuccess: () => done('Payment verified'), onError: fail })
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={action === 'flag' ? 'Flag payment' : 'Verify manually'}
      description={
        <>
          {payment.resident_name} · <Money paise={payment.amount_paise} />
        </>
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={action === 'flag' ? 'danger' : 'primary'}
            disabled={decide.isPending || reasonTooShort}
            onClick={submit}
          >
            {action === 'flag' ? 'Confirm flag' : 'Confirm verify'}
          </Button>
        </>
      }
    >
      {action === 'flag' ? (
        <Field id="flag-reason" label="Reason" hint="At least 3 characters. Shown on the payment.">
          <Textarea
            id="flag-reason"
            data-autofocus
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      ) : (
        <p className="text-[14px] text-muted">
          No bank statement row shows this payment. Verify it only if you have checked the money arrived another way.
        </p>
      )}
    </Sheet>
  )
}

export function UnverifiedPanel() {
  const query = useUnverifiedPayments(true)
  const [pending, setPending] = useState<Pending | null>(null)
  const payments = query.data ?? []

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13.5px] text-muted">
        Provisional payments logged {UNVERIFIED_OLDER_THAN_DAYS}+ days ago that never showed up in an uploaded statement.
        Check these first.
      </p>

      {query.isLoading && (
        <Card>
          <LoadingRows label="Loading payments…" />
        </Card>
      )}
      {query.isError && <Notice role="alert">{errorMessage(query.error, 'Unable to load these payments.')}</Notice>}

      {query.data && (
        <Card className="overflow-hidden">
          {payments.length === 0 ? (
            <EmptyState>Every older payment appears in a statement.</EmptyState>
          ) : (
            <CardList aria-label="Payments not in any statement">
              {payments.map((p) => (
                <li
                  key={p.id}
                  data-testid="unverified-payment"
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[14.5px] font-medium text-ink">{p.resident_name}</span>
                      <span className="shrink-0 text-[14.5px] font-semibold text-ink">
                        <Money paise={p.amount_paise} />
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                      <DateText value={p.received_at} />
                      <span>{METHOD_LABELS[p.method]}</span>
                      {p.utr_number && <Utr value={p.utr_number} />}
                      <StatusBadge kind="payment" value={p.status} />
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
                    <Button type="button" variant="danger" onClick={() => setPending({ payment: p, action: 'flag' })}>
                      Flag
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setPending({ payment: p, action: 'verify' })}>
                      Verify manually
                    </Button>
                  </div>
                </li>
              ))}
            </CardList>
          )}
        </Card>
      )}

      <DecisionSheet key={pending ? `${pending.payment.id}-${pending.action}` : 'none'} pending={pending} onClose={() => setPending(null)} />
    </div>
  )
}
