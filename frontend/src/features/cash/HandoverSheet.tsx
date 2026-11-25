import { useState } from 'react'
import { Money } from '@/components/Money'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { MoneyInput, Textarea } from '@/components/ui/input'
import { Notice } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { formatINR, parseRupeesToPaise } from '@/lib/money'
import { errorMessage, useRecordHandover } from './useCash'
import { isNetworkError } from '@/offline/retryQueue'
import { retryQueue } from '@/offline/transport'

function paiseToInput(paise: number): string {
  if (paise <= 0) return ''
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2)
}

function parsePositivePaise(value: string): number | null {
  try {
    const p = parseRupeesToPaise(value)
    return p > 0 ? p : null
  } catch {
    return null
  }
}

interface Props {
  caretakerUserId: string
  caretakerName: string
  inHandPaise: number
  onClose: () => void
}

/**
 * Two steps in one sheet: amount and notes, then a confirmation ("Confirm you received ₹X in cash from Ravi").
 * One Idempotency-Key per opened sheet: a retry after a timeout reuses it, so it cannot record twice.
 * Mount only while open so each open gets a fresh key and a fresh pre-filled amount.
 */
export function HandoverSheet({ caretakerUserId, caretakerName, inHandPaise, onClose }: Props) {
  const { showToast } = useToast()
  const record = useRecordHandover()
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [amount, setAmount] = useState(() => paiseToInput(inHandPaise))
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const paise = parsePositivePaise(amount)

  function review() {
    if (paise === null) {
      setFormError('Enter an amount greater than zero.')
      return
    }
    if (notes.trim().length > 500) {
      setFormError('Notes can be at most 500 characters.')
      return
    }
    setFormError(null)
    setConfirming(true)
  }

  async function submit() {
    if (paise === null) return
    try {
      const res = await record.mutateAsync({ caretakerUserId, amountPaise: paise, notes, idempotencyKey })
      if (res?.warning) showToast(res.warning)
      else showToast('Handover recorded', 'success')
      onClose()
    } catch (caught) {
      let err: unknown = caught
      if (isNetworkError(err)) {
        // No connection: keep the handover on this phone and send it with the same key once back online.
        try {
          const trimmed = notes.trim()
          const result = await retryQueue.submit({
            kind: 'handover',
            label: `Handover ${formatINR(paise)} from ${caretakerName}`,
            idempotencyKey,
            body: { caretaker_user_id: caretakerUserId, amount_paise: paise, notes: trimmed ? trimmed : null },
          })
          showToast(
            result.status === 'sent' ? 'Handover recorded' : 'No connection. Saved on this phone and will sync when online.',
            result.status === 'sent' ? 'success' : 'default',
          )
          onClose()
          return
        } catch (queueErr) {
          err = queueErr
        }
      }
      const message = errorMessage(err, 'Unable to record the handover. Please try again.')
      setFormError(message)
      showToast(message, 'error')
      setConfirming(false)
    }
  }

  if (confirming && paise !== null) {
    return (
      <Sheet
        open
        onClose={onClose}
        title="Confirm handover"
        footer={
          <>
            <Button type="button" variant="secondary" size="lg" disabled={record.isPending} onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button type="button" variant="brand" size="lg" disabled={record.isPending} onClick={() => void submit()}>
              {record.isPending ? 'Recording…' : 'Confirm'}
            </Button>
          </>
        }
      >
        <p className="py-2 text-[15px] text-ink">
          Confirm you received <Money paise={paise} className="font-semibold" /> in cash from {caretakerName}.
        </p>
      </Sheet>
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Record handover"
      description={caretakerName}
      footer={
        <Button type="button" variant="brand" size="lg" onClick={review}>
          Review
        </Button>
      }
    >
      <div className="flex flex-col gap-4 py-1">
        {formError && <Notice role="alert">{formError}</Notice>}
        <Field id="handover-amount" label="Amount received" hint={`Cash in hand: ${formatINR(inHandPaise)}`}>
          <MoneyInput
            id="handover-amount"
            data-autofocus
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field id="handover-notes" label="Notes (optional)">
          <Textarea
            id="handover-notes"
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}
