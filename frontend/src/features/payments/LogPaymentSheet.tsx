import { useRef, useState } from 'react'
import { Check, Link2, MessageCircle } from 'lucide-react'
import { Money } from '@/components/Money'
import { StatusBadge } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { Utr, formatUtr } from '@/components/Utr'
import { Chip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, MoneyInput, Select, Textarea } from '@/components/ui/input'
import { Notice } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/sheet'
import { useLedgerQuery } from '@/features/dues/api'
import { getErrorMessage } from '@/features/residents/api'
import { parseRupeesToPaise } from '@/lib/money'
import { useLogPayment, type Payment, type PaymentMethod } from './api'

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer' },
]

const UTR_LENGTH = 12

/** Keep digits only (this also strips spaces), at most 12. */
function cleanUtr(value: string): string {
  return value.replace(/\D/g, '').slice(0, UTR_LENGTH)
}

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
  residentId: string
  residentName: string
  outstandingPaise: number
  onClose: () => void
}

/**
 * Log a payment at the desk. Mount only while open: each open gets a fresh Idempotency-Key and a fresh
 * pre-filled amount. A retry of the same request reuses the key, so a network failure cannot double-record.
 */
export function LogPaymentSheet({ residentId, residentName, outstandingPaise, onClose }: Props) {
  const { showToast } = useToast()
  const log = useLogPayment()
  const attempt = useRef({ key: crypto.randomUUID(), signature: null as string | null })
  const inFlight = useRef(false)
  const [amount, setAmount] = useState(() => paiseToInput(outstandingPaise))
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [utr, setUtr] = useState('')
  const [invoiceId, setInvoiceId] = useState('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<Payment | null>(null)

  const ledger = useLedgerQuery(residentId)
  const invoices = (ledger.data?.entries ?? []).filter((e) => e.type === 'invoice' && !e.voided)

  const paise = parsePositivePaise(amount)
  const needsUtr = method !== 'cash'
  const utrReady = !needsUtr || utr.length === UTR_LENGTH
  const canSubmit = paise !== null && utrReady && !log.isPending

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (paise === null || !utrReady || inFlight.current) return
    if (notes.trim().length > 500) {
      setFormError('Notes can be at most 500 characters.')
      return
    }
    setFormError(null)
    const vars = {
      residentId,
      amountPaise: paise,
      method,
      utr: needsUtr ? utr : null,
      invoiceId: invoiceId || null,
      notes,
    }
    // The same request again (a retry) keeps its key; an edited request is a new one and gets a new key.
    const signature = JSON.stringify(vars)
    if (attempt.current.signature !== null && attempt.current.signature !== signature) {
      attempt.current.key = crypto.randomUUID()
    }
    attempt.current.signature = signature
    inFlight.current = true
    try {
      setDone(await log.mutateAsync({ ...vars, idempotencyKey: attempt.current.key }))
    } catch (err) {
      const message = getErrorMessage(err, 'Unable to log the payment. Please try again.')
      setFormError(message)
      showToast(message, 'error')
    } finally {
      inFlight.current = false
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      showToast('Receipt link copied', 'success')
    } catch {
      showToast('Unable to copy the link.', 'error')
    }
  }

  if (done) {
    return (
      <Sheet
        open
        onClose={onClose}
        title="Payment logged"
        description={residentName}
        footer={
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-4 py-1">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-success-soft text-success-ink">
              <Check className="size-5" aria-hidden="true" />
            </span>
            <div className="flex flex-col items-start gap-1">
              <Money paise={done.amount_paise} className="text-[22px] font-semibold text-ink" />
              <StatusBadge kind="payment" value={done.status} />
            </div>
          </div>
          {done.utr_number && (
            <p className="text-[13.5px] text-muted">
              UTR <Utr value={done.utr_number} className="text-ink" />
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button asChild variant="brand" size="lg" block>
              <a href={done.whatsapp_url} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" />
                Share receipt on WhatsApp
              </a>
            </Button>
            <Button type="button" variant="secondary" size="lg" block onClick={() => void copyLink(done.receipt_url)}>
              <Link2 aria-hidden="true" />
              Copy receipt link
            </Button>
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Log payment"
      description={residentName}
      footer={
        <Button type="submit" form="log-payment-form" variant="brand" size="lg" disabled={!canSubmit}>
          {log.isPending ? 'Logging…' : 'Log payment'}
        </Button>
      }
    >
      <form id="log-payment-form" onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 py-1" noValidate>
        {formError && <Notice role="alert">{formError}</Notice>}

        <Field id="pay-amount" label="Amount">
          <MoneyInput
            id="pay-amount"
            data-autofocus
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span id="pay-method-label" className="text-[13.5px] font-medium text-ink">
            Method
          </span>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="pay-method-label">
            {METHODS.map((m) => (
              <Chip key={m.value} pressed={method === m.value} onClick={() => setMethod(m.value)}>
                {m.label}
              </Chip>
            ))}
          </div>
        </div>

        {needsUtr && (
          <Field
            id="pay-utr"
            label="UTR"
            hint={
              <>
                <span className="tabular-nums" data-testid="utr-counter">
                  {utr.length}/{UTR_LENGTH}
                </span>
                {" · From the payer's UPI app → transaction details → UPI Ref No / UTR"}
              </>
            }
          >
            <Input
              id="pay-utr"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
              className="font-mono tabular-nums"
              placeholder="1234 5678 9012"
              value={formatUtr(utr)}
              onChange={(e) => setUtr(cleanUtr(e.target.value))}
            />
          </Field>
        )}

        {invoices.length > 0 && (
          <Field id="pay-invoice" label="Invoice (optional)">
            <Select id="pay-invoice" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
              <option value="">Oldest unpaid</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.reference} · {i.description}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field id="pay-notes" label="Notes (optional)">
          <Textarea id="pay-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </form>
    </Sheet>
  )
}
