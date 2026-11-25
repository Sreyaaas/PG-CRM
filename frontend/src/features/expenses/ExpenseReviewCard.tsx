import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { ApiError } from '@/api/client'
import { DateText } from '@/components/DateText'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { useProofUrl, useReviewExpense, useVoidExpense, type Expense } from './api'
import { CATEGORY_LABELS, mapsUrl } from './expenseForm'

const TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
})

function ProofPhoto({ proofPath }: { proofPath: string }) {
  const query = useProofUrl(proofPath)
  if (query.isLoading) return <Skeleton className="aspect-[4/3] w-full" />
  if (!query.data) return <p className="text-[12.5px] text-muted">Photo is not available right now.</p>
  return (
    <a href={query.data} target="_blank" rel="noreferrer" aria-label="Open proof photo">
      <img
        src={query.data}
        alt="Expense proof"
        loading="lazy"
        className="aspect-[4/3] w-full rounded-control border border-line object-cover"
      />
    </a>
  )
}

/** Owner view of a no-bill expense waiting for review: proof, place, amount, note, who and when. */
export function ExpenseReviewCard({ expense: e, who }: { expense: Expense; who?: string }) {
  const { showToast } = useToast()
  const review = useReviewExpense()
  const voidExpense = useVoidExpense()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const busy = review.isPending || voidExpense.isPending
  const fail = (err: unknown) => showToast(err instanceof ApiError ? err.message : 'Something went wrong', 'error')

  const reasonOk = reason.trim().length >= 3

  return (
    <li
      data-testid="expense-card"
      data-flagged="true"
      className="rounded-card border border-[color-mix(in_oklab,var(--warning)_35%,var(--line))] bg-warning-soft p-4 shadow-xs sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-semibold text-ink">{CATEGORY_LABELS[e.category]}</div>
          <div className="truncate text-[12.5px] text-muted">
            {who ?? 'Staff'} · <DateText value={e.created_at} />{' '}
            <span className="tabular-nums">{TIME_FORMATTER.format(new Date(e.created_at))}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Money paise={e.amount_paise} className="text-[15px] font-semibold text-ink" />
          <StatusBadge kind="expense" value="flagged_unreviewed" />
        </div>
      </div>

      {e.notes && <p className="mt-3 text-[14px] text-ink">{e.notes}</p>}
      {e.vendor_name && <p className="mt-1 text-[12.5px] text-muted">{e.vendor_name}</p>}

      <div className="mt-3">
        <ProofPhoto proofPath={e.proof_path} />
      </div>

      {e.proof_lat !== null && e.proof_lng !== null && (
        <a
          href={mapsUrl(e.proof_lat, e.proof_lng)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-[13.5px] font-medium text-brand-ink underline-offset-2 hover:underline [&_svg]:size-4"
        >
          <MapPin aria-hidden="true" />
          View location on map
        </a>
      )}
      {e.proof_captured_at && (
        <p className="text-[12.5px] text-muted">
          Photo taken <DateText value={e.proof_captured_at} />{' '}
          <span className="tabular-nums">{TIME_FORMATTER.format(new Date(e.proof_captured_at))}</span>
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button type="button" variant="danger" disabled={busy} onClick={() => setVoiding(true)}>
          Void
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={() => review.mutate({ id: e.id }, { onSuccess: () => showToast('Marked as reviewed', 'success'), onError: fail })}
        >
          Mark reviewed
        </Button>
      </div>

      <Sheet
        open={voiding}
        onClose={() => setVoiding(false)}
        title="Void this expense"
        description="A void is final. Cash expenses no longer reduce the caretaker's cash in hand."
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={() => setVoiding(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={!reasonOk || voidExpense.isPending}
              onClick={() =>
                voidExpense.mutate(
                  { id: e.id, reason },
                  {
                    onSuccess: () => {
                      setVoiding(false)
                      showToast('Expense voided', 'success')
                    },
                    onError: fail,
                  },
                )
              }
            >
              Confirm void
            </Button>
          </div>
        }
      >
        <Field id={`void-reason-${e.id}`} label="Reason" hint="At least 3 characters">
          <Textarea id={`void-reason-${e.id}`} rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
      </Sheet>
    </li>
  )
}
